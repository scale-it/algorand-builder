import { overrideASADef, types as rtypes } from "@algo-builder/runtime";
import { ASADef } from "@algo-builder/runtime/build/types";
import type { AssetParams, EncodedMultisig } from "algosdk";
import * as algosdk from "algosdk";

import { BuilderError } from "../errors/errors";
import { ERRORS } from "../errors/errors-list";
import { txWriter } from "../internal/tx-log-writer";
import { AlgoOperator } from "../lib/algo-operator";
import { getDummyLsig, getLsig } from "../lib/lsig";
import { blsigExt, loadBinaryLsig, readMsigFromFile } from "../lib/msig";
import { CheckpointFunctionsImpl, persistCheckpoint } from "../lib/script-checkpoints";
import type {
  ASCCache,
  CheckpointFunctions,
  CheckpointRepo,
  Deployer,
  FundASCFlags,
  LsigInfo,
  RuntimeEnv,
  SCParams
} from "../types";
import { DeployerConfig } from "./deployer_cfg";

// Base class for deployer Run Mode (read access) and Deploy Mode (read and write access)
class DeployerBasicMode {
  protected readonly runtimeEnv: RuntimeEnv;
  protected readonly cpData: CheckpointRepo;
  protected readonly loadedAsaDefs: rtypes.ASADefs;
  protected readonly algoOp: AlgoOperator;
  protected readonly txWriter: txWriter;
  readonly accounts: rtypes.Account[];
  readonly accountsByName: rtypes.AccountMap;
  checkpoint: CheckpointFunctions;

  constructor (deployerCfg: DeployerConfig) {
    this.runtimeEnv = deployerCfg.runtimeEnv;
    this.cpData = deployerCfg.cpData;
    this.loadedAsaDefs = deployerCfg.asaDefs;
    this.algoOp = deployerCfg.algoOp;
    this.accounts = deployerCfg.runtimeEnv.network.config.accounts;
    this.accountsByName = deployerCfg.accounts;
    this.txWriter = deployerCfg.txWriter;
    this.checkpoint = new CheckpointFunctionsImpl(deployerCfg.cpData, deployerCfg.runtimeEnv.network.name);
  }

  protected get networkName (): string {
    return this.runtimeEnv.network.name;
  }

