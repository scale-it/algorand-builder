import type { Transaction } from "algosdk";
import tx from "algosdk";
import { TextEncoder } from "util";

import {
  AlgobDeployer,
  ASADef,
  ASADeploymentFlags,
  execParams,
  TxParams
} from "../types";
import { ALGORAND_MIN_TX_FEE } from "./algo-operator";

export async function getSuggestedParams (algocl: tx.Algodv2): Promise<tx.SuggestedParams> {
  const params = await algocl.getTransactionParams().do();
  // Private chains may have an issue with firstRound
  if (params.firstRound === 0) {
    throw new Error("Suggested params returned 0 as firstRound. Ensure that your node progresses.");
    // params.firstRound = 1
  }
  return params;
}

export async function mkSuggestedParams (
  algocl: tx.Algodv2, userDefaults: TxParams): Promise<tx.SuggestedParams> {
  const s = await getSuggestedParams(algocl);

  s.flatFee = userDefaults.totalFee !== undefined;
  s.fee = userDefaults.totalFee ?? userDefaults.feePerByte ?? ALGORAND_MIN_TX_FEE;
  if (s.flatFee) s.fee = Math.max(s.fee, ALGORAND_MIN_TX_FEE);

  s.firstRound = userDefaults.firstValid ?? s.firstRound;
  s.lastRound = userDefaults.firstValid === undefined || userDefaults.validRounds === undefined
    ? s.lastRound
    : userDefaults.firstValid + userDefaults.validRounds;
  return s;
}

export function makeAssetCreateTxn (
  name: string, asaDef: ASADef, flags: ASADeploymentFlags, txSuggestedParams: tx.SuggestedParams
): tx.Transaction {
  // If TxParams has noteb64 or note , it gets precedence
  let note;
  if (flags.noteb64 ?? flags.note) {
    // TxParams note
    note = encodeNote(flags.note, flags.noteb64);
  } else if (asaDef.noteb64 ?? asaDef.note) {
    // ASA definition note
    note = encodeNote(asaDef.note, asaDef.noteb64);
  }

  // https://github.com/algorand/docs/blob/master/examples/assets/v2/javascript/AssetExample.js#L104
  return tx.makeAssetCreateTxnWithSuggestedParams(
    flags.creator.addr,
    note,
    asaDef.total,
    asaDef.decimals,
    asaDef.defaultFrozen,
    asaDef.manager,
    asaDef.reserve,
    asaDef.freeze,
    asaDef.clawback,
    asaDef.unitName,
    name,
    asaDef.url,
    asaDef.metadataHash,
    txSuggestedParams
  );
}

export function makeASAOptInTx (
  addr: string,
  assetID: number,
  params: tx.SuggestedParams
): tx.Transaction {
  const closeRemainderTo = undefined;
  const revocationTarget = undefined;
  const amount = 0;
  const note = undefined;
  return tx.makeAssetTransferTxnWithSuggestedParams(
    addr,
    addr,
    closeRemainderTo,
    revocationTarget,
    amount,
    note,
    assetID,
    params);
}

export function encodeNote (note: string | undefined, noteb64: string| undefined): Uint8Array | undefined {
  if (note === undefined && noteb64 === undefined) { return undefined; }
  const encoder = new TextEncoder();
  return noteb64 ? encoder.encode(noteb64) : encoder.encode(note);
}

async function mkTransaction (deployer: AlgobDeployer, txnParam: execParams): Promise<Transaction> {
  const params = await mkSuggestedParams(deployer.algodClient, txnParam.payFlags);
  const note = encodeNote(txnParam.payFlags.note, txnParam.payFlags.noteb64);

  switch (txnParam.type) {
    case "asset": {
      return tx.makeAssetTransferTxnWithSuggestedParams(
        txnParam.fromAccount.addr,
        txnParam.toAccountAddr,
        txnParam.payFlags.closeRemainderTo,
        undefined,
        txnParam.amount,
        note,
        txnParam.assetID,
        params);
    }
    case "algo": {
      return tx.makePaymentTxnWithSuggestedParams(
        txnParam.fromAccount.addr,
        txnParam.toAccountAddr,
        txnParam.amountMicroAlgos,
        txnParam.payFlags.closeRemainderTo,
        note,
        params);
    }
    case "clearSSC": {
      return tx.makeApplicationClearStateTxn(txnParam.fromAccount.addr, params, txnParam.appId);
    }
    case "deleteSSC": {
      return tx.makeApplicationDeleteTxn(txnParam.fromAccount.addr, params, txnParam.appId);
    }
    case "callNoOpSSC": {
      return tx.makeApplicationNoOpTxn(
        txnParam.fromAccount.addr,
        params,
        txnParam.appId,
        txnParam.appArgs,
        txnParam.accounts,
        txnParam.foreignApps,
        txnParam.foreignAssets,
        note,
        txnParam.lease,
        txnParam.rekeyTo);
    }
    case "closeSSC": {
      return tx.makeApplicationCloseOutTxn(txnParam.fromAccount.addr, params, txnParam.appId);
    }
    default: {
      throw new Error("Unknown type of transaction");
    }
  }
}

function signTransaction (txn: Transaction, txnParam: execParams): Uint8Array {
  switch (txnParam.sign) {
    case "sk": {
      return txn.signTxn(txnParam.fromAccount.sk);
    }
    case "lsig": {
      const logicsig = txnParam.lsig;
      if (logicsig === undefined) {
        throw new Error("Lsig undefined");
      }
      return tx.signLogicSigTransactionObject(txn, logicsig).blob;
    }
    default: {
      throw new Error("Unknown type of signature");
    }
  }
}

async function sendAndWait (
  deployer: AlgobDeployer,
  txns: Uint8Array | Uint8Array[]): Promise<tx.ConfirmedTxInfo> {
  const txInfo = (await deployer.algodClient.sendRawTransaction(txns).do());
  return await deployer.waitForConfirmation(txInfo.txId);
}

export async function executeTransaction (
  deployer: AlgobDeployer,
  txnParams: execParams | execParams[]): Promise<tx.ConfirmedTxInfo> {
  if (Array.isArray(txnParams)) {
    if (txnParams.length > 16) {
      throw new Error("Maximum size of an atomic transfer group is 16");
    }

    const txns = [];
    for (const txnParam of txnParams) {
      const txn = await mkTransaction(deployer, txnParam);
      txns.push(txn);
    }
    tx.assignGroupID(txns);

    const signedTxns = [] as Uint8Array[];
    txns.forEach((txn, index) => {
      signedTxns.push(signTransaction(txn, txnParams[index]));
    });

    return await sendAndWait(deployer, signedTxns);
    // txwriter log
  } else {
    const txn = await mkTransaction(deployer, txnParams);
    const signedTxn = signTransaction(txn, txnParams);
    return await sendAndWait(deployer, signedTxn);
  }
}
