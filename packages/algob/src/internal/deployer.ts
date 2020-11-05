import { decode, encode } from "@msgpack/msgpack";
import * as algosdk from "algosdk";

import { txWriter } from "../internal/tx-log-writer";
import { AlgoOperator } from "../lib/algo-operator";
import { getDummyLsig, getLsig } from "../lib/lsig";
import { readBinaryMultiSig, readMsigFromFile } from "../lib/msig";
import { persistCheckpoint } from "../lib/script-checkpoints";
import type {
  Account,
  Accounts,
  AlgobDeployer,
  AlgobRuntimeEnv,
  ASADefs,
  ASADeploymentFlags,
  ASAInfo,
  CheckpointRepo,
  FundASCFlags,
  LogicSig,
  LsigInfo,
  RawLsig,
  SSCDeploymentFlags,
  SSCInfo,
  TxParams
} from "../types";
import { BuilderError } from "./core/errors";
import { ERRORS } from "./core/errors-list";

// Base class for deployer Run Mode (read access) and Deploy Mode (read and write access)
class DeployerBasicMode {
  protected readonly runtimeEnv: AlgobRuntimeEnv;
  protected readonly cpData: CheckpointRepo;
  protected readonly loadedAsaDefs: ASADefs;
  protected readonly algoOp: AlgoOperator;
  protected readonly txWriter: txWriter;
  readonly accounts: Account[];
  readonly accountsByName: Accounts;

  constructor (
    runtimeEnv: AlgobRuntimeEnv,
    cpData: CheckpointRepo,
    asaDefs: ASADefs,
    algoOp: AlgoOperator,
    accountsByName: Accounts,
    txWriter: txWriter
  ) {
    this.runtimeEnv = runtimeEnv;
    this.cpData = cpData;
    this.loadedAsaDefs = asaDefs;
    this.algoOp = algoOp;
    this.accounts = runtimeEnv.network.config.accounts;
    this.accountsByName = accountsByName;
    this.txWriter = txWriter;
  }

  protected get networkName (): string {
    return this.runtimeEnv.network.name;
  }

  getMetadata (key: string): string | undefined {
    return this.cpData.getMetadata(this.networkName, key);
  }

  isDefined (name: string): boolean {
    return this.cpData.isDefined(this.networkName, name);
  }

  get asa (): Map<string, ASAInfo> {
    return this.cpData.precedingCP[this.networkName]?.asa ?? new Map();
  }

  get ssc (): Map<string, SSCInfo> {
    return this.cpData.precedingCP[this.networkName]?.ssc ?? new Map();
  }

  get algodClient (): algosdk.Algodv2 {
    return this.algoOp.algodClient;
  }

  async waitForConfirmation (txId: string): Promise<algosdk.ConfirmedTxInfo> {
    return await this.algoOp.waitForConfirmation(txId);
  }

  log (msg: string, obj: any): void {
    this.txWriter.push(msg, obj);
  }

  /**
   * @param lsigName Description: loads and returns delegated logic signature from checkpoint
   */
  getDelegatedLsig (lsigName: string): Object | undefined {
    const resultMap = this.cpData.precedingCP[this.networkName]?.dLsig ?? new Map(); ;
    const result = resultMap.get(lsigName)?.lsig;
    if (result === undefined) { return undefined; }
    const lsig1 = decode(result);
    const lsig = getDummyLsig();
    Object.assign(lsig, lsig1);
    return lsig;
  }

  /**
   * Description : loads logic signature for contract mode
   * @param name ASC name
   * @param scParams parameters
   */
  async loadLsig (name: string, scParams: Object): Promise<LogicSig> {
    return await getLsig(name, scParams, this.algoOp.algodClient);
  }

  /**
   * Description : loads multisigned logic signature from .msig file
   * @param {string} name filename
   * @param {Object} scParams parameters
   * @returns {LogicSig} multi signed logic signature from assets/<file_name>.msig
   */
  async loadMultiSig (name: string, scParams: Object): Promise<LogicSig> {
    const lsig = await getLsig(name, scParams, this.algoOp.algodClient); // get lsig from .teal (getting logic part from lsig)
    const msig = await readMsigFromFile(name); // Get decoded Msig object from .msig
    Object.assign(lsig.msig = {}, msig);
    return lsig;
  }

  /**
   * Description : loads multisigned logic signature from .msig file
   * @param {string} name filename
   * @returns {LogicSig} multi signed logic signature from assets/<file_name>.msig
   */
  async loadBinaryMultiSig (name: string): Promise<LogicSig> {
    // get logic signature from file and decode it
    const data = await readBinaryMultiSig(name);
    const program = new Uint8Array(Buffer.from(data as string, 'base64'));
    const logicSignature = decode(program) as RawLsig;
    const lsig = getDummyLsig(); // dummy logic signature

    // assign complete logic signature
    lsig.logic = logicSignature.l as Uint8Array; // assign logic part separately (as keys mismatch: logic, l)
    delete logicSignature.l;
    Object.assign(lsig, logicSignature);
    return lsig;
  }
}

// This class is what user interacts with in deploy task
export class DeployerDeployMode extends DeployerBasicMode implements AlgobDeployer {
  get isDeployMode (): boolean {
    return true;
  }

  putMetadata (key: string, value: string): void {
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

  private assertNoAsset (name: string): void {
    if (this.isDefined(name)) {
      persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASSET_ALREADY_PRESENT, {
          assetName: name
        });
    }
  }

