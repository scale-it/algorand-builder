import { getPathFromDirRecursive, types as rtypes } from "@algo-builder/runtime";
import type { Account, EncodedMultisig, EncodedSignedTransaction } from "algosdk";
import { appendSignMultisigTransaction, decodeAddress, decodeSignedTransaction, encodeAddress, logicSigFromByte } from "algosdk";
import fs from "fs";

import { ASSETS_DIR } from "../internal/core/project-structure";

export const blsigExt = ".blsig";
const lsigExt = ".lsig";

/**
 * This function decodes msig object from logic signature
 * @param {String} name : multisig filename
 * @returns {MultiSig} : decoded msig (object with decoded public keys and their signatures)
 */
export async function decodeMsigObj (msig: string): Promise<EncodedMultisig> {
  const parsedMsig = JSON.parse(msig).msig;
  validateMsig(parsedMsig);

  // decoding multisigned logic signature
  for (const acc of parsedMsig.subsig) {
    acc.pk = decodeAddress(acc.pk).publicKey;
    if (acc.s) {
      acc.s = new Uint8Array(Buffer.from(acc.s, 'base64')); // decode base64 signature (signed pk)
    }
  }
  return parsedMsig;
}

/**
 * This function reads multisig from /assets/<filename>.lsig
 *              and returns the decoded multisig object
 * @param {string} msig : multisigned msig obj
 * @returns {MultiSig} : decoded Msig Object
 */
export async function readMsigFromFile (filename: string): Promise<EncodedMultisig | undefined> {
  if (!filename.endsWith(lsigExt)) {
    throw new Error(`filename "${filename}" must end with "${lsigExt}"`);
  }
  try {
    const p = getPathFromDirRecursive(ASSETS_DIR, filename) as string;
    const msig = fs.readFileSync(p, 'utf8').split("LogicSig: ")[1];
    return await decodeMsigObj(msig);
  } catch (e) {
    if (e?.errno === -2) return undefined; // handling a not existing file
    throw e;
  }
}

/**
 * This function reads raw multisig from /assets/<filename>.lsig
 * and returns the base64 string
 * @param {string} filename : filename [must have .blsig ext]
 * @returns {string} : base64 string
 */
export async function readBinaryMultiSig (filename: string): Promise<string | undefined> {
  if (!filename.endsWith(blsigExt)) {
    throw new Error(`filename "${filename}" must end with "${blsigExt}"`);
  }
  try {
    const p = getPathFromDirRecursive(ASSETS_DIR, filename) as string;
    return fs.readFileSync(p, 'base64');
  } catch (e) {
    if (e?.errno === -2) return undefined; // handling a not existing file
    throw e;
  }
}

/**
 * Loads signed logic signature directly from .blsig file
 * @param {string} name filename
 * @returns {LogicSig} signed logic signature from assets/<file_name>.blsig
 */
export async function loadBinaryLsig (name: string): Promise<rtypes.LogicSig> {
  const data = await readBinaryMultiSig(name);
  if (data === undefined) {
    throw new Error(`File ${name} does not exist`);
  }
  const program = new Uint8Array(Buffer.from(data, 'base64'));
  return logicSigFromByte(program) as rtypes.LogicSig;
}

/**
 * Validates msig by checking for v and thr field
 * @param {MultiSig} msig
 */
export function validateMsig (msig: EncodedMultisig | undefined): void {
  if (msig === undefined || msig.v === undefined || msig.thr === undefined) {
    throw new Error("Error fetching multisigned logic signature from file - invalid/undefined msig");
  }
}

/**
 * Signs a raw multi-sig transaction object
 * @param signerAccount
 * @param  rawTxn
 * @returns signed transaction object
 */
/*export function signMultiSig (signerAccount: Account, rawTxn: Uint8Array):
  { txID: string, blob: Uint8Array} {
  const decodedTxn = decodeSignedTransaction(rawTxn);
  console.debug("Decoded txn before signing: %O", decodedTxn);
  validateMsig(decodedTxn.msig);
  console.log("Msig: %O", decodedTxn.msig);
  const addresses = [];
  for (const sig of decodedTxn.msig.subsig) {
    addresses.push(encodeAddress(Uint8Array.from(sig.pk)));
  }
  const mparams = {
    version: decodedTxn.msig.v,
    threshold: decodedTxn.msig.thr,
    addrs: addresses
  };
  const signedTxn = appendSignMultisigTransaction(rawTxn, mparams, signerAccount.sk);
  const decodedSignedTxn = decodeSignedTransaction(signedTxn.blob);
  console.debug("Decoded txn after successfully signing: %O", decodedSignedTxn);
  console.log("Msig: %O", decodedSignedTxn.msig);
  return signedTxn;
}*/
