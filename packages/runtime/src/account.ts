import type {
  Account,
  ApplicationStateSchema,
  AssetParams
} from "algosdk";
import { Address, generateAccount } from "algosdk";

import { RUNTIME_ERRORS } from "./errors/errors-list";
import { RuntimeError } from "./errors/runtime-errors";
import { checkAndSetASAFields } from "./lib/asa";
import {
  ALGORAND_ACCOUNT_MIN_BALANCE, APPLICATION_BASE_FEE, ASSET_CREATION_FEE, MAX_ALGORAND_ACCOUNT_APPS,
  MAX_ALGORAND_ACCOUNT_ASSETS,
  SSC_KEY_BYTE_SLICE, SSC_VALUE_BYTES, SSC_VALUE_UINT
} from "./lib/constants";
import { keyToBytes } from "./lib/parsing";
import { assertValidSchema } from "./lib/stateful";
import {
  AccountStoreI,
  AppLocalStateM, ASADef, AssetHoldingM, AssetModFields, CreatedAppM, SSCAttributesM,
  SSCDeploymentFlags, StackElem
} from "./types";

const StateMap = "key-value";
const globalState = "global-state";
const localStateSchema = "local-state-schema";
const globalStateSchema = "global-state-schema";

export class AccountStore implements AccountStoreI {
  readonly account: Account;
  readonly address: string;
  minBalance: number; // required minimum balance for account
  assets: Map<number, AssetHoldingM>;
  amount: bigint;
  appsLocalState: Map<number, AppLocalStateM>;
  appsTotalSchema: ApplicationStateSchema;
  createdApps: Map<number, SSCAttributesM>;
  createdAssets: Map<number, AssetParams>;

  constructor (balance: number | bigint, account?: Account) {
    if (account) {
      // set config if account is passed by user
      this.account = account;
      this.address = account.addr;
    } else {
      // generate new account if not passed by user
      this.account = generateAccount();
      this.address = this.account.addr;
    }

    this.assets = new Map<number, AssetHoldingM>();
    this.amount = BigInt(balance);
    this.minBalance = ALGORAND_ACCOUNT_MIN_BALANCE;
    this.appsLocalState = new Map<number, AppLocalStateM>();
    this.appsTotalSchema = <ApplicationStateSchema>{};
    this.createdApps = new Map<number, SSCAttributesM>();
    this.createdAssets = new Map<number, AssetParams>();
  }

  // returns account balance in microAlgos
  balance (): bigint {
    return this.amount;
  }

  /**
   * Fetches local state value for key present in account
   * returns undefined otherwise
   * @param appID: current application id
   * @param key: key to fetch value of from local state
   */
  getLocalState (appID: number, key: Uint8Array | string): StackElem | undefined {
    const localState = this.appsLocalState;
    const data = localState.get(appID)?.[StateMap]; // can be undefined (eg. app opted in)
    const localKey = keyToBytes(key);
    return data?.get(localKey.toString());
  }

