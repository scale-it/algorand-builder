import { encodeNote, types } from "@algo-builder/runtime";
import { SSCDeploymentFlags } from "@algo-builder/runtime/build/types";
import { ConfirmedTxInfo, decodeSignedTransaction, encodeAddress, Transaction } from "algosdk";
import { assert } from "chai";
import { isArray } from "lodash";
import sinon from 'sinon';
import { TextEncoder } from "util";

import { executeTransaction } from "../../src";
import { ERRORS } from "../../src/errors/errors";
import { DeployerDeployMode } from "../../src/internal/deployer";
import { DeployerConfig } from "../../src/internal/deployer_cfg";
import { Deployer } from "../../src/types";
import { expectBuilderErrorAsync } from "../helpers/errors";
import { mkEnv } from "../helpers/params";
import { useFixtureProjectCopy } from "../helpers/project";
import { bobAcc } from "../mocks/account";
import { mockAssetInfo, mockSuggestedParam } from "../mocks/tx";
import { AlgoOperatorDryRunImpl } from "../stubs/algo-operator";

describe("Note in TxParams", () => {
  const encoder = new TextEncoder();
  const note = "Hello Algob!";
  const noteb64 = "asdisaddas";

  it("Both notes given", () => {
    const result = encodeNote(note, noteb64);
    assert.deepEqual(result, encoder.encode(noteb64), "noteb64 not encoded");
  });

  it("Only note given", () => {
    const result = encodeNote(note, undefined);
    assert.deepEqual(result, encoder.encode(note), "note not encoded");
  });

  it("Only noteb64 given", () => {
    const result = encodeNote(undefined, noteb64);
    assert.deepEqual(result, encoder.encode(noteb64), "noteb64 not encoded");
  });
});

function mkASA (): types.ASADef {
  return {
    total: 1,
    decimals: 1,
    unitName: 'ASA',
    defaultFrozen: false
  };
}

describe("Opt-In to ASA", () => {
  let deployer: Deployer;
  let execParams: types.OptInASAParam;
  let algod: AlgoOperatorDryRunImpl;
  let expected: ConfirmedTxInfo;
  beforeEach(async () => {
    const env = mkEnv("network1");
    algod = new AlgoOperatorDryRunImpl();
    const deployerCfg = new DeployerConfig(env, algod);
    deployerCfg.asaDefs = { silver: mkASA() };
    deployer = new DeployerDeployMode(deployerCfg);
    await deployer.deployASA("silver", { creator: deployer.accounts[0] });
    execParams = {
      type: types.TransactionType.OptInASA,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      assetID: 1
    };
    sinon.stub(algod.algodClient, "getTransactionParams")
      .returns({ do: async () => mockSuggestedParam });
    expected = {
      'confirmed-round': 1,
      "asset-index": 1,
      'application-index': 1,
      'global-state-delta': "string",
      'local-state-delta': "string"
    };
  });

  afterEach(() => {
    (algod.algodClient.getTransactionParams as sinon.SinonStub).restore();
  });

  it("should opt-in to asa using asset id as number", async () => {
    const res = await executeTransaction(deployer, execParams);

    assert.deepEqual(res, expected);
  });

  it("Should fail if asset name is passed but not found in checkpoints", async () => {
    execParams.assetID = "unknown";

    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParams),
      ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_NOT_DEFINED,
      "unknown"
    );
  });

  it("Should set asset id to asset id of asset name passed", async () => {
    execParams.assetID = "silver";

    const res = await executeTransaction(deployer, execParams);

    assert.deepEqual(res, expected);
  });
});

