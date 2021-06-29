import { types as rtypes } from "@algo-builder/runtime";
import * as algosdk from "algosdk";

import type {
  ASCCache,
  Deployer,
  FundASCFlags,
  LsigInfo
} from "../../src/types";

export class FakeDeployer implements Deployer {
  asa = new Map<string, rtypes. ASAInfo>();
  ssc = new Map<string, rtypes.SSCInfo>();
  lsig = new Map<string, LsigInfo>();
  isDeployMode = false;
  accounts = [];
  accountsByName = new Map<string, rtypes.Account>();
  scriptName = '';
  checkpoint = {
    getSSCfromCPKey (key: string): rtypes.SSCInfo | undefined {
      throw new Error("Not implemented");
    },

    getAppCheckpointKeyFromIndex (index: number): string | undefined {
      throw new Error("Not implemented");
    },

    getAssetCheckpointKeyFromIndex (index: number): string | undefined {
      throw new Error("Not implemented");
    },

    getLatestTimestampValue (map: Map<number, rtypes.SSCInfo>): number {
      throw new Error("Not implemented");
    }
  };

  assertNoAsset (name: string): void {
    throw new Error("Not implemented");
  }

  getASAInfo (name: string): rtypes.ASAInfo {
    throw new Error("Not implemented");
  }

  getASADef (name: string): rtypes.ASADef {
    throw new Error("Not implemented");
  }

  persistCP (): void {
    throw new Error("Not implemented");
  }

  logTx (message: string, txConfirmation: algosdk.PendingTransactionResponse): void {
    throw new Error("Not implemented");
  }

  sendAndWait (rawTxns: Uint8Array | Uint8Array[]): Promise<algosdk.PendingTransactionResponse> {
    throw new Error("Not implemented");
  }

  registerASAInfo (name: string, asaInfo: rtypes.ASAInfo): void {
    throw new Error("Not implemented");
  }

  registerSSCInfo (name: string, sscInfo: rtypes.SSCInfo): void {
    throw new Error("Not implemented");
  }

  setScriptName (name: string): void {
    this.scriptName = name;
  }

  log (msg: string, obj: any): void {
    throw new Error("Not implemented");
  }

  getSSC (nameApproval: string, nameClear: string): rtypes.SSCInfo | undefined {
    throw new Error("Not implemented");
  }

  getSSCfromCPKey (key: string): rtypes.SSCInfo | undefined {
    throw new Error("Not implemented");
  }

  getAppCheckpointKeyFromIndex (index: number): string | undefined {
    throw new Error("Not implemented");
  }

  getAssetCheckpointKeyFromIndex (index: number): string | undefined {
    throw new Error("Not implemented");
  }

  getDelegatedLsig (lsig: string): object | undefined {
    throw new Error("Not implemented");
  }

  async loadLogic (name: string, scInitParam?: unknown): Promise<rtypes.LogicSig> {
    throw new Error("Not implemented");
  }

  loadMultiSig (name: string): Promise<rtypes.LogicSig> {
    throw new Error("Not implemented");
  }

  addCheckpointKV (key: string, value: string): void {
  };

  getCheckpointKV (key: string): string | undefined {
    return "metadata";
  };

  async deployASA (name: string, flags: rtypes.ASADeploymentFlags): Promise<rtypes.ASAInfo> {
    throw new Error("Not implemented");
  };

  loadASADef (asaName: string): rtypes.ASADef | undefined {
    throw new Error("Not implemented");
  }

  async fundLsig (name: string, flags: FundASCFlags,
    payFlags: rtypes.TxParams, scInitParam?: unknown): Promise<void> {
    throw new Error("Not implemented");
  }

  async mkDelegatedLsig (name: string, signer: rtypes.Account,
    scInitParam?: unknown): Promise<LsigInfo> {
    throw new Error("Not implemented");
  }

  async deploySSC (
    approvalProgram: string,
    clearProgram: string,
    flags: rtypes.SSCDeploymentFlags,
    payFlags: rtypes.TxParams): Promise<rtypes.SSCInfo> {
    throw new Error("Not implemented");
  }

  async updateSSC (
    sender: algosdk.Account,
    payFlags: rtypes.TxParams,
    appID: number,
    newApprovalProgram: string,
    newClearProgram: string,
    flags: rtypes.SSCOptionalFlags
  ): Promise<rtypes.SSCInfo> {
    throw new Error("Not implemented");
  }

  async ensureCompiled (name: string, force?: boolean, scInitParam?: unknown): Promise<ASCCache> {
    throw new Error("Not implemented");
  }

  assertCPNotDeleted (execParams: rtypes.ExecParams | rtypes.ExecParams[]): void {
    throw new Error("Not implemented");
  }

  isDefined (name: string): boolean {
    return false;
  };

  get algodClient (): algosdk.Algodv2 {
    throw new Error("Not implemented");
  };

  getAssetByID (assetIndex: number | bigint): Promise<algosdk.modelsv2.Asset> {
    throw new Error("Not implemented");
  }

  waitForConfirmation (txId: string): Promise<algosdk.PendingTransactionResponse> {
    throw new Error("Not implemented");
  }

  optInAcountToASA (asa: string, accountName: string, flags: rtypes.TxParams): Promise<void> {
    throw new Error("Not implemented");
  }

  optInLsigToASA (asa: string, lsig: rtypes.LogicSig, flags: rtypes.TxParams): Promise<void> {
    throw new Error("Not implemented");
  }

  optInAccountToSSC (
    sender: rtypes.Account, index: number, payFlags: rtypes.TxParams,
    flags: rtypes.SSCOptionalFlags): Promise<void> {
    throw new Error("Not implemented");
  }

  optInLsigToSSC (
    appID: number, lsig: rtypes.LogicSig,
    payFlags: rtypes.TxParams, flags: rtypes.SSCOptionalFlags): Promise<void> {
    throw new Error("not implemented.");
  }
}
