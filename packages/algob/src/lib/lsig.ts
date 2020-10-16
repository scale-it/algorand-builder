/* eslint @typescript-eslint/no-var-requires: "off" */
import algosdk from "algosdk";

import { ASCCache } from "../types";
import { CompileOp } from "./compile";
export const logicsig = require("algosdk/src/logicsig");

/**
 * Description: this function makes logic signature from .teal file
 * @param name : ASC filename
 * @param scParams : parameters
 * @param algodClient : algodClient
 */
export async function getLsig (name: string, scParams: Object, algodClient: algosdk.Algodv2): Promise<any> {
  const compileOp = new CompileOp(algodClient);
  const result: ASCCache = await compileOp.ensureCompiled(name, false);
  const program = new Uint8Array(Buffer.from(result.compiled, "base64"));
  return algosdk.makeLogicSig(program, scParams);
}
