import * as algosdk from "algosdk";

import { BuilderError } from "../internal/core/errors";
import { ERRORS } from "../internal/core/errors-list";
import {
  Account,
  Accounts,
  AlgobDeployer,
  AlgobRuntimeEnv,
  ASADefs,
  ASADeploymentFlags,
  ASAInfo,
  ASCInfo,
  CheckpointRepo
} from "../types";
import { mkAccountIndex } from "./account";
import { AlgoActions } from "./algo-client";

// This class is what user interacts with in deploy task
export class AlgobDeployerImpl implements AlgobDeployer {
  private readonly runtimeEnv: AlgobRuntimeEnv;
  private readonly cpData: CheckpointRepo;
  private readonly loadedAsaDefs: ASADefs;
  private readonly algoActions: AlgoActions;
  readonly accounts: Accounts;

  constructor (
    runtimeEnv: AlgobRuntimeEnv, cpData: CheckpointRepo, asaDefs: ASADefs, algoActions: AlgoActions
  ) {
    this.runtimeEnv = runtimeEnv;
    this.cpData = cpData;
    this.loadedAsaDefs = asaDefs;
    this.algoActions = algoActions;
    this.accounts = mkAccountIndex(runtimeEnv.network.config.accounts);
  }

  get isDeployMode (): boolean {
    return true;
  }

  private get networkName (): string {
    return this.runtimeEnv.network.name;
  }

  putMetadata (key: string, value: string): void {
    if (this.cpData.getMetadata(this.networkName, key) === value) {
      return;
    }
    if (this.cpData.getMetadata(this.networkName, key)) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_METADATA_ALREADY_PRESENT, {
          metadataKey: key
        });
    }
    this.cpData.putMetadata(this.networkName, key, value);
  }

  getMetadata (key: string): string | undefined {
    return this.cpData.getMetadata(this.networkName, key);
  }

  private assertNoAsset (name: string): void {
    if (this.isDefined(name)) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASSET_ALREADY_PRESENT, {
          assetName: name
        });
    }
  }

  async deployASA (name: string, flags: ASADeploymentFlags): Promise<ASAInfo> {
    if (this.loadedAsaDefs[name] === undefined) {
      throw new BuilderError(
        ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_DEF_NOT_FOUND, {
          asaName: name
        });
    }
    const asaDef = this.loadedAsaDefs[name];
    const creator = flags.creator;
    this.assertNoAsset(name);
    const asaInfo = await this.algoActions.deployASA(name, asaDef, flags, creator);
    this.cpData.registerASA(this.networkName, name, asaInfo);
    return this.cpData.precedingCP[this.networkName].asa[name];
  }

  async deployASC (name: string, source: string, account: Account): Promise<ASCInfo> {
    this.assertNoAsset(name);
    this.cpData.registerASC(this.networkName, name, {
      creator: account.addr + "-get-address-dry-run",
      txId: "tx-id-dry-run",
      confirmedRound: -1
    });
    return this.cpData.precedingCP[this.networkName].asc[name];
  }

  isDefined (name: string): boolean {
    return this.cpData.isDefined(this.networkName, name);
  }

  get algodClient (): algosdk.Algodv2 {
    return this.algoActions.algodClient;
  }

  async waitForConfirmation (txId: string): Promise<algosdk.ConfirmedTxInfo> {
    return await this.algoActions.waitForConfirmation(txId);
  }
}

// This class is what user interacts with in run task
export class AlgobDeployerReadOnlyImpl implements AlgobDeployer {
  private readonly _internal: AlgobDeployer;

  constructor (deployer: AlgobDeployer) {
    this._internal = deployer;
  }

  get accounts (): Accounts {
    return this._internal.accounts;
  }

  get isDeployMode (): boolean {
    return false;
  }

  putMetadata (_key: string, _value: string): void {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "putMetadata"
    });
  }

  getMetadata (key: string): string | undefined {
    return this._internal.getMetadata(key);
  }

  async deployASA (_name: string, _flags: ASADeploymentFlags): Promise<ASAInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "deployASA"
    });
  }

  async deployASC (_name: string, _source: string, _account: Account): Promise<ASCInfo> {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.DEPLOYER_EDIT_OUTSIDE_DEPLOY, {
      methodName: "deployASC"
    });
  }

  isDefined (name: string): boolean {
    return this._internal.isDefined(name);
  }

  get algodClient (): algosdk.Algodv2 {
    return this._internal.algodClient;
  }

  async waitForConfirmation (txId: string): Promise<algosdk.ConfirmedTxInfo> {
    return await this._internal.waitForConfirmation(txId);
  }
}
