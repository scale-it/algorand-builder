import * as fs from "fs";
import Mocha from "mocha";

import { task } from "../internal/core/config/config-env";
import { testsDirectory } from "../lib/script-checkpoints";
import type { AlgobConfig } from "../types";
import { loadFilenames } from "./deploy";
import { TASK_TEST } from "./task-names";

async function runTests (config: AlgobConfig): Promise<void> {
  if (!fs.existsSync(testsDirectory)) {
    console.log("Test directory doesn't exists or exists with a different name. Please ensure that it's name is 'test'.");
    return;
  }
  try {
    const testFiles = loadFilenames(testsDirectory);
    console.log("Test files:", testFiles);
    const mocha = new Mocha(config.mocha);
    // Adding test files to mocha object
    testFiles.forEach((file) => mocha.addFile(file));
    await new Promise<number>((resolve) => {
      mocha.run(resolve);
    });
  } catch (error) {
    console.log(error.message);
  };
}

export default function (): void {
  task(TASK_TEST, "Run tests using mocha in project root")
    .setAction((config) => runTests(config));
}
