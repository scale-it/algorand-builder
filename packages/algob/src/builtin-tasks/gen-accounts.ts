import { BuilderError, ERRORS } from "@algo-builder/web";
import algosdk from "algosdk";
import * as _fs from "fs";
import * as path from "path";
import YAML from "yaml";

import { task } from "../internal/core/config/config-env";
import * as types from "../internal/core/params/argument-types";
import { assertAllDirs, ASSETS_DIR } from "../internal/core/project-structure";
import { MnemonicAccount, RuntimeEnv, TaskArguments } from "../types";
import { TASK_GEN_ACCOUNTS } from "./task-names";
const fsp = _fs.promises;

export default function (): void {
  task(TASK_GEN_ACCOUNTS, "Generates custom accounts (not safe for production use)")
    .addPositionalParam("n", "number of accounts to generate", undefined, types.int, false)
    .addFlag("force", "Overwrite generated accounts if the file already exists")
    .setAction(mkAccounts);
}

export function getFilename (): string { return path.join(ASSETS_DIR, "accounts_generated.yaml"); }

export async function mkAccounts (taskArgs: TaskArguments, _env: RuntimeEnv): Promise<void> {
  const filename = getFilename();
  const n = taskArgs.n as number;
  if (n <= 0) {
    throw new BuilderError(ERRORS.ARGUMENTS.INVALID_VALUE_FOR_TYPE, {
      value: n,
      name: 'n'
    });
  }
  console.info("GENERATING", n, "ACCOUNTS to ", filename);
  const accounts = genAccounts(n);
  return await writeToFile(YAML.stringify(accounts), taskArgs.force as boolean, filename);
}

export function genAccounts (n: number): MnemonicAccount[] {
  const accounts: MnemonicAccount[] = [];
  for (let i = 0; i < n; ++i) {
    const a = algosdk.generateAccount();
    accounts.push({
      name: "gen_" + i.toString(),
      addr: a.addr,
      mnemonic: algosdk.secretKeyToMnemonic(a.sk)
    });
  }
  return accounts;
}

export async function writeToFile (content: any, force: boolean, fileName: string): Promise<void> {
  await assertAllDirs();
  try {
    await fsp.access(fileName, _fs.constants.F_OK);
    if (!force) {
      console.error(`File ${fileName} already exists. Aborting. Use --force flag if you want to overwrite it`);
      return;
    }
  } catch (e) {}

  try {
    await fsp.writeFile(fileName, content, 'utf8');
    console.log("Data written succesfully to %s", fileName);
  } catch (e) {
    const err = e as Error;
    console.log("An error occured while writing to file:", fileName);
    console.error(err.name, err.message);
  }
}