  /**
   * Set new key-value pair or update pair with existing key in account
   * for application id: appID, throw error otherwise
   * @param appID: current application id
   * @param key: key to fetch value of from local state
   * @param value: value of key to put in local state
   * @param line line number in TEAL file
   * Note: if user is accessing this function directly through runtime,
   * then line number is unknown
   */
  setLocalState (appID: number, key: Uint8Array | string, value: StackElem, line?: number): AppLocalStateM {
    const lineNumber = line ?? 'unknown';
    const localState = this.appsLocalState.get(appID);
    const localApp = localState?.[StateMap];
    if (localState && localApp) {
      const localKey = keyToBytes(key);
      localApp.set(localKey.toString(), value);
      localState[StateMap] = localApp; // save updated state

      assertValidSchema(localState[StateMap], localState.schema); // verify if updated schema is valid by config
      return localState;
    }

    throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND, {
      appID: appID,
      line: lineNumber
    });
  }

  /**
   * Queries app global state value. Returns `undefined` if the key is not present.
   * @param appID: current application id
   * @param key: key to fetch value of from local state
   */
  getGlobalState (appID: number, key: Uint8Array | string): StackElem | undefined {
    const app = this.getApp(appID);
    if (!app) return undefined;
    const appGlobalState = app[globalState];
    const globalKey = keyToBytes(key);
    return appGlobalState.get(globalKey.toString());
  }

  /**
   * Updates app global state.
   * Throws error if app is not found.
   * @param appID: application id
   * @param key: app global state key
   * @param value: value associated with a key
   */
  setGlobalState (appID: number, key: Uint8Array | string, value: StackElem, line?: number): void {
    const app = this.getApp(appID);
    if (app === undefined) throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND, { appID: appID, line: line ?? 'unknown' });
    const appGlobalState = app[globalState];
    const globalKey = keyToBytes(key);
    appGlobalState.set(globalKey.toString(), value); // set new value in global state
    app[globalState] = appGlobalState; // save updated state

    assertValidSchema(app[globalState], app[globalStateSchema]); // verify if updated schema is valid by config
  }

  /**
   * Queries application by application index from account's global state.
   * Returns undefined if app is not found.
   * @param appID application index
   */
  getApp (appID: number): SSCAttributesM | undefined {
    return this.createdApps.get(appID);
  }

  /**
   * Queries application by application index from account's local state.
   * Returns undefined if app is not found.
   * @param appID application index
   */
  getAppFromLocal (appID: number): AppLocalStateM | undefined {
    return this.appsLocalState.get(appID);
  }

  /**
   * Queries asset definition by assetId
   * @param assetId asset index
   */
  getAssetDef (assetId: number): AssetParams | undefined {
    return this.createdAssets.get(assetId);
  }

  /**
   * Queries asset holding by assetId
   * @param assetId asset index
   */
  getAssetHolding (assetId: number): AssetHoldingM | undefined {
    return this.assets.get(assetId);
  }

  /**
   * Creates Asset in account's state
   * @param name Asset Name
   * @param asaDef Asset Definitions
   */
  addAsset (assetId: number, name: string, asaDef: ASADef): AssetParams {
    if (this.createdAssets.size === MAX_ALGORAND_ACCOUNT_ASSETS) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.MAX_LIMIT_ASSETS,
        { name: name, address: this.address, max: MAX_ALGORAND_ACCOUNT_ASSETS });
    }

    this.minBalance += ASSET_CREATION_FEE;
    const asset = new Asset(assetId, asaDef, this.address, name);
    this.createdAssets.set(asset.id, asset.definitions);

    // set holding in creator account. note: for creator default-frozen is always false
    // https://developer.algorand.org/docs/reference/rest-apis/algod/v2/#assetparams
    const assetHolding: AssetHoldingM = {
      amount: BigInt(asaDef.total), // for creator opt-in amount is total assets
      'asset-id': assetId,
      creator: this.address,
      'is-frozen': false
    };
    this.assets.set(assetId, assetHolding);
    return asset.definitions;
  }

  /**
   * Modifies Asset fields
   * @param assetId Asset Index
   * @param fields Fields for modification
   */
  modifyAsset (assetId: number, fields: AssetModFields): void {
    const asset = this.getAssetDef(assetId);
    if (asset === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND, { assetId: assetId });
    }
    // check for blank fields
    checkAndSetASAFields(fields, asset);
  }

  /**
   * removes asset holding from account
   * @param assetId asset index
   */
  closeAsset (assetId: number): void {
    /**
     * NOTE: We don't throw error/warning here if asset holding is not found, because this code
     * will not be executed if asset holding doesn't exist (as need to empty this.account to closeRemTo
     * in runtime via ctx.transferAsset before removing asset holding)
     */
    if (this.assets.has(assetId)) {
      this.minBalance -= ASSET_CREATION_FEE;
      // https://developer.algorand.org/docs/reference/transactions/#asset-transfer-transaction
      this.assets.delete(assetId); // remove asset holding from account
    }
  }

  /**
   * Freeze asset
   * @param assetId Asset Index
   * @state new freeze state
   */
  setFreezeState (assetId: number, state: boolean): void {
    const holding = this.assets.get(assetId);
    if (holding === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.TRANSACTION.ASA_NOT_OPTIN,
        { address: this.address, assetId: assetId });
    }
    holding["is-frozen"] = state;
  }

  /**
   * Destroys asset
   * @param assetId Asset Index
   */
  destroyAsset (assetId: number): void {
    const holding = this.assets.get(assetId);
    const asset = this.getAssetDef(assetId);
    if (holding === undefined || asset === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND, { assetId: assetId });
    }
    if (holding.amount !== asset.total) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.ASSET_TOTAL_ERROR);
    }
    this.minBalance -= ASSET_CREATION_FEE;
    this.createdAssets.delete(assetId);
    this.assets.delete(assetId);
  }

  /**
   * Add application in account's state
   * check maximum account creation limit
   * @param appID application index
   * @param params SSCDeployment Flags
   * @param approvalProgram application approval program
   * @param clearProgram application clear program
   * NOTE - approval and clear program must be the TEAL code as string
   */
  addApp (appID: number, params: SSCDeploymentFlags,
    approvalProgram: string, clearProgram: string): CreatedAppM {
    if (this.createdApps.size === MAX_ALGORAND_ACCOUNT_APPS) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.MAX_LIMIT_APPS, {
        address: this.address,
        max: MAX_ALGORAND_ACCOUNT_APPS
      });
    };

    // raise minimum balance
    // https://developer.algorand.org/docs/features/asc1/stateful/#minimum-balance-requirement-for-a-smart-contract
    this.minBalance += (
      APPLICATION_BASE_FEE +
      (SSC_KEY_BYTE_SLICE + SSC_VALUE_UINT) * params.globalInts +
      (SSC_KEY_BYTE_SLICE + SSC_VALUE_BYTES) * params.globalBytes
    );
    const app = new App(appID, params, approvalProgram, clearProgram);
    this.createdApps.set(app.id, app.attributes);
    return app;
  }

  // opt in to application
  optInToApp (appID: number, appParams: SSCAttributesM): void {
    const localState = this.appsLocalState.get(appID); // fetch local state from account
    if (localState) {
      console.warn(`${this.address} is already opted in to app ${appID}`);
    } else {
      if (this.appsLocalState.size === 10) {
        throw new Error('Maximum Opt In applications per account is 10');
      }

      // https://developer.algorand.org/docs/features/asc1/stateful/#minimum-balance-requirement-for-a-smart-contract
      this.minBalance += (
        APPLICATION_BASE_FEE +
        (SSC_KEY_BYTE_SLICE + SSC_VALUE_UINT) * Number(appParams[localStateSchema].numUint) +
        (SSC_KEY_BYTE_SLICE + SSC_VALUE_BYTES) * Number(appParams[localStateSchema].numByteSlice)
      );

      // create new local app attribute
      const localParams: AppLocalStateM = {
        id: appID,
        "key-value": new Map<string, StackElem>(),
        schema: appParams[localStateSchema]
      };
      this.appsLocalState.set(appID, localParams);
    }
  }

  // opt-in to asset
  optInToASA (assetIndex: number, assetHolding: AssetHoldingM): void {
    const accAssetHolding = this.assets.get(assetIndex); // fetch asset holding of account
    if (accAssetHolding) {
      console.warn(`${this.address} is already opted in to asset ${assetIndex}`);
    } else {
      if ((this.createdAssets.size + this.assets.size) === MAX_ALGORAND_ACCOUNT_ASSETS) {
        throw new RuntimeError(RUNTIME_ERRORS.ASA.MAX_LIMIT_ASSETS,
          { address: assetHolding.creator, max: MAX_ALGORAND_ACCOUNT_ASSETS });
      }

      this.minBalance += ASSET_CREATION_FEE;
      this.assets.set(assetIndex, assetHolding);
    }
  }

  // delete application from account's global state (createdApps)
  deleteApp (appID: number): void {
    const app = this.createdApps.get(appID);
    if (!app) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND, { appID: appID, line: 'unknown' });
    }

    // reduce minimum balance
    this.minBalance -= (
      APPLICATION_BASE_FEE +
      (SSC_KEY_BYTE_SLICE + SSC_VALUE_UINT) * Number(app[globalStateSchema].numUint) +
      (SSC_KEY_BYTE_SLICE + SSC_VALUE_BYTES) * Number(app[globalStateSchema].numByteSlice)
    );
    this.createdApps.delete(appID);
  }

  // close(delete) application from account's local state (appsLocalState)
  closeApp (appID: number): void {
    const localApp = this.appsLocalState.get(appID);
    if (!localApp) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND, { appID: appID, line: 'unknown' });
    }

    // decrease min balance
    this.minBalance -= (
      APPLICATION_BASE_FEE +
      (SSC_KEY_BYTE_SLICE + SSC_VALUE_UINT) * Number(localApp.schema.numUint) +
      (SSC_KEY_BYTE_SLICE + SSC_VALUE_BYTES) * Number(localApp.schema.numByteSlice)
    );
    this.appsLocalState.delete(appID);
  }
}

