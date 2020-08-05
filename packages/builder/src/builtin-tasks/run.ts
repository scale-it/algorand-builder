import debug from "debug";
import fsExtra from "fs-extra";

import { task } from "../internal/core/config/config-env";
import { BuilderError } from "../internal/core/errors";
import { ERRORS } from "../internal/core/errors-list";
import { runScript } from "../internal/util/scripts-runner";
import { checkRelativePaths } from "../lib/files";
import {
  AlgobDeployerImpl,
  AlgobDeployerReadOnlyImpl,
  loadCheckpoint,
  loadCheckpointsRecursive
} from "../lib/script-checkpoints";
import { AlgobDeployer, AlgobRuntimeEnv, CheckpointData, ScriptCheckpoints } from "../types";
import { TASK_RUN } from "./task-names";

interface Input {
  scripts: string[]
}

function filterNonExistent (scripts: string[]): string[] {
  return scripts.filter(script => !fsExtra.pathExistsSync(script));
}

export async function runMultipleScripts (
  runtimeEnv: AlgobRuntimeEnv,
  scriptNames: string[],
  onSuccessFn: (cpData: CheckpointData, relativeScriptPath: string) => void,
  force: boolean,
  logTag: string,
  wrapDeployer: (orig: AlgobDeployer) => AlgobDeployer): Promise<void> {
  const log = debug(logTag);
  const cpData: CheckpointData = loadCheckpointsRecursive();
  const deployer: AlgobDeployer = wrapDeployer(new AlgobDeployerImpl(runtimeEnv, cpData));

  for (let i = 0; i < scriptNames.length; i++) {
    const relativeScriptPath = scriptNames[i];
    const currentCP: ScriptCheckpoints = loadCheckpoint(relativeScriptPath);
    if (!force && currentCP[runtimeEnv.network.name]) {
      log(`Skipping: Checkpoint exists for script ${relativeScriptPath}`);
      return;
    }
    log(`Running script ${relativeScriptPath}`);
    cpData.merge(currentCP);
    await runScript(
      relativeScriptPath,
      runtimeEnv,
      deployer
    );
    onSuccessFn(cpData, relativeScriptPath);
  }
}

async function doRun (
  { scripts }: Input,
  runtimeEnv: AlgobRuntimeEnv
): Promise<any> {
  const logDebugTag = "builder:core:tasks:run";

  const nonExistent = filterNonExistent(scripts);
  if (nonExistent.length !== 0) {
    throw new BuilderError(ERRORS.BUILTIN_TASKS.RUN_FILES_NOT_FOUND, {
      scripts: nonExistent
    });
  }

  return await runMultipleScripts(
    runtimeEnv,
    checkRelativePaths(scripts),
    (cpData: CheckpointData, relativeScriptPath: string) => {},
    true,
    logDebugTag,
    (orig: AlgobDeployer) => new AlgobDeployerReadOnlyImpl(orig)
  );
}

export default function (): void {
  task(TASK_RUN, "Runs a user-defined script after compiling the project")
    .addVariadicPositionalParam(
      "scripts",
      "A js file to be run within builder's environment"
    )
    .setAction(doRun);
}
