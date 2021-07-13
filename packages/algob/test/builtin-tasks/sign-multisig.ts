import { compareArray } from "@algo-builder/runtime/src/lib/compare";
import { decodeAddress, decodeSignedTransaction } from "algosdk";
import { assert } from "chai";
import * as fs from "fs";
import path from "path";
import sinon from 'sinon';

import { TASK_SIGN_MULTISIG } from "../../src/builtin-tasks/task-names";
import { ASSETS_DIR } from "../../src/internal/core/project-structure";
import { loadSignedTxnFromFile } from "../../src/lib/files";
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

describe("Sign-Multisig task", () => {
  useFixtureProject("config-project");

  const inputFile = 'multisig-signed.txn'; // present in config-project/assets
  const outFile = 'bob-signed.txn';
  const bobPk = decodeAddress(bobAcc.addr).publicKey;
  before(async function () {
    this.env = await getEnv(netCfg); // update this.env with custom netCfg
  });

  afterEach(function () {
    const outPath = path.join(ASSETS_DIR, outFile);
    if (fs.existsSync(outPath)) { fs.rmSync(outPath); }
  });

  it("Append bob's signature to multisigned txn loaded from file", async function () {
    const encodedTx = loadSignedTxnFromFile(inputFile) as Uint8Array;
    const txMsig = decodeSignedTransaction(encodedTx).msig;

    // input assertions (verfiy bob pk is present in pre-image, but it is not signed,
    // i.e signature is not present)
    assert.isDefined(txMsig);
    assert.deepInclude(txMsig?.subsig, { pk: bobPk } as any); // msig includes bobPk (but without signature i.e "s" field)

    // append bob signature to txn.msig
    await this.env.run(TASK_SIGN_MULTISIG, {
      file: inputFile,
      account: bobAcc.name,
      out: outFile
    });

    // output assertions
    assert(fs.existsSync(path.join(ASSETS_DIR, outFile))); // outfile exists after commmand

    const outTx = loadSignedTxnFromFile(outFile) as Uint8Array;
    const outTxMsig = decodeSignedTransaction(outTx).msig;

    const bobSubsig = outTxMsig?.subsig.find(s => compareArray(s.pk, bobPk));
    assert.isDefined(bobSubsig?.pk);
    assert.isDefined(bobSubsig?.s); // bob "signature" should be present
  });

  it("should throw error if account pre-image not present transaction's multisig", async function () {
    const encodedTx = loadSignedTxnFromFile(inputFile) as Uint8Array;
    const txMsig = decodeSignedTransaction(encodedTx).msig;

    // verify encodedTx is not signed by account1's secret key.
    // (by verifying account1 pk not present in msig.subsig)
    const account1Pk = decodeAddress(account1.addr).publicKey;
    assert.isDefined(txMsig);
    assert.notDeepInclude(txMsig?.subsig, { pk: account1Pk } as any);

    try {
      await this.env.run(TASK_SIGN_MULTISIG, {
        file: inputFile,
        account: account1.name,
        out: outFile
      });
    } catch (error) {
      assert.equal(error.message, 'Key does not exist');
    }
  });

  it("Should log error if account name is not present in algob config", async function () {
    const stub = console.error as sinon.SinonStub;
    stub.reset();

    await this.env.run(TASK_SIGN_MULTISIG, {
      file: inputFile,
      account: 'random-account', // random account name
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
    fs.writeFileSync(path.join(ASSETS_DIR, outFile), 'algo-builder'); // creating new file

    await this.env.run(TASK_SIGN_MULTISIG, {
      file: inputFile,
      account: 'bob',
      out: outFile
    });

    assert.isTrue(stub.calledWith(
     `File assets/${outFile} already exists. Aborting. Use --force flag if you want to overwrite it`));
  });

  it("Should append _out to input file if outfile is not passed", async function () {
    await this.env.run(TASK_SIGN_MULTISIG, {
      file: inputFile,
      account: 'bob'
    });

    const newOutPath = path.join(ASSETS_DIR, 'multisig-signed_out.txn');
    assert.isTrue(fs.existsSync(newOutPath)); // outfile path (with appended _out) should exist

    fs.rmSync(newOutPath); // delete out file
  });
});
