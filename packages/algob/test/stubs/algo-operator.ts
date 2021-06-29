import { types as rtypes } from "@algo-builder/runtime";
import { Account, Algodv2, modelsv2, PendingTransactionResponse } from "algosdk";

import { txWriter } from "../../src/internal/tx-log-writer";
import { AlgoOperator } from "../../src/lib/algo-operator";
import {
  ASCCache,
  FundASCFlags,
  LsigInfo
} from "../../src/types";
import { mockAlgod, mockAssetInfo, mockConfirmedTx } from "../mocks/tx";

export class AlgoOperatorDryRunImpl implements AlgoOperator {
  get algodClient (): Algodv2 {
    return mockAlgod;
  };

  getDelegatedLsig (lsig: string): Object | undefined {
    throw new Error("Not implemented");
  }

  getAssetByID (assetIndex: number | bigint): Promise<modelsv2.Asset> {
    return new Promise((resolve, reject) => {
      assetIndex === 1n ? resolve(mockAssetInfo) : reject(new Error("Not implemented"));
    });
  }

  sendAndWait (rawTxns: Uint8Array | Uint8Array[]): Promise<PendingTransactionResponse> {
    return new Promise((resolve, reject) => {
      resolve(mockConfirmedTx);
    });
  }

  /* eslint-disable sonarjs/no-identical-functions */
  waitForConfirmation (txId: string): Promise<PendingTransactionResponse> {
    return new Promise((resolve, reject) => {
      resolve(mockConfirmedTx);
    });
  }

  async deployASA (
    name: string, asaDef: rtypes.ASADef,
    flags: rtypes.ASADeploymentFlags, accounts: rtypes.AccountMap,
    txnWriter: txWriter): Promise<rtypes.ASAInfo> {
    return {
      creator: String(flags.creator.addr) + "-get-address-dry-run",
      txId: "tx-id-dry-run",
      assetIndex: 1,
      confirmedRound: -1,
      assetDef: asaDef,
      deleted: false
    };
  }

  async fundLsig (
    name: string, flags: FundASCFlags, payFlags: rtypes.TxParams,
    txnWriter: txWriter, scInitParam?: unknown): Promise<LsigInfo> {
    return {
      creator: String(flags.funder.addr) + "-get-address-dry-run",
      contractAddress: "dfssdfsd",
      lsig: {} as rtypes.LogicSig
    };
  }

  async deploySSC (
    approvalProgram: string,
    clearProgram: string,
    flags: rtypes.SSCDeploymentFlags,
    payFlags: rtypes.TxParams,
    txWriter: txWriter,
    scInitParam?: unknown): Promise<rtypes.SSCInfo> {
    return {
      creator: String(flags.sender.addr) + "-get-address-dry-run",
      txId: "tx-id-dry-run",
      confirmedRound: -1,
      appID: 33,
      timestamp: 1,
      deleted: false
    };
  }

  async updateSSC (
    sender: Account,
    payFlags: rtypes.TxParams,
    appID: number,
    newApprovalProgram: string,
    newClearProgram: string,
    flags: rtypes.SSCOptionalFlags,
    txWriter: txWriter
  ): Promise<rtypes.SSCInfo> {
    return {
      creator: String(sender.addr) + "-get-address-dry-run",
      txId: "tx-id-dry-run",
      confirmedRound: -1,
      appID: 33,
      timestamp: 2,
      deleted: false
    };
  }

  async ensureCompiled (name: string, force?: boolean, scInitParam?: unknown): Promise<ASCCache> {
    return {
      filename: name,
      timestamp: 1010, // compilation time (Unix time)
      compiled: "ASDF", // the compiled code
      compiledHash: "ASDF", // hash returned by the compiler
      srcHash: 123, // source code hash
      base64ToBytes: new Uint8Array(1) // compiled base64 in bytes
    };
  }

  optInAcountToASA (
    asaName: string, assetIndex: number, account: rtypes.Account,
    params: rtypes.TxParams): Promise<void> {
    return new Promise((resolve, reject) => { resolve(); });
  }

  optInLsigToASA (
    asaName: string, assetIndex: number, lsig: rtypes.LogicSig, flags: rtypes.TxParams
  ): Promise<void> {
    return new Promise((resolve, reject) => { resolve(); });
  }

  optInAccountToSSC (
    sender: rtypes.Account, index: number,
    payFlags: rtypes.TxParams, flags: rtypes.SSCOptionalFlags): Promise<void> {
    return new Promise((resolve, reject) => { resolve(); });
  }

  optInLsigToSSC (
    appId: number, lsig: rtypes.LogicSig,
    payFlags: rtypes.TxParams, flags: rtypes.SSCOptionalFlags): Promise<void> {
    return new Promise((resolve, reject) => { resolve(); });
  }

  optInToASAMultiple (
    asaName: string, asaDef: rtypes.ASADef,
    flags: rtypes.ASADeploymentFlags, accounts: rtypes.AccountMap, assetIndex: number
  ): Promise<void> {
    return Promise.resolve();
  }
}