  /**
   * Queries ASA Info from asset name
   * @param name asset name
   */
  getASAInfo (name: string): rtypes.ASAInfo {
    const found = this.asa.get(name);
    if (!found) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_NOT_DEFINED, {
          assetName: name
        });
    }
    return found;
  }

  private _getAccount (name: string): rtypes.Account {
    const found = this.accountsByName.get(name);
    if (!found) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.ACCOUNT_NOT_FOUND, {
          assetName: name
        });
    }
    return found;
  }

  /**
   * Returns asset definition for given name
   * @param name Asset name
   * @param asaParams Asa parameters if user wants to override existing asa definition
   */
  getASADef (name: string, asaParams?: Partial<rtypes.ASADef>): rtypes.ASADef {
    return overrideASADef(this.accountsByName, this.loadedAsaDefs[name], asaParams);
  }

  /**
   * Returns checkpoint metadata
   * @param key key for the map
   */
  getCheckpointKV (key: string): string | undefined {
    return this.cpData.getMetadata(this.networkName, key);
  }

  isDefined (name: string): boolean {
    return this.cpData.isDefined(this.networkName, name);
  }

  get asa (): Map<string, rtypes.ASAInfo> {
    return this.cpData.precedingCP[this.networkName]?.asa ?? new Map();
  }

  get algodClient (): algosdk.Algodv2 {
    return this.algoOp.algodClient;
  }

  async waitForConfirmation (txId: string): Promise<algosdk.PendingTransactionResponse> {
    return await this.algoOp.waitForConfirmation(txId);
  }

  /**
   * Queries blockchain using algodv2 for asset information by index
   * @param assetIndex asset index
   * @returns asset info from network
   */
  async getAssetByID (assetIndex: number | bigint): Promise<algosdk.modelsv2.Asset> {
    return await this.algoOp.getAssetByID(assetIndex);
  }

  log (msg: string, obj: any): void {
    this.txWriter.push(msg, obj);
  }

  /**
   * Loads deployed Asset Definition from checkpoint.
   * NOTE: This function returns "deployed" ASADef, as immutable properties
   * of asaDef could be updated during tx execution (eg. update asset clawback)
   * @param asaName asset name in asa.yaml
   */
  loadASADef (asaName: string): ASADef | undefined {
    const asaMap = this.cpData.precedingCP[this.networkName]?.asa ?? new Map();
    return asaMap.get(asaName)?.assetDef;
  }

  /**
   * Loads stateful smart contract info from checkpoint
   * @param nameApproval Approval program name
   * @param nameClear clear program name
   */
  getSSC (nameApproval: string, nameClear: string): rtypes.SSCInfo | undefined {
    return this.checkpoint.getSSCfromCPKey(nameApproval + "-" + nameClear);
  }

  /**
   * Loads a single signed delegated logic signature from checkpoint
   */
  getDelegatedLsig (lsigName: string): rtypes.LogicSig | undefined {
    const resultMap = this.cpData.precedingCP[this.networkName]?.dLsig ?? new Map(); ;
    const result = resultMap.get(lsigName)?.lsig;
    if (result === undefined) { return undefined; }
    const lsig = getDummyLsig();
    Object.assign(lsig, result);
    if (lsig.sig) { lsig.sig = Uint8Array.from(lsig.sig); };
    return lsig;
  }

  /**
   * Loads logic signature for contract mode
   * @param name ASC name
   * @param scTmplParams: Smart contract template parameters (used only when compiling PyTEAL to TEAL)
   * @returns loaded logic signature from assets/<file_name>.teal
   */
  async loadLogic (name: string, scTmplParams?: SCParams): Promise<rtypes.LogicSig> {
    return await getLsig(name, this.algoOp.algodClient, scTmplParams);
  }

  /**
   * Loads multisigned logic signature from .lsig or .blsig file
   * @param name filename
   * @returns multi signed logic signature from assets/<file_name>.(b)lsig
   */
  async loadMultiSig (name: string): Promise<rtypes.LogicSig> {
    if (name.endsWith(blsigExt)) { return await loadBinaryLsig(name); }

    const lsig = await getLsig(name, this.algoOp.algodClient); // get lsig from .teal (getting logic part from lsig)
    const msig = await readMsigFromFile(name); // Get decoded Msig object from .msig
    Object.assign(lsig.msig = {} as EncodedMultisig, msig);
    return lsig;
  }

  /**
   * Send signed transaction to network and wait for confirmation
   * @param rawTxns Signed Transaction(s)
   */
  async sendAndWait (rawTxns: Uint8Array | Uint8Array[]): Promise<algosdk.PendingTransactionResponse> {
    return await this.algoOp.sendAndWait(rawTxns);
  }

  /**
   * Opt-In to ASA for a single account. The opt-in transaction is
   * signed by account secret key
   * @param asa ASA (name/ID) Note: ID can be used for assets not existing in checkpoints.
   * @param accountName
   * @param flags Transaction flags
   */
  async optInAcountToASA (asa: string, accountName: string, flags: rtypes.TxParams): Promise<void> {
    this.assertCPNotDeleted({
      type: rtypes.TransactionType.OptInASA,
      sign: rtypes.SignType.SecretKey,
      fromAccount: this._getAccount(accountName),
      assetID: asa,
      payFlags: {}
    });
    try {
      const asaId = this.getASAInfo(asa).assetIndex;
      await this.algoOp.optInAcountToASA(
        asa,
        asaId,
        this._getAccount(accountName),
        flags);
    } catch (error) {
      console.log("Asset no found in checkpoints. Proceeding to check as Asset ID.");
      if (!Number(asa)) {
        throw Error("Please provide a valid Number to be used as ASA ID");
      }
      const asaId = Number(asa);
      await this.algoOp.optInAcountToASA(
        asa,
        asaId,
        this._getAccount(accountName),
        flags);
    }
  }

  /**
   * Description: Opt-In to ASA for a contract account (represented by logic signture).
   * The opt-in transaction is signed by the logic signature
   * @param asa ASA (name/ID) Note: ID can be used for assets not existing in checkpoints.
   * @param lsig logic signature
   * @param flags Transaction flags
   */
  async optInLsigToASA (asa: string, lsig: rtypes.LogicSig, flags: rtypes.TxParams): Promise<void> {
    this.assertCPNotDeleted({
      type: rtypes.TransactionType.OptInASA,
      sign: rtypes.SignType.LogicSignature,
      fromAccountAddr: lsig.address(),
      lsig: lsig,
      assetID: asa,
      payFlags: {}
    });
    try {
      const asaId = this.getASAInfo(asa).assetIndex;
      await this.algoOp.optInLsigToASA(asa, asaId, lsig, flags);
    } catch (error) {
      console.log("Asset no found in checkpoints. Proceeding to check as Asset ID.");
      if (!Number(asa)) {
        throw Error("Please provide a valid Number to be used as ASA ID");
      }
      const asaId = Number(asa);
      await this.algoOp.optInLsigToASA(asa, asaId, lsig, flags);
    }
  }

  /**
   * Opt-In to stateful smart contract (SSC) for a single account
   * signed by account secret key
   * @param sender sender account
   * @param appID application index
   * @param payFlags Transaction flags
   * @param flags Optional parameters to SSC (accounts, args..)
   */
  async optInAccountToSSC (
    sender: rtypes.Account,
    appID: number,
    payFlags: rtypes.TxParams,
    flags: rtypes.SSCOptionalFlags): Promise<void> {
    this.assertCPNotDeleted({
      type: rtypes.TransactionType.OptInSSC,
      sign: rtypes.SignType.SecretKey,
      fromAccount: sender,
      appID: appID,
      payFlags: {}
    });
    await this.algoOp.optInAccountToSSC(sender, appID, payFlags, flags);
  }

  /**
   * Opt-In to stateful smart contract (SSC) for a contract account
   * The opt-in transaction is signed by the logic signature
   * @param appID application index
   * @param lsig logic signature
   * @param payFlags Transaction flags
   * @param flags Optional parameters to SSC (accounts, args..)
   */
  async optInLsigToSSC (
    appID: number,
    lsig: rtypes.LogicSig,
    payFlags: rtypes.TxParams,
    flags: rtypes.SSCOptionalFlags): Promise<void> {
    this.assertCPNotDeleted({
      type: rtypes.TransactionType.OptInSSC,
      sign: rtypes.SignType.LogicSignature,
      fromAccountAddr: lsig.address(),
      lsig: lsig,
      appID: appID,
      payFlags: {}
    });
    await this.algoOp.optInLsigToSSC(appID, lsig, payFlags, flags);
  }

  /**
   * Returns ASCCache (with compiled code)
   * @param name: Smart Contract filename (must be present in assets folder)
   * @param force: if force is true file will be compiled for sure, even if it's checkpoint exist
   * @param scTmplParams: scTmplParams: Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  async ensureCompiled (name: string, force?: boolean, scTmplParams?: SCParams): Promise<ASCCache> {
    return await this.algoOp.ensureCompiled(name, force, scTmplParams);
  }

  /**
   * Asserts ASA is defined in a checkpoint by asset id / string,
   * First: search for ASAInfo in checkpoints
   * Case 1: If it exist check if that info is deleted or not by checking deleted boolean
   * If deleted boolean is true throw error
   * else, pass
   * Case 2: If it doesn't exist, pass
   * @param asset asset index or asset name
   */
  private assertASAExist (asset: string | number): void {
    let key, res;
    if (typeof asset === "string") {
      res = this.asa.get(asset);
    } else if (typeof asset === "number") {
      key = this.checkpoint.getAssetCheckpointKeyFromIndex(asset);
      res = key ? this.asa.get(key) : undefined;
    }
    if (res?.deleted === true) {
      throw new BuilderError(
        ERRORS.GENERAL.ASSET_DELETED, {
          asset: asset
        });
    }
  }

  /**
   * Asserts App is defined in a checkpoint by app id.
   * First: search for SSCInfo in checkpoints
   * Case 1: If it exist check if that info is deleted or not by checking deleted boolean
   * If deleted boolean is true throw error
   * else, pass
   * Case 2: If it doesn't exist, pass
   * @param appID Application index
   */
  private assertAppExist (appID: number): void {
    const key = this.checkpoint.getAppCheckpointKeyFromIndex(appID);
    const res = key ? this.checkpoint.getSSCfromCPKey(key) : undefined;
    if (res?.deleted === true) {
      throw new BuilderError(
        ERRORS.GENERAL.APP_DELETED, {
          app: appID
        });
    }
  }

  /**
   * Group transactions into asa and app, check for cp deletion
   * @param txn Transaction execution parameter
   */
  private _assertCpNotDeleted (txn: rtypes.ExecParams): void {
    switch (txn.type) {
      case rtypes.TransactionType.ModifyAsset:
      case rtypes.TransactionType.FreezeAsset:
      case rtypes.TransactionType.RevokeAsset:
      case rtypes.TransactionType.OptInASA:
      case rtypes.TransactionType.DestroyAsset: {
        this.assertASAExist(txn.assetID);
        break;
      }
      // https://developer.algorand.org/articles/algos-asas/#opting-in-and-out-of-asas
      // https://developer.algorand.org/docs/reference/transactions/#asset-transfer-transaction
      case rtypes.TransactionType.TransferAsset: {
        // If transaction is not opt-out check for CP deletion
        if (txn.payFlags.closeRemainderTo === undefined) {
          this.assertASAExist(txn.assetID);
        }
        break;
      }
      case rtypes.TransactionType.DeleteSSC:
      case rtypes.TransactionType.CloseSSC:
      case rtypes.TransactionType.OptInSSC:
      case rtypes.TransactionType.UpdateSSC:
      case rtypes.TransactionType.CallNoOpSSC: {
        this.assertAppExist(txn.appID);
        break;
      }
    }
  }

  /**
   * Checks if checkpoint is deleted for a particular transaction
   * if checkpoint exist and is marked as deleted,
   * throw error(except for opt-out transactions), else pass
   * @param execParams Transaction execution parameters
   */
  assertCPNotDeleted (execParams: rtypes.ExecParams | rtypes.ExecParams[]): void {
    if (Array.isArray(execParams)) {
      for (const txn of execParams) {
        this._assertCpNotDeleted(txn);
      }
    } else {
      this._assertCpNotDeleted(execParams);
    }
  }
}

