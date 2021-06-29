import { getPathFromDirRecursive } from "@algo-builder/runtime";
import type { Algodv2, CompileResponse } from "algosdk";
import { spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from 'fs';
import * as murmurhash from 'murmurhash';
import * as path from 'path';
import YAML from "yaml";

import { BuilderError, parseAlgorandError } from "../errors/errors";
import { ERRORS } from "../errors/errors-list";
import { assertDir, ASSETS_DIR, CACHE_DIR } from "../internal/core/project-structure";
import { timestampNow } from "../lib/time";
import type { ASCCache, PyASCCache, ReplaceParams, SCParams } from "../types";

export const tealExt = ".teal";
export const pyExt = ".py";
export const lsigExt = ".lsig";

export class CompileOp {
  algocl: Algodv2;
  pyCompile: PyCompileOp;
  cacheAssured = false;

  constructor (algocl: Algodv2) {
    this.algocl = algocl;
    this.pyCompile = new PyCompileOp(this);
  }

  /** Gets the TEAL compiled result from artifacts cache and compiles the code if necessary.
   * Will throw an exception if the source file doesn't exists.
   * @param filename: name of the TEAL code in `/assets` directory.
   *   (Examples: `mysc.teal, security/rbac.teal`)
   *   MUST have a .teal, .lsig or .py extension
   * @param force: if true it will force recompilation even if the cache is up to date.
   * @param scTmplParams: Smart contract template parameters (used only when compiling PyTEAL to TEAL)
   */
  async ensureCompiled (filename: string, force?: boolean, scTmplParams?: SCParams): Promise<ASCCache> {
    const filePath = getPathFromDirRecursive(ASSETS_DIR, filename) as string;

    if (force === undefined) {
      force = false;
    }

    if (filename.endsWith(pyExt)) {
      return await this.pyCompile.ensureCompiled(filename, force, scTmplParams);
    }

    if (!filename.endsWith(tealExt) && !filename.endsWith(lsigExt)) {
      throw new Error(`filename "${filename}" must end with "${tealExt}" or "${lsigExt}"`); // TODO: convert to buildererror
    }

    const [teal, thash] = this.readTealAndHash(filePath);
    let a = await this.readArtifact(filename);
    if (!force && a !== undefined && a.srcHash === thash) {
      // '\x1b[33m%s\x1b[0m' for yellow color warning
      console.warn('\x1b[33m%s\x1b[0m', `smart-contract source "${filename}" didn't change, skipping.`);
      return a;
    }
    console.log("compiling", filename);
    a = await this.compile(filename, teal, thash);
    const cacheFilename = path.join(CACHE_DIR, filename + ".yaml");
    this.writeFile(cacheFilename, YAML.stringify(a));
    return a;
  }

  // returns teal code, hash extracted from dissembled .lsig file (part above `LogicSig: `)
  // {refer - /assets/sample-text-asc.lsig}
  // returns teal code(whole file content) along with hash if extension is .teal
  readTealAndHash (filename: string): [string, number] {
    const content = fs.readFileSync(filename, 'utf8');

    if (filename.endsWith(lsigExt)) {
      const teal = content.split("LogicSig: ")[0];
      return [teal, murmurhash.v3(content)];
    }
    return [content, murmurhash.v3(content)];
  }

  async readArtifact (filename: string): Promise<ASCCache | undefined> {
    await assertDir(CACHE_DIR);
    try {
      const p = path.join(CACHE_DIR, filename + ".yaml");
      return YAML.parse(await fs.promises.readFile(p, 'utf8')) as ASCCache;
    } catch (e) {
      if (e?.errno === -2) { return undefined; } // handling a not existing file
      throw e;
    }
  }

  callCompiler (code: string): Promise<CompileResponse> {
    return this.algocl.compile(code).do();
  }

  async compile (filename: string, tealCode: string, tealHash: number): Promise<ASCCache> {
    try {
      const co = await this.callCompiler(tealCode);
      return {
        filename: filename,
        timestamp: timestampNow(),
        compiled: co.result,
        compiledHash: co.hash,
        srcHash: tealHash,
        // compiled base64 converted into bytes
        base64ToBytes: new Uint8Array(Buffer.from(co.result, "base64"))
      };
    } catch (e) {
      throw parseAlgorandError(e, { filename: filename });
    }
  }

  writeFile (filename: string, content: string): void {
    fs.writeFileSync(filename, content);
  }
}

export class PyCompileOp {
  compileOp: CompileOp;

  constructor (compileOp: CompileOp) {
    this.compileOp = compileOp;
  }

  /**
   * Parses scTmplParams and returns ReplaceParams and stringify object
   * @param scTmplParams smart contract template parameters
   */
  parseScTmplParam (scTmplParams?: SCParams): [ReplaceParams, string | undefined] {
    let param: string | undefined;
    const replaceParams: ReplaceParams = {};
    if (scTmplParams === undefined) {
      param = undefined;
    } else {
      const tmp: SCParams = {};
      for (const key in scTmplParams) {
        if (key.startsWith("TMPL_") || key.startsWith("tmpl_")) {
          replaceParams[key] = scTmplParams[key].toString();
        } else {
          tmp[key] = scTmplParams[key];
        }
      }
      console.log("PyTEAL template parameters:", tmp);
      param = YAML.stringify(tmp);
    }
    console.log("TEAL replacement parameters:", replaceParams);
    return [replaceParams, param];
  }

  /**
   * Description : returns compiled teal code from pyTeal file
   * @param filename : name of the PyTeal code in `/assets` directory.
   *                   Examples : [ gold.py, asa.py]
   *                   MUST have .py extension
   * @param force    : if true it will force recompilation even if the cache is up to date.
   * @param scTmplParams: Smart contract template parameters (used only when compiling PyTEAL to TEAL)
   */
  async ensureCompiled (filename: string, force?: boolean, scTmplParams?: SCParams): Promise<PyASCCache> {
    if (!filename.endsWith(pyExt)) {
      throw new Error(`filename "${filename}" must end with "${pyExt}"`);
    }

    const [replaceParams, param] = this.parseScTmplParam(scTmplParams);
    let content = this.compilePyTeal(filename, param);
    if (YAML.stringify({}) !== YAML.stringify(replaceParams)) {
      content = this.replaceTempValues(content, replaceParams);
    }
    const [teal, thash] = [content, murmurhash.v3(content)];

    const a = await this.readArtifact(filename);
    if (!force && a !== undefined && a.srcHash === thash) {
      // '\x1b[33m%s\x1b[0m' for yellow color warning
      console.warn('\x1b[33m%s\x1b[0m', `smart-contract source "${filename}" didn't change, skipping.`);
      return a;
    }
    console.log("compiling", filename);
    const compiledTeal = await this.compileOp.compile(filename, teal, thash);
    const pyCompiled: PyASCCache = {
      filename: "",
      timestamp: 0,
      compiled: "",
      compiledHash: "",
      srcHash: 0,
      tealCode: content,
      base64ToBytes: new Uint8Array(1)
    };
    Object.assign(pyCompiled, compiledTeal);

    const cacheFilename = path.join(CACHE_DIR, filename + ".yaml");
    this.compileOp.writeFile(cacheFilename, YAML.stringify(pyCompiled));
    return pyCompiled;
  }

  /**
   * Replaces keys with the values in program using replaceParams
   * @param program Teal program in string
   * @param replaceParams params that needs to be replaced in program
   */
  replaceTempValues (program: string, replaceParams: ReplaceParams): string {
    for (const param in replaceParams) {
      program = program.split(param).join(replaceParams[param]);
    }
    return program;
  }

  async readArtifact (filename: string): Promise<PyASCCache | undefined> {
    await assertDir(CACHE_DIR);
    try {
      const p = path.join(CACHE_DIR, filename + ".yaml");
      return YAML.parse(await fs.promises.readFile(p, 'utf8')) as PyASCCache;
    } catch (e) {
      if (e?.errno === -2) { return undefined; } // handling a not existing file
      throw e;
    }
  }

  /**
   * Description: Runs a subprocess to execute python script
   * @param filename : python filename in assets folder
   * @param scInitParam : Smart contract initialization parameters.
   */
  private runPythonScript (filename: string, scInitParam?: string): SpawnSyncReturns<string> {
    const filePath = getPathFromDirRecursive(ASSETS_DIR, filename) as string;
    // used spawnSync instead of spawn, as it is synchronous
    if (scInitParam === undefined) {
      return spawnSync(
        'python3', [
          filePath
        ], { encoding: 'utf8' }
      );
    }

    return spawnSync('python3', [
      filePath,
      scInitParam
    ], { encoding: 'utf8' }
    );
  }

  /**
   * Description: returns TEAL code using pyTeal compiler
   * @param filename : python filename in assets folder
   * @param scInitParam : Smart contract initialization parameters.
   */
  compilePyTeal (filename: string, scInitParam?: string): string {
    const subprocess: SpawnSyncReturns<string> = this.runPythonScript(filename, scInitParam);

    if (subprocess.stderr) {
      throw new BuilderError(
        ERRORS.PyTEAL.PYTEAL_FILE_ERROR, {
          filename: filename,
          reason: subprocess.stderr
        });
    }
    return subprocess.stdout;
  }
}
