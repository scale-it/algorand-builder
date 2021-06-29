/* eslint sonarjs/no-duplicate-string: 0 */
/* eslint sonarjs/no-small-switch: 0 */
import algosdk, { AssetParams, decodeAddress } from "algosdk";
import cloneDeep from "lodash.clonedeep";

import { AccountStore } from "./account";
import { Ctx } from "./ctx";
import { RUNTIME_ERRORS } from "./errors/errors-list";
import { RuntimeError } from "./errors/runtime-errors";
import { Interpreter, loadASAFile } from "./index";
import { convertToString, parseSSCAppArgs } from "./lib/parsing";
import { encodeNote, getFromAddress, mkTransaction } from "./lib/txn";
import { LogicSig } from "./logicsig";
import { mockSuggestedParams } from "./mock/tx";
import {
  AccountAddress, AccountStoreI, ASADefs, ASADeploymentFlags,
  ASAInfo, AssetHoldingM, Context, ExecParams, ExecutionMode,
  SignType, SSCAttributesM, SSCDeploymentFlags, SSCInfo, SSCOptionalFlags,
  StackElem, State, TransactionType, Txn, TxParams
} from "./types";

export class Runtime {
  /**
   * We are using Maps instead of algosdk arrays
   * because of faster and easy querying.
   * This way when querying, instead of traversing the whole object,
   * we can get the value directly from Map
   * Note: Runtime operates on `store`, it doesn't operate on `ctx`.
   */
  private store: State;
  ctx: Context;
  loadedAssetsDefs: ASADefs;
  // https://developer.algorand.org/docs/features/transactions/?query=round
  private round: number;
  private timestamp: number;

  constructor (accounts: AccountStoreI[]) {
    // runtime store
    this.store = {
      accounts: new Map<AccountAddress, AccountStoreI>(), // string represents account address
      globalApps: new Map<number, AccountAddress>(), // map of {appID: accountAddress}
      assetDefs: new Map<number, AccountAddress>(), // number represents assetId
      assetNameInfo: new Map<string, ASAInfo>(),
      appNameInfo: new Map<string, SSCInfo>(),
      appCounter: 0, // initialize app counter with 0
      assetCounter: 0 // initialize asset counter with 0
    };

    // intialize accounts (should be done during runtime initialization)
    this.initializeAccounts(accounts);

    // load asa yaml files
    this.loadedAssetsDefs = loadASAFile(this.store.accounts);

    // context for interpreter
    this.ctx = new Ctx(cloneDeep(this.store), <Txn>{}, [], [], this);

    this.round = 2;
    this.timestamp = 1;
  }