// represents stateful application
class App {
  readonly id: number;
  readonly attributes: SSCAttributesM;

  // NOTE - approval and clear program must be the TEAL code as string
  constructor (appID: number, params: SSCDeploymentFlags,
    approvalProgram: string, clearProgram: string) {
    this.id = appID;
    const base: BaseModel = new BaseModelI();
    this.attributes = {
      'approval-program': approvalProgram,
      'clear-state-program': clearProgram,
      creator: params.sender.addr,
      'global-state': new Map<string, StackElem>(),
      'global-state-schema': { ...base, numByteSlice: params.globalBytes, numUint: params.globalInts },
      'local-state-schema': { ...base, numByteSlice: params.localBytes, numUint: params.localInts }
    };
  }
}

// represents asset
class Asset {
  readonly id: number;
  readonly definitions: AssetParams;

  constructor (assetId: number, def: ASADef, creator: string, assetName: string) {
    this.id = assetId;
    const base: BaseModel = new BaseModelI();
    this.definitions = {
      creator: creator,
      total: BigInt(def.total),
      decimals: def.decimals,
      defaultFrozen: def.defaultFrozen ?? false,
      unitName: def.unitName,
      url: def.url ?? '',
      metadataHash: def.metadataHash ?? '',
      manager: def.manager ?? '',
      reserve: def.reserve ?? '',
      freeze: def.freeze ?? '',
      clawback: def.clawback ?? '',
      ...base
    };
  }
}

export interface BaseModel {
  attribute_map: Record<string, string>
  _is_primitive: (val: any) => val is string | boolean | number | bigint
  _is_address: (val: any) => val is Address
  /* eslint-disable*/
  _get_obj_for_encoding(val: Function): Record<string, any>;
  _get_obj_for_encoding(val: any[]): any[];
  _get_obj_for_encoding(val: Record<string, any>): Record<string, any>;
  get_obj_for_encoding(): Record<string, any>;
}

export class BaseModelI implements BaseModel {
  attribute_map: Record<string, string>;

  public constructor () {
    this.attribute_map = {};
  }
  _is_primitive(val: any): val is string | boolean | number | bigint { 
    return true;
  }

  _is_address(val: any): val is Address {
    throw new Error("_is_address Not Implemented");
  }

  _get_obj_for_encoding(val: Function): Record<string, any>;
  _get_obj_for_encoding(val: any[]): any[];
  _get_obj_for_encoding(val: Record<string, any>): Record<string, any> {
    throw new Error("_get_obj_for_encoding Not Implemented");
  }
  
  get_obj_for_encoding(): Record<string, any> {
    throw new Error("get_obj_for_encoding Not Implemented");
  }
}