describe("ASA modify fields", () => {
  let deployer: Deployer;
  let execParams: types.ModifyAssetParam;
  let algod: AlgoOperatorDryRunImpl;
  let assetFields: types.AssetModFields;
  beforeEach(async () => {
    const env = mkEnv("network1");
    algod = new AlgoOperatorDryRunImpl();
    const deployerCfg = new DeployerConfig(env, algod);
    deployer = new DeployerDeployMode(deployerCfg);
    assetFields = {
      manager: "",
      clawback: bobAcc.addr
    };
    execParams = {
      type: types.TransactionType.ModifyAsset,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      assetID: 1,
      fields: assetFields
    };
    sinon.stub(algod.algodClient, "getTransactionParams")
      .returns({ do: async () => mockSuggestedParam });
  });

  afterEach(async () => {
    (algod.algodClient.getTransactionParams as sinon.SinonStub).restore();
  });

  /**
   * Verifies correct asset fields are sent to network
   * @param rawTxns rawTxns Signed transactions in Uint8Array
   */
  function checkTx (rawTxns: Uint8Array | Uint8Array[]): Promise<ConfirmedTxInfo> {
    if (isArray(rawTxns)) {
      // verify here if group tx
    } else {
      const tx: Transaction = decodeSignedTransaction(rawTxns).txn;
      // Verify if fields are set correctly
      assert.isUndefined(tx.assetManager);
      assert.isUndefined(tx.assetReserve);
      assert.equal(encodeAddress(tx.assetFreeze.publicKey), mockAssetInfo.params.freeze);
      assert.equal(encodeAddress(tx.assetClawback.publicKey), assetFields.clawback);
    }
    (algod.sendAndWait as sinon.SinonStub).restore();
    return algod.sendAndWait(rawTxns);
  }

  it("Should set fields, freeze is not sent, therefore it should be picked from assetInfo", async () => {
    // Manager should be set to ""(sent as undefined to network)
    // Clawback should be updated
    sinon.stub(algod, "sendAndWait").callsFake(checkTx);

    await executeTransaction(deployer, execParams);
  });
});

describe("Delete ASA and SSC", () => {
  useFixtureProjectCopy("stateful");
  let deployer: Deployer;
  let algod: AlgoOperatorDryRunImpl;
  beforeEach(async () => {
    const env = mkEnv("network1");
    algod = new AlgoOperatorDryRunImpl();
    const deployerCfg = new DeployerConfig(env, algod);
    deployerCfg.asaDefs = { silver: mkASA() };
    deployer = new DeployerDeployMode(deployerCfg);
    await deployer.deployASA("silver", { creator: deployer.accounts[0] });
    sinon.stub(algod.algodClient, "getTransactionParams")
      .returns({ do: async () => mockSuggestedParam });
  });

  afterEach(async () => {
    (algod.algodClient.getTransactionParams as sinon.SinonStub).restore();
  });

  it("Should delete ASA, and set delete boolean in ASAInfo", async () => {
    const execParams: types.DestroyAssetParam = {
      type: types.TransactionType.DestroyAsset,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      assetID: "silver"
    };
    await executeTransaction(deployer, execParams);

    const res = deployer.getASAInfo("silver");
    assert.equal(res.deleted, true);
  });

  it("Should delete ASA If asset index is used, instead of asset name", async () => {
    const execParams: types.DestroyAssetParam = {
      type: types.TransactionType.DestroyAsset,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      assetID: 1
    };
    await executeTransaction(deployer, execParams);

    const res = deployer.getASAInfo("silver");
    assert.equal(res.deleted, true);
  });

  it("Should not fail if ASA is not in checkpoints", async () => {
    const execParams: types.DestroyAssetParam = {
      type: types.TransactionType.DestroyAsset,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      assetID: 2
    };
    await executeTransaction(deployer, execParams);
  });

  it("Should delete SSC, set delete boolean in latest SSCInfo", async () => {
    const flags: SSCDeploymentFlags = {
      sender: bobAcc,
      localBytes: 1,
      localInts: 1,
      globalBytes: 1,
      globalInts: 1
    };
    const info = await deployer.deploySSC("approval.teal", "clear.teal", flags, {});
    const execParams: types.SSCCallsParam = {
      type: types.TransactionType.DeleteSSC,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      appId: info.appID
    };

    await executeTransaction(deployer, execParams);

    const res = deployer.getSSC("approval.teal", "clear.teal");
    assert.isDefined(res);
    if (res) assert.equal(res.deleted, true);
  });

  it("Should not fail if SSC is not in checkpoints", async () => {
    const execParams: types.SSCCallsParam = {
      type: types.TransactionType.DeleteSSC,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      appId: 23
    };
    await executeTransaction(deployer, execParams);
  });
});