  /**
   * asserts if account is defined.
   * @param a account
   * @param line line number in TEAL file
   * Note: if user is accessing this function directly through runtime,
   * the line number is unknown
   */
  assertAccountDefined (address: string, a?: AccountStoreI, line?: number): AccountStoreI {
    const lineNumber = line ?? 'unknown';
    if (a === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.ACCOUNT_DOES_NOT_EXIST,
        { address: address, line: lineNumber });
    }
    return a;
  }

  /**
   * asserts if account address is defined
   * @param addr account address
   * @param line line number in TEAL file
   * Note: if user is accessing this function directly through runtime,
   * the line number is unknown
   */
  assertAddressDefined (addr: string | undefined, line?: number): string {
    const lineNumber = line ?? 'unknown';
    if (addr === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.ACCOUNT_DOES_NOT_EXIST,
        { address: addr, line: lineNumber });
    }
    return addr;
  }

  /**
   * asserts if application exists in state
   * @param app application
   * @param appID application index
   * @param line line number in TEAL file
   * Note: if user is accessing this function directly through runtime,
   * the line number is unknown
   */
  assertAppDefined (appID: number, app?: SSCAttributesM, line?: number): SSCAttributesM {
    const lineNumber = line ?? 'unknown';
    if (app === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND,
        { appID: appID, line: lineNumber });
    }
    return app;
  }

  /**
   * asserts if asset exists in state
   * @param assetId asset index
   * @param assetDef asset definitions
   * @param line line number
   * Note: if user is accessing this function directly through runtime,
   * the line number is unknown
   */
  assertAssetDefined (assetId: number, assetDef?: AssetParams, line?: number): AssetParams {
    const lineNumber = line ?? 'unknown';
    if (assetDef === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND,
        { assetId: assetId, line: lineNumber });
    }
    return assetDef;
  }

  /**
   * Validate first and last rounds of transaction using current round
   * @param gtxns transactions
   */
  validateTxRound (gtxns: Txn[]): void {
    // https://developer.algorand.org/docs/features/transactions/#current-round
    for (const txn of gtxns) {
      if (txn.fv >= this.round || txn.lv <= this.round) {
        throw new RuntimeError(RUNTIME_ERRORS.GENERAL.INVALID_ROUND,
          { first: txn.fv, last: txn.lv, round: this.round });
      }
    }
  }

  /**
   * set current round with timestamp for a block
   * @param r current round
   * @param timestamp block's timestamp
   */
  setRoundAndTimestamp (r: number, timestamp: number): void {
    this.round = r;
    this.timestamp = timestamp;
  }

  /**
   * Return current round
   */
  getRound (): number {
    return this.round;
  }

  /**
   * Return current timestamp
   */
  getTimestamp (): number {
    return this.timestamp;
  }

  /**
   * Fetches app from `this.store`
   * @param appID Application Index
   */
  getApp (appID: number): SSCAttributesM {
    if (!this.store.globalApps.has(appID)) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND, { appID: appID, line: 'unknown' });
    }
    const accAddress = this.assertAddressDefined(this.store.globalApps.get(appID));
    const account = this.assertAccountDefined(accAddress, this.store.accounts.get(accAddress));
    return this.assertAppDefined(appID, account.getApp(appID));
  }

  /**
   * Fetches account from `this.store`
   * @param address account address
   */
  getAccount (address: string): AccountStoreI {
    const account = this.store.accounts.get(address);
    return this.assertAccountDefined(address, account);
  }

  /**
   * Fetches global state value for key present in creator's global state
   * for given appID, returns undefined otherwise
   * @param appID: current application id
   * @param key: key to fetch value of from local state
   */
  getGlobalState (appID: number, key: Uint8Array | string): StackElem | undefined {
    if (!this.store.globalApps.has(appID)) {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.APP_NOT_FOUND, { appID: appID, line: 'unknown' });
    }
    const accAddress = this.assertAddressDefined(this.store.globalApps.get(appID));
    const account = this.assertAccountDefined(accAddress, this.store.accounts.get(accAddress));
    return account.getGlobalState(appID, key);
  }

  /**
   * Fetches local state for account address and application index
   * @param appID application index
   * @param accountAddr address for which local state needs to be retrieved
   * @param key: key to fetch value of from local state
   */
  getLocalState (appID: number, accountAddr: string, key: Uint8Array | string): StackElem | undefined {
    accountAddr = this.assertAddressDefined(accountAddr);
    const account = this.assertAccountDefined(accountAddr, this.store.accounts.get(accountAddr));
    return account.getLocalState(appID, key);
  }

  /**
   * Returns asset creator account or throws error is it doesn't exist
   * @param Asset Index
   */
  getAssetAccount (assetId: number): AccountStoreI {
    const addr = this.store.assetDefs.get(assetId);
    if (addr === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND, { assetId: assetId });
    }
    return this.assertAccountDefined(addr, this.store.accounts.get(addr));
  }

  /**
   * Returns Asset Definitions
   * @param assetId Asset Index
   */
  getAssetDef (assetId: number): AssetParams {
    const creatorAcc = this.getAssetAccount(assetId);
    const assetDef = creatorAcc.getAssetDef(assetId);
    return this.assertAssetDefined(assetId, assetDef);
  }

  /**
   * Queries asset id by asset name from global state.
   * Returns undefined if asset is not found.
   * @param name Asset name
   */
  getAssetInfoFromName (name: string): ASAInfo | undefined {
    return this.store.assetNameInfo.get(name);
  }

  /**
   * Queries app id by app name from global state.
   * Returns undefined if app is not found.
   * @param approval
   * @param clear
   */
  getAppInfoFromName (approval: string, clear: string): SSCInfo | undefined {
    return this.store.appNameInfo.get(approval + "-" + clear);
  }

  /**
   * Setup initial accounts as {address: SDKAccount}. This should be called only when initializing Runtime.
   * @param accounts: array of account info's
   */
  initializeAccounts (accounts: AccountStoreI[]): void {
    for (const acc of accounts) {
      this.store.accounts.set(acc.address, acc);

      for (const appID of acc.createdApps.keys()) {
        this.store.globalApps.set(appID, acc.address);
      }

      for (const assetId of acc.createdAssets.keys()) {
        this.store.assetDefs.set(assetId, acc.address);
      }
    }
  }

  /**
   * Creates new transaction object (tx, gtxs) from given txnParams
   * @param txnParams : Transaction parameters for current txn or txn Group
   * @returns: [current transaction, transaction group]
   */
  createTxnContext (txnParams: ExecParams | ExecParams[]): [Txn, Txn[]] {
    // if txnParams is array, then user is requesting for a group txn
    if (Array.isArray(txnParams)) {
      if (txnParams.length > 16) {
        throw new Error("Maximum size of an atomic transfer group is 16");
      }

      const txns = [];
      for (const txnParam of txnParams) { // create encoded_obj for each txn in group
        const mockParams = mockSuggestedParams(txnParam.payFlags, this.round);
        const tx = mkTransaction(txnParam, mockParams);
        // convert to encoded obj for compatibility
        const encodedTxnObj = tx.get_obj_for_encoding() as Txn;
        encodedTxnObj.txID = tx.txID();
        txns.push(encodedTxnObj);
      }
      return [txns[0], txns]; // by default current txn is the first txn (hence txns[0])
    } else {
      // if not array, then create a single transaction
      const mockParams = mockSuggestedParams(txnParams.payFlags, this.round);
      const tx = mkTransaction(txnParams, mockParams);

      const encodedTxnObj = tx.get_obj_for_encoding() as Txn;
      encodedTxnObj.txID = tx.txID();
      return [encodedTxnObj, [encodedTxnObj]];
    }
  }

  // creates new asset creation transaction object.
  mkAssetCreateTx (
    name: string, flags: ASADeploymentFlags, asaDef: AssetParams): void {
    // this funtion is called only for validation of parameters passed
    algosdk.makeAssetCreateTxnWithSuggestedParams(
      flags.creator.addr,
      encodeNote(flags.note, flags.noteb64),
      BigInt(asaDef.total),
      Number(asaDef.decimals),
      asaDef.defaultFrozen ? asaDef.defaultFrozen : false,
      asaDef.manager ? asaDef.manager : "",
      asaDef.reserve ? asaDef.reserve : "",
      asaDef.freeze ? asaDef.freeze : "",
      asaDef.clawback ? asaDef.clawback : "",
      asaDef.unitName as string,
      name,
      asaDef.url as string,
      asaDef.metadataHash,
      mockSuggestedParams(flags, this.round)
    );
  }

  /**
   * Add Asset in Runtime
   * @param name ASA name
   * @param flags ASA Deployment Flags
   */
  addAsset (name: string, flags: ASADeploymentFlags): number {
    this.ctx.addAsset(name, flags.creator.addr, flags);

    this.store = this.ctx.state;
    return this.store.assetCounter;
  }

  /**
   * Asset Opt-In for account in Runtime
   * @param assetIndex Asset Index
   * @param address Account address to opt-into asset
   * @param flags Transaction Parameters
   */
  optIntoASA (assetIndex: number, address: AccountAddress, flags: TxParams): void {
    this.ctx.optIntoASA(assetIndex, address, flags);

    this.store = this.ctx.state;
  }

  /**
   * Returns Asset Holding from an account
   * @param assetIndex Asset Index
   * @param address address of account to get holding from
   */
  getAssetHolding (assetIndex: number, address: AccountAddress): AssetHoldingM {
    const account = this.assertAccountDefined(address, this.store.accounts.get(address));
    const assetHolding = account.getAssetHolding(assetIndex);
    if (assetHolding === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.TRANSACTION.ASA_NOT_OPTIN, {
        assetId: assetIndex,
        address: address
      });
    }
    return assetHolding;
  }

  // creates new application transaction object and update context
  addCtxAppCreateTxn (flags: SSCDeploymentFlags, payFlags: TxParams): void {
    const txn = algosdk.makeApplicationCreateTxn(
      flags.sender.addr,
      mockSuggestedParams(payFlags, this.round),
      algosdk.OnApplicationComplete.NoOpOC,
      new Uint8Array(32), // mock approval program
      new Uint8Array(32), // mock clear progam
      flags.localInts,
      flags.localBytes,
      flags.globalInts,
      flags.globalBytes,
      parseSSCAppArgs(flags.appArgs),
      flags.accounts,
      flags.foreignApps,
      flags.foreignAssets,
      flags.note,
      flags.lease,
      payFlags.rekeyTo);

    const encTx = { ...txn.get_obj_for_encoding(), txID: txn.txID() };
    this.ctx.tx = encTx;
    this.ctx.gtxs = [encTx];
  }

  /**
   * creates new application and returns application id
   * @param flags SSCDeployment flags
   * @param payFlags Transaction parameters
   * @param approvalProgram application approval program
   * @param clearProgram application clear program
   * @param debugStack: if passed then TEAL Stack is logged to console after
   * each opcode execution (upto depth = debugStack)
   * NOTE - approval and clear program must be the TEAL code as string (not compiled code)
   */
  addApp (
    flags: SSCDeploymentFlags, payFlags: TxParams,
    approvalProgram: string, clearProgram: string,
    debugStack?: number
  ): number {
    this.addCtxAppCreateTxn(flags, payFlags);
    this.ctx.debugStack = debugStack;
    this.ctx.addApp(flags.sender.addr, flags, approvalProgram, clearProgram);

    this.store = this.ctx.state;
    return this.store.appCounter;
  }

  // creates new OptIn transaction object and update context
  addCtxOptInTx (
    senderAddr: string,
    appID: number,
    payFlags: TxParams,
    flags: SSCOptionalFlags): void {
    const txn = algosdk.makeApplicationOptInTxn(
      senderAddr,
      mockSuggestedParams(payFlags, this.round),
      appID,
      parseSSCAppArgs(flags.appArgs),
      flags.accounts,
      flags.foreignApps,
      flags.foreignAssets,
      flags.note,
      flags.lease,
      payFlags.rekeyTo);

    const encTx = { ...txn.get_obj_for_encoding(), txID: txn.txID() };
    this.ctx.tx = encTx;
    this.ctx.gtxs = [encTx];
  }

  /**
   * Account address opt-in for application Id
   * @param accountAddr Account address
   * @param appID Application Id
   * @param flags Stateful smart contract transaction optional parameters (accounts, args..)
   * @param payFlags Transaction Parameters
   * @param debugStack: if passed then TEAL Stack is logged to console after
   * each opcode execution (upto depth = debugStack)
   */
  optInToApp (accountAddr: string, appID: number,
    flags: SSCOptionalFlags, payFlags: TxParams, debugStack?: number): void {
    this.addCtxOptInTx(accountAddr, appID, payFlags, flags);
    this.ctx.debugStack = debugStack;
    this.ctx.optInToApp(accountAddr, appID);

    this.store = this.ctx.state;
  }

  // creates new Update transaction object and update context
  addCtxAppUpdateTx (
    senderAddr: string,
    appID: number,
    payFlags: TxParams,
    flags: SSCOptionalFlags): void {
    const txn = algosdk.makeApplicationUpdateTxn(
      senderAddr,
      mockSuggestedParams(payFlags, this.round),
      appID,
      new Uint8Array(32), // mock approval program
      new Uint8Array(32), // mock clear progam
      parseSSCAppArgs(flags.appArgs),
      flags.accounts,
      flags.foreignApps,
      flags.foreignAssets,
      flags.note,
      flags.lease,
      payFlags.rekeyTo);

    const encTx = { ...txn.get_obj_for_encoding(), txID: txn.txID() };
    this.ctx.tx = encTx;
    this.ctx.gtxs = [encTx];
  }

  /**
   * Update application
   * @param senderAddr sender address
   * @param appID application Id
   * @param approvalProgram new approval program
   * @param clearProgram new clear program
   * @param payFlags Transaction parameters
   * @param flags Stateful smart contract transaction optional parameters (accounts, args..)
   * @param debugStack: if passed then TEAL Stack is logged to console after
   * each opcode execution (upto depth = debugStack)
   * NOTE - approval and clear program must be the TEAL code as string
   */
  updateApp (
    senderAddr: string,
    appID: number,
    approvalProgram: string,
    clearProgram: string,
    payFlags: TxParams,
    flags: SSCOptionalFlags,
    debugStack?: number
  ): void {
    this.addCtxAppUpdateTx(senderAddr, appID, payFlags, flags);
    this.ctx.debugStack = debugStack;
    this.ctx.updateApp(appID, approvalProgram, clearProgram);

    // If successful, Update programs and state
    this.store = this.ctx.state;
  }

  // verify 'amt' microalgos can be withdrawn from account
  assertMinBalance (amt: bigint, address: string): void {
    const account = this.getAccount(address);
    if ((account.amount - amt) < account.minBalance) {
      throw new RuntimeError(RUNTIME_ERRORS.TRANSACTION.INSUFFICIENT_ACCOUNT_BALANCE, {
        amount: amt,
        address: address
      });
    }
  }

  /**
   * Returns logic signature
   * @param program TEAL code
   * @param args arguments passed
   */
  getLogicSig (program: string, args: Uint8Array[]): LogicSig {
    if (program === "") {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.INVALID_PROGRAM);
    }
    const lsig = new LogicSig(program, args);
    const acc = new AccountStore(0, { addr: lsig.address(), sk: new Uint8Array(0) });
    this.store.accounts.set(acc.address, acc);
    return lsig;
  }

  /**
   * validate logic signature and teal logic
   * @param txnParam Transaction Parameters
   * @param debugStack: if passed then TEAL Stack is logged to console after
   * each opcode execution (upto depth = debugStack)
   */
  validateLsigAndRun (txnParam: ExecParams, debugStack?: number): void {
    // check if transaction is signed by logic signature,
    // if yes verify signature and run logic
    if (txnParam.sign === SignType.LogicSignature && txnParam.lsig) {
      this.ctx.args = txnParam.args ?? txnParam.lsig.args;

      // signature validation
      const fromAccountAddr = getFromAddress(txnParam);
      const result = txnParam.lsig.verify(decodeAddress(fromAccountAddr).publicKey);
      if (!result) {
        throw new RuntimeError(RUNTIME_ERRORS.GENERAL.LOGIC_SIGNATURE_VALIDATION_FAILED,
          { address: fromAccountAddr });
      }
      // logic validation
      const program = convertToString(txnParam.lsig.logic);
      if (program === "") {
        throw new RuntimeError(RUNTIME_ERRORS.GENERAL.INVALID_PROGRAM);
      }
      this.run(program, ExecutionMode.SIGNATURE, debugStack);
    } else {
      throw new RuntimeError(RUNTIME_ERRORS.GENERAL.LOGIC_SIGNATURE_NOT_FOUND);
    }
  }

  /**
   * This function executes a transaction based on a smart
   * contract logic and updates state afterwards
   * @param txnParams : Transaction parameters
   * @param debugStack: if passed then TEAL Stack is logged to console after
   * each opcode execution (upto depth = debugStack)
   */
  executeTx (txnParams: ExecParams | ExecParams[], debugStack?: number): void {
    const txnParameters = Array.isArray(txnParams) ? txnParams : [txnParams];
    for (const txn of txnParameters) {
      switch (txn.type) {
        case TransactionType.DeployASA: {
          txn.asaDef = this.loadedAssetsDefs[txn.asaName];
          break;
        }
        case TransactionType.DeploySSC: {
          txn.approvalProg = new Uint8Array(32); // mock approval program
          txn.clearProg = new Uint8Array(32); // mock clear program
          break;
        }
      }
    }
    const [tx, gtxs] = this.createTxnContext(txnParameters); // get current txn and txn group (as encoded obj)
    // validate first and last rounds
    this.validateTxRound(gtxs);

    // initialize context before each execution
    // state is a deep copy of store
    this.ctx = new Ctx(cloneDeep(this.store), tx, gtxs, [], this, debugStack);

    // Run TEAL program associated with each transaction and
    // then execute the transaction without interacting with store.
    this.ctx.processTransactions(txnParameters);

    // update store only if all the transactions are passed
    this.store = this.ctx.state;
  }

  /**
   * This function executes TEAL code line by line
   * @param program : teal code as string
   * @param executionMode : execution Mode (Stateless or Stateful)
   * @param debugStack: if passed then TEAL Stack is logged to console after
   * each opcode execution (upto depth = debugStack)
   * NOTE: Application mode is only supported in TEALv > 1
   */
  run (program: string, executionMode: ExecutionMode, debugStack?: number): void {
    const interpreter = new Interpreter();
    interpreter.execute(program, executionMode, this, debugStack);
  }
}
