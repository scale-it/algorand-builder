import { getPathFromDirRecursive } from "@algo-builder/runtime";
import { encodeObj } from "algosdk";
import path from "path";

import { task } from "../internal/core/config/config-env";
import { ASSETS_DIR } from "../internal/core/project-structure";
import { loadBinaryLsig } from "../lib/msig";
import { RuntimeEnv } from "../types";
import { writeToFile } from "./gen-accounts";
import { TaskArgs } from "./sign-multisig";
import { TASK_SIGN_LSIG } from "./task-names";

// Signs a logic sig object from file. If msig is present then append to multisignature, otherwise
// create single signature lsig.
async function multiSignLsig (
  taskArgs: TaskArgs,
  runtimeEnv: RuntimeEnv
): Promise<void> {
  const signerAccount = runtimeEnv.network.config.accounts.find(acc => acc.name === taskArgs.account);
  if (signerAccount === undefined) {
    console.error(`No account with the name "${taskArgs.account}" exists in the config file.`);
    return;
  }

  const lsig = await loadBinaryLsig(taskArgs.file);
  const sourceFilePath = getPathFromDirRecursive(ASSETS_DIR, taskArgs.file) as string;
  if (lsig.msig) {
    lsig.appendToMultisig(signerAccount.sk); // if msig is present then append signature to multisig
  } else {
    lsig.sign(signerAccount.sk); // else create single signed lsig
  }

  const [name, ext] = taskArgs.file.split(".");
  const outFileName = taskArgs.out ?? (name + "_out." + ext);
  const outFilePath = path.join(path.dirname(sourceFilePath), outFileName);

  // if lsig.args = [] (empty array), then delete that key
  if (lsig.args?.length === 0) {
    lsig.args = undefined as any;
  }
  const encodedLsig = encodeObj(lsig.get_obj_for_encoding());
  await writeToFile(encodedLsig, taskArgs.force, outFilePath);
}

export default function (): void {
  task(TASK_SIGN_LSIG, "Signs a LogicSig object from a file.")
    .addParam(
      "account",
      "Name of the account (present in `algob.config.js`) to be used for signing the logic signature."
    )
    .addParam(
      "file",
      "Name of the transaction file in assets directory"
    )
    .addOptionalParam(
      "out",
      "Name of the file to be used for resultant logic signature file.\n\t\t        If not provided source logic signature file's name will be appended by \"_out\""
    )
    .addFlag("force", "Overwrite output lsig file if the file already exists.")
    .setAction((input, env) => multiSignLsig(input, env));
}

// const dummyLsig = makeLogicSig(new Uint8Array(56), []);
// console.log('D ', dummyLsig);
