import { compareArray } from "@algo-builder/runtime/src/lib/compare";
import { decodeAddress } from "algosdk";
import { assert } from "chai";
import * as fs from "fs";
import path from "path";
import sinon from 'sinon';

import { TASK_SIGN_LSIG } from "../../src/builtin-tasks/task-names";
import { ASSETS_DIR } from "../../src/internal/core/project-structure";
import { loadBinaryLsig } from "../../src/lib/msig";
import { HttpNetworkConfig } from "../../src/types";
import { getEnv } from "../helpers/environment";
import { useFixtureProject } from "../helpers/project";
import { account1, bobAcc } from "../mocks/account";

export const netCfg: HttpNetworkConfig = {
  accounts: [account1, bobAcc],
  host: "localhost",
  port: 8080,
  token: "some-fake-token"
};

describe("Sign-lsig task", () => {
  useFixtureProject("config-project");

  const outFile = 'lsig_out.blsig';
  const bobPk = decodeAddress(bobAcc.addr).publicKey;
  before(async function () {
    this.env = await getEnv(netCfg); // update this.env with custom netCfg
  });

  afterEach(function () {
    const outPath = path.join(ASSETS_DIR, outFile);
    if (fs.existsSync(outPath)) { fs.rmSync(outPath); }
  });

  it("Append bob's signature to multisigned lsig loaded from file", async function () {
    const lsig = await loadBinaryLsig('multi-signed-lsig.blsig');
    const msig = lsig.msig;

    // input assertions
    assert.isDefined(msig);
    assert.deepInclude(msig?.subsig, { pk: bobPk } as any); // msig includes bobPk (but without signature)

    // append bob signature to msig
    await this.env.run(TASK_SIGN_LSIG, {
      file: 'multi-signed-lsig.blsig',
      account: 'bob',
      out: outFile
    });

    // output assertions
    assert(fs.existsSync(path.join(ASSETS_DIR, outFile))); // outfile exists

    const outLsig = await loadBinaryLsig(outFile);
    const singleSubsig = outLsig.msig?.subsig.find(s => compareArray(s.pk, bobPk));
    assert.isDefined(singleSubsig?.pk);
    assert.isDefined(singleSubsig?.s); // bob signature should be present

    lsig.appendToMultisig(bobAcc.sk);
    assert.deepEqual(
      singleSubsig?.s,
      lsig.msig?.subsig.find(s => compareArray(s.pk, bobPk))?.s); // verify signature
  });

  it("Create a single signature logic sig if msig not found", async function () {
    const lsig = await loadBinaryLsig('single-signed-lsig.blsig');
    assert.isUndefined(lsig.msig); // msig not present

    // force: boolean
    await this.env.run(TASK_SIGN_LSIG, {
      file: 'single-signed-lsig.blsig',
      account: 'bob',
      out: outFile
    });

    const outLsig = await loadBinaryLsig(outFile);
    assert.isDefined(outLsig.sig); // single signature should be present

    lsig.sign(bobAcc.sk);
    assert.deepEqual(outLsig.sig, lsig.sig); // verify signature
  });

  it("Should log error if account name is not present in algob config", async function () {
    const stub = console.error as sinon.SinonStub;
    stub.reset();

    await this.env.run(TASK_SIGN_LSIG, {
      file: 'multi-signed-lsig.blsig',
      account: 'random-account', // random account
      out: outFile
    });

    assert.isTrue(
      stub.calledWith("No account with the name \"random-account\" exists in the config file."));
    assert.isFalse(fs.existsSync(outFile)); // outfile does not exist
  });

  it("Should log warning if outfile already exists", async function () {
    const stub = console.error as sinon.SinonStub;
    stub.reset();

    // create new out-file (before running task)
    fs.writeFileSync(path.join(ASSETS_DIR, outFile), 'hello-world'); // creating new file

    await this.env.run(TASK_SIGN_LSIG, {
      file: 'multi-signed-lsig.blsig',
      account: 'bob',
      out: outFile
    });

    assert.isTrue(stub.calledWith(
      "File assets/lsig_out.blsig already exists. Aborting. Use --force flag if you want to overwrite it"));
  });

  it("Should append _out to input file if outfile is not passed", async function () {
    await this.env.run(TASK_SIGN_LSIG, {
      file: 'multi-signed-lsig.blsig',
      account: 'bob'
    });

    const newOutPath = path.join(ASSETS_DIR, 'multi-signed-lsig_out.blsig');
    assert.isTrue(fs.existsSync(newOutPath)); // outfile path (with appended _out) should exist

    fs.rmSync(newOutPath); // delete out file
  });
});
