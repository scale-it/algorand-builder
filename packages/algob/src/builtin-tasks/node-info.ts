import { task } from "../internal/core/config/config-env";
import { createClient } from "../lib/driver";
import { checkAlgorandUnauthorized } from "../lib/exceptions";
import { AlgobRuntimeEnv, TaskArguments } from "../types";
import { TASK_NODE_INFO } from "./task-names";

export default function (): void {
  task(TASK_NODE_INFO, "Prints node info and status")
    .setAction(nodeInfo);
}

async function nodeInfo (_taskArgs: TaskArguments, env: AlgobRuntimeEnv): Promise<void> {
  const n = env.network;
  const algocl = createClient(n);
  try {
    const st = await algocl.status().do();
    console.log("NETWORK NAME", n.name);
    console.log("NODE ADDRESS", n.config);
    console.log("NODE STATUS", st);
  } catch (e) {
    if (!checkAlgorandUnauthorized(e, n)) { throw e; }
  }
}