  private _getASAInfo (name: string): ASAInfo {
    const found = this.asa.get(name);
    if (!found) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_NOT_DEFINED, {
          assetName: name
        });
    }
    return found;
  }

  private _getAccount (name: string): Account {
    const found = this.accountsByName.get(name);
    if (!found) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.ACCOUNT_NOT_FOUND, {
          assetName: name
        });
    }
    return found;
  }

  async deployASA (name: string, flags: ASADeploymentFlags): Promise<ASAInfo> {
    if (this.loadedAsaDefs[name] === undefined) {
      persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_DEF_NOT_FOUND, {
          asaName: name
        });
    }
    this.assertNoAsset(name);
    let asaInfo = {} as any;
    try {
      asaInfo = await this.algoOp.deployASA(
        name, this.loadedAsaDefs[name], flags, this.accountsByName, this.txWriter);
    } catch (error) {
      persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);

      console.log(error);
      throw error;
    }

    this.cpData.registerASA(this.networkName, name, asaInfo);

    try {
      await this.algoOp.optInToASAMultiple(
        name,
        this.loadedAsaDefs[name],
        flags,
        this.accountsByName,
        asaInfo.assetIndex);
    } catch (error) {
      persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);

      console.log(error);
      throw error;
    }

    return asaInfo;
  }

  /**
   * Description - This function will send Algos to ASC account in "Contract Mode"
   * @param name     - ASC filename
   * @param scParams - SC parameters
   * @param flags    - Deployments flags (as per SPEC)
   * @param payFlags - as per SPEC
   */
  async fundLsig (name: string, scParams: Object, flags: FundASCFlags,
    payFlags: TxParams): Promise<void> {
    try {
      await this.algoOp.fundLsig(name, scParams, flags, payFlags, this.txWriter);
    } catch (error) {
      console.log(error);
      throw error;
    }
  }

  /**
   * Description - This function will create and sign a logic signature for "delegated approval".
   * https://developer.algorand.org/docs/features/asc1/stateless/sdks/#account-delegation-sdk-usage
   * @param name     - ASC name
   * @param scParams - SC parameters
   * @param signer   - signer
   */
  async mkDelegatedLsig (name: string, scParams: Object, signer: Account): Promise<LsigInfo> {
    this.assertNoAsset(name);
    let lsigInfo = {} as any;
    try {
      const lsig = await getLsig(name, scParams, this.algoOp.algodClient);
      lsig.sign(signer.sk);
      lsigInfo = {
        creator: signer.addr,
        contractAddress: lsig.address(),
        lsig: encode(lsig)
      };
    } catch (error) {
      persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);

      console.log(error);
      throw error;
    }
    this.cpData.registerLsig(this.networkName, name, lsigInfo);
    return lsigInfo;
  }

  /**
   * Description: function to deploy stateful smart contracts
   * @param approvalProgram filename which has approval program
   * @param clearProgram filename which has clear program
   * @param flags SSCDeploymentFlags
   * @param payFlags Transaction Params
   */
  async deploySSC (
    approvalProgram: string,
    clearProgram: string,
    flags: SSCDeploymentFlags,
    payFlags: TxParams): Promise<SSCInfo> {
    const name = approvalProgram + "-" + clearProgram;
    this.assertNoAsset(name);
    let sscInfo = {} as any;
    try {
      sscInfo = await this.algoOp.deploySSC(
        approvalProgram, clearProgram, flags, payFlags, this.txWriter);
    } catch (error) {
      persistCheckpoint(this.txWriter.scriptName, this.cpData.strippedCP);

      console.log(error);
      throw error;
    }

    this.cpData.registerSSC(this.networkName, name, sscInfo);

    return sscInfo;
  }

  async optInToASA (name: string, accountName: string, flags: TxParams): Promise<void> {
    await this.algoOp.optInToASA(
      name,
      this._getASAInfo(name).assetIndex,
      this._getAccount(accountName),
      flags);
  }

  async OptInToSSC (sender: Account, index: number, payFlags: TxParams): Promise<void> {
    await this.algoOp.OptInToSSC(sender, index, payFlags);
  }
}

// This class is what user interacts with in run task
export class DeployerRunMode extends DeployerBasicMode implements AlgobDeployer {
  get isDeployMode (): boolean {
    return false;
  }

  putMetadata (_key: string, _value: string): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "putMetadata"
    });
  }

  async deployASA (_name: string, _flags: ASADeploymentFlags): Promise<ASAInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "deployASA"
    });
  }

  async fundLsig (_name: string, scParams: Object, flags: FundASCFlags,
    payFlags: TxParams): Promise<LsigInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "fundLsig"
    });
  }

  async mkDelegatedLsig (_name: string, scParams: Object, signer: Account): Promise<LsigInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "delegatedLsig"
    });
  }

  async deploySSC (
    approvalProgram: string,
    clearProgram: string,
    flags: SSCDeploymentFlags,
    payFlags: TxParams): Promise<SSCInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "deploySSC"
    });
  }

  optInToASA (name: string, accountName: string, flags: ASADeploymentFlags): Promise<void> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "optInToASA"
    });
  }

  OptInToSSC (sender: Account, index: number, payFlags: TxParams): Promise<void> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "optInToSSC"
    });
  }
}