/**
 * This class is what user interacts with in deploy task
 */
export class DeployerDeployMode extends DeployerBasicMode implements Deployer {
  get isDeployMode (): boolean {
    return true;
  }

  addCheckpointKV (key: string, value: string): void {
    const found = this.cpData.getMetadata(this.networkName, key);
    if (found === value) {
      return;
    }
    if (found) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_METADATA_ALREADY_PRESENT, {
          metadataKey: key
        });
    }
    this.cpData.putMetadata(this.networkName, key, value);
  }

  /**
   * Asserts if asset is not already present in checkpoint
   * @param name Asset name
   */
  assertNoAsset (name: string): void {
    if (this.isDefined(name)) {
      this.persistCP();
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASSET_ALREADY_PRESENT, {
          assetName: name
        });
    }
  }

  /**
   * Persist checkpoint till current call.
   */
  persistCP (): void {
    persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);
  }

  /**
   * Register ASA Info in checkpoints
   */
  registerASAInfo (asaName: string, asaInfo: rtypes.ASAInfo): void {
    this.cpData.registerASA(this.networkName, asaName, asaInfo);
  }

  /**
   * Register SSC Info in checkpoints
   */
  registerSSCInfo (sscName: string, sscInfo: rtypes.SSCInfo): void {
    this.cpData.registerSSC(this.networkName, sscName, sscInfo);
  }

  /**
   * Log transaction with message using txwriter
   */
  logTx (message: string, txConfirmation: algosdk.PendingTransactionResponse): void {
    this.txWriter.push(message, txConfirmation);
  }

  async deployASA (
    name: string,
    flags: rtypes.ASADeploymentFlags,
    asaParams?: Partial<rtypes.ASADef>
  ): Promise<rtypes.ASAInfo> {
    const asaDef = overrideASADef(this.accountsByName, this.loadedAsaDefs[name], asaParams);

    if (asaDef === undefined) {
      this.persistCP();

      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_DEF_NOT_FOUND, {
          asaName: name
        });
    }
    this.assertNoAsset(name);
    let asaInfo = {} as rtypes.ASAInfo;
    try {
      asaInfo = await this.algoOp.deployASA(
        name, asaDef, flags, this.accountsByName, this.txWriter);
    } catch (error) {
      this.persistCP();

      console.log(error);
      throw error;
    }

    this.registerASAInfo(name, asaInfo);

    try {
      await this.algoOp.optInToASAMultiple(
        name,
        asaDef,
        flags,
        this.accountsByName,
        asaInfo.assetIndex);
    } catch (error) {
      this.persistCP();

      console.log(error);
      throw error;
    }

    return asaInfo;
  }

  /**
   * This function will send Algos to ASC account in "Contract Mode"
   * @param name     - ASC filename
   * @param flags    - Deployments flags (as per SPEC)
   * @param payFlags - as per SPEC
   * @param scTmplParams: Smart contract template parameters (used only when compiling PyTEAL to TEAL)
   */
  async fundLsig (name: string, flags: FundASCFlags,
    payFlags: rtypes.TxParams, scTmplParams?: SCParams): Promise<void> {
    try {
      await this.algoOp.fundLsig(name, flags, payFlags, this.txWriter, scTmplParams);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /**
   * Create and sign (using signer's sk) a logic signature for "delegated approval". Then save signed lsig
   * info to checkpoints (in /artifacts)
   * https://developer.algorand.org/docs/features/asc1/stateless/sdks/#account-delegation-sdk-usage
   * @param name: Stateless Smart Contract filename (must be present in assets folder)
   * @param signer: Signer Account which will sign the smart contract
   * @param scTmplParams: scTmplParams: Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  async mkDelegatedLsig (
    name: string, signer: rtypes.Account,
    scTmplParams?: SCParams): Promise<LsigInfo> {
    this.assertNoAsset(name);
    let lsigInfo = {} as any;
    try {
      const lsig = await getLsig(name, this.algoOp.algodClient, scTmplParams);
      lsig.sign(signer.sk);
      lsigInfo = {
        creator: signer.addr,
        contractAddress: lsig.address(),
        lsig: lsig
      };
    } catch (error) {
      this.persistCP();

      console.log(error);
      throw error;
    }
    this.cpData.registerLsig(this.networkName, name, lsigInfo);
    return lsigInfo;
  }

  /**
   * Deploys Algorand Stateful Smart Contract
   * @param approvalProgram filename which has approval program
   * @param clearProgram filename which has clear program
   * @param flags SSCDeploymentFlags
   * @param payFlags Transaction Params
   * @param scTmplParams: scTmplParams: Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  async deploySSC (
    approvalProgram: string,
    clearProgram: string,
    flags: rtypes.SSCDeploymentFlags,
    payFlags: rtypes.TxParams,
    scTmplParams?: SCParams): Promise<rtypes.SSCInfo> {
    const name = approvalProgram + "-" + clearProgram;
    this.assertNoAsset(name);
    let sscInfo = {} as rtypes.SSCInfo;
    try {
      sscInfo = await this.algoOp.deploySSC(
        approvalProgram, clearProgram, flags, payFlags, this.txWriter, scTmplParams);
    } catch (error) {
      this.persistCP();

      console.log(error);
      throw error;
    }

    this.registerSSCInfo(name, sscInfo);

    return sscInfo;
  }

  /**
   * Update programs for a contract.
   * @param sender Account from which call needs to be made
   * @param payFlags Transaction Flags
   * @param appID ID of the application being configured or empty if creating
   * @param newApprovalProgram New Approval Program filename
   * @param newClearProgram New Clear Program filename
   * @param flags Optional parameters to SSC (accounts, args..)
   */
  async updateSSC (
    sender: algosdk.Account,
    payFlags: rtypes.TxParams,
    appID: number,
    newApprovalProgram: string,
    newClearProgram: string,
    flags: rtypes.SSCOptionalFlags
  ): Promise<rtypes.SSCInfo> {
    this.assertCPNotDeleted({
      type: rtypes.TransactionType.UpdateSSC,
      sign: rtypes.SignType.SecretKey,
      fromAccount: sender,
      newApprovalProgram: newApprovalProgram,
      newClearProgram: newClearProgram,
      appID: appID,
      payFlags: {}
    });
    const cpKey = newApprovalProgram + "-" + newClearProgram;

    let sscInfo = {} as rtypes.SSCInfo;
    try {
      sscInfo = await this.algoOp.updateSSC(sender, payFlags, appID,
        newApprovalProgram, newClearProgram, flags, this.txWriter);
    } catch (error) {
      this.persistCP();

      console.log(error);
      throw error;
    }

    this.registerSSCInfo(cpKey, sscInfo);
    return sscInfo;
  }
}

/**
 * This class is what user interacts with in run task mode
 */
export class DeployerRunMode extends DeployerBasicMode implements Deployer {
  get isDeployMode (): boolean {
    return false;
  }

  persistCP (): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "persistCP"
    });
  }

  assertNoAsset (name: string): void {
    if (this.isDefined(name)) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASSET_ALREADY_PRESENT, {
          assetName: name
        });
    }
  }

  registerASAInfo (name: string, asaInfo: rtypes.ASAInfo): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "registerASAInfo"
    });
  }

  registerSSCInfo (name: string, sscInfo: rtypes.SSCInfo): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "registerSSCInfo"
    });
  }

  logTx (message: string, txConfirmation: algosdk.PendingTransactionResponse): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "logTx"
    });
  }

  addCheckpointKV (_key: string, _value: string): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "addCheckpointKV"
    });
  }

  async deployASA (_name: string, _flags: rtypes.ASADeploymentFlags): Promise<rtypes.ASAInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "deployASA"
    });
  }

  async fundLsig (_name: string, _flags: FundASCFlags,
    _payFlags: rtypes.TxParams, _scInitParams?: unknown): Promise<LsigInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "fundLsig"
    });
  }

  async mkDelegatedLsig (_name: string, _signer: rtypes.Account,
    _scInitParams?: unknown): Promise<LsigInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "delegatedLsig"
    });
  }

  async deploySSC (
    approvalProgram: string,
    clearProgram: string,
    flags: rtypes.SSCDeploymentFlags,
    payFlags: rtypes.TxParams,
    scInitParam?: unknown): Promise<rtypes.SSCInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "deploySSC"
    });
  }

  /**
   * This functions updates SSC in the network.
   * Note: UpdateSSC when ran in RunMode it doesn't store checkpoints
   * @param sender Sender account
   * @param payFlags transaction parameters
   * @param appID application index
   * @param newApprovalProgram new approval program name
   * @param newClearProgram new clear program name
   * @param flags SSC optional flags
   */
  async updateSSC (
    sender: algosdk.Account,
    payFlags: rtypes.TxParams,
    appID: number,
    newApprovalProgram: string,
    newClearProgram: string,
    flags: rtypes.SSCOptionalFlags
  ): Promise<rtypes.SSCInfo> {
    this.assertCPNotDeleted({
      type: rtypes.TransactionType.UpdateSSC,
      sign: rtypes.SignType.SecretKey,
      fromAccount: sender,
      newApprovalProgram: newApprovalProgram,
      newClearProgram: newClearProgram,
      appID: appID,
      payFlags: {}
    });
    return await this.algoOp.updateSSC(
      sender, payFlags, appID,
      newApprovalProgram, newClearProgram,
      flags, this.txWriter
    );
  }
}
