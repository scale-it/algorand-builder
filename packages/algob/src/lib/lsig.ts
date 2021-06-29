/* eslint @typescript-eslint/no-var-requires: "off" */
import { types as rtypes } from "@algo-builder/runtime";
import type { MultisigMetadata } from "algosdk";
import algosdk from "algosdk";

import type { ASCCache, SCParams } from "../types";
import { CompileOp } from "./compile";

/**
 * Make logic signature from .teal file
 * @param name : ASC filename
 * @param algodClient : algodClient
 * @param scTmplParams: Smart contract template parameters (used only when compiling PyTEAL to TEAL)
 */
export async function getLsig (
  name: string,
  algodClient: algosdk.Algodv2,
  scTmplParams?: SCParams):
  Promise<rtypes.LogicSig> {
  const compileOp = new CompileOp(algodClient);
  const result: ASCCache = await compileOp.ensureCompiled(name, false, scTmplParams);
  const program = result.base64ToBytes;
  const lsig = algosdk.makeLogicSig(program, []) as rtypes.LogicSig;
  // below line saves data in cp is {tag: <value>} which we need, otherwise it'll save as
  // { type: 'buffer', data: <value> } and throws error upon running examples
  if (lsig.tag) { lsig.tag = Buffer.from(lsig.tag); }
  return lsig;
}

/**
 * Create and return a dummy logic signature
 */
export function getDummyLsig (): rtypes.LogicSig {
  return algosdk.makeLogicSig(new Uint8Array(56), []) as rtypes.LogicSig;
}

/**
 * Appends signature (using signer's sk) to multi-signed logic signature. If multisig is not found
 * then new multisig is created
 * eg. appending own signature to a signed lsig (received from multisignature account address network)
 * @param lsig Logic Sig object
 * @param signer: Signer Account which will sign the smart contract
 * @param mparams: passed when signing a new multisig
 * @returns multi signed logic signature (with appended signature using signer's sk)
 */
export function signLogicSigMultiSig (lsig: rtypes.LogicSig, signer: rtypes.Account,
  mparams?: MultisigMetadata): rtypes.LogicSig {
  if (lsig.msig === undefined) { // if multisig not found, create new msig
    if (mparams === undefined) {
      throw new Error('MultiSig Metadata is undefined, which is required for single sign multisig');
    }
    lsig.sign(signer.sk, mparams);
  } else {
    lsig.appendToMultisig(signer.sk); // else append signature to msig
  }
  return lsig;
}
