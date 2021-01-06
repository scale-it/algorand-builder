import tx, { Account as AccountSDK, ConfirmedTxInfo, decodeAddress } from "algosdk";

import { AlgobDeployer, TxParams } from "../types";
import { mkTxParams } from "./tx";

// returns parsed string to Uint8Array
export function toBytes (s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s));
}

/**
 * Converts integer to bytes in big endian.
 */
export function intToBigEndian (x: number): Uint8Array {
  const y = Math.floor(x / 2 ** 32);
  const byt = [y, (y << 8), (y << 16), (y << 24), x, (x << 8), (x << 16), (x << 24)].map(z => z >>> 24);
  return new Uint8Array(byt);
}

/**
 * Description: Converts address to Bytes
 * @param addr : algorand address
 */
export function addressToBytes (addr: string): Uint8Array {
  return decodeAddress(addr).publicKey;
}

/**
 * Description: Transaction to update TEAL Programs for a contract.
 * @param deployer AlgobDeployer
 * @param sender Account from which call needs to be made
 * @param payFlags Transaction Flags
 * @param appId ID of the application being configured or empty if creating
 * @param newApprovalProgram New Approval Program filename
 * @param newClearProgram New Clear Program filename
 */
export async function update (
  deployer: AlgobDeployer,
  sender: AccountSDK,
  payFlags: TxParams,
  appId: number,
  newApprovalProgram: string,
  newClearProgram: string,
  appArgs?: Uint8Array[]
): Promise<ConfirmedTxInfo> {
  const params = await mkTxParams(deployer.algodClient, payFlags);

  const app = await deployer.ensureCompiled(newApprovalProgram, false);
  const approvalProg = new Uint8Array(Buffer.from(app.compiled, "base64"));
  const clear = await deployer.ensureCompiled(newClearProgram, false);
  const clearProg = new Uint8Array(Buffer.from(clear.compiled, "base64"));

  const txn = tx.makeApplicationUpdateTxn(sender.addr, params, appId, approvalProg, clearProg, appArgs);

  const txId = txn.txID().toString();
  const signedTxn = txn.signTxn(sender.sk);
  await deployer.algodClient.sendRawTransaction(signedTxn).do();
  return await deployer.waitForConfirmation(txId);
}
