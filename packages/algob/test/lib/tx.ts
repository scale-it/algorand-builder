import { encodeNote, types } from "@algo-builder/runtime";
import algosdk, { decodeSignedTransaction, encodeAddress, PendingTransactionResponse } from "algosdk";
import { assert } from "chai";
import { isArray } from "lodash";
import sinon from 'sinon';
import { TextEncoder } from "util";

import { executeTransaction } from "../../src";
import { ERRORS } from "../../src/errors/errors";
import { DeployerDeployMode, DeployerRunMode } from "../../src/internal/deployer";
import { DeployerConfig } from "../../src/internal/deployer_cfg";
import { Deployer } from "../../src/types";
import { expectBuilderError, expectBuilderErrorAsync } from "../helpers/errors";
import { mkEnv } from "../helpers/params";
import { useFixtureProject, useFixtureProjectCopy } from "../helpers/project";
import { aliceAcc, bobAcc } from "../mocks/account";
import { mockAssetInfo, mockLsig, mockSuggestedParam } from "../mocks/tx";
import { AlgoOperatorDryRunImpl } from "../stubs/algo-operator";

/* describe("Note in TxParams", () => {
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
  useFixtureProject("config-project");

  let deployer: Deployer;
  let execParams: types.OptInASAParam;
  let algod: AlgoOperatorDryRunImpl;
  let expected: PendingTransactionResponse;
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
      .returns({ do: async () => mockSuggestedParam as algosdk.SuggestedParamsRequest });
    expected = {
      confirmedRound: 1,
      assetIndex: 1,
      applicationIndex: 1
    } as PendingTransactionResponse;
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
  useFixtureProject("config-project");
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
/* function checkTx (rawTxns: Uint8Array | Uint8Array[]): Promise<PendingTransactionResponse> {
    if (isArray(rawTxns)) {
      // verify here if group tx
    } else {
      const tx: any = decodeSignedTransaction(rawTxns).txn;
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
    const flags: types.SSCDeploymentFlags = {
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
      appID: info.appID
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
      appID: 23
    };
    await executeTransaction(deployer, execParams);
  });
});

describe("Delete ASA and SSC transaction flow(with functions and executeTransaction)", () => {
  useFixtureProject("stateful");
  let deployer: Deployer;
  let algod: AlgoOperatorDryRunImpl;
  let appID: number;
  let assetID: number;
  const assetName = "silver";
  beforeEach(async () => {
    const env = mkEnv("network1");
    algod = new AlgoOperatorDryRunImpl();
    const deployerCfg = new DeployerConfig(env, algod);
    deployerCfg.asaDefs = { silver: mkASA() };
    deployer = new DeployerDeployMode(deployerCfg);
    sinon.stub(algod.algodClient, "getTransactionParams")
      .returns({ do: async () => mockSuggestedParam });

    // deploy  and delete asset
    const asaInfo = await deployer.deployASA(assetName, { creator: deployer.accounts[0] });
    assetID = asaInfo.assetIndex;
    const execParams: types.DestroyAssetParam = {
      type: types.TransactionType.DestroyAsset,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      assetID: 1
    };
    await executeTransaction(deployer, execParams);

    // deploy and delete app
    const flags: types.SSCDeploymentFlags = {
      sender: bobAcc,
      localBytes: 1,
      localInts: 1,
      globalBytes: 1,
      globalInts: 1
    };
    const info = await deployer.deploySSC("approval.teal", "clear.teal", flags, {});
    appID = info.appID;
    const execParam: types.SSCCallsParam = {
      type: types.TransactionType.DeleteSSC,
      sign: types.SignType.SecretKey,
      payFlags: {},
      fromAccount: bobAcc,
      appID: info.appID
    };
    await executeTransaction(deployer, execParam);
  });

  afterEach(async () => {
    (algod.algodClient.getTransactionParams as sinon.SinonStub).restore();
  });

  it("should throw error with opt-in asa functions, if asa exist and deleted", async () => {
    await expectBuilderErrorAsync(
      async () => await deployer.optInAcountToASA(assetName, 'acc-name-1', {}),
      ERRORS.GENERAL.ASSET_DELETED
    );

    await expectBuilderErrorAsync(
      async () => await deployer.optInLsigToASA(assetName, mockLsig, {}),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should pass with opt-in asa functions, if asa doesn't exist in checkpoint", async () => {
    await deployer.optInAcountToASA('23', 'acc-name-1', {});

    await deployer.optInLsigToASA('233212', mockLsig, {});
  });

  it("should throw error with opt-in ssc functions, if ssc exist and deleted", async () => {
    await expectBuilderErrorAsync(
      async () => await deployer.optInAccountToSSC(bobAcc, appID, {}, {}),
      ERRORS.GENERAL.APP_DELETED
    );

    await expectBuilderErrorAsync(
      async () => await deployer.optInLsigToSSC(appID, mockLsig, {}, {}),
      ERRORS.GENERAL.APP_DELETED
    );
  });

  it("should pass with opt-in ssc functions, if ssc doesn't exist in checkpoint", async () => {
    await deployer.optInAccountToSSC(bobAcc, 122, {}, {});

    await deployer.optInLsigToSSC(12223, mockLsig, {}, {});
  });

  it("should throw error with update ssc function, if ssc exist and deleted", async () => {
    await expectBuilderErrorAsync(
      async () => await deployer.updateSSC(bobAcc, {}, appID, "approval.teal", "clear.teal", {}),
      ERRORS.GENERAL.APP_DELETED
    );
  });

  it("should pass with update ssc functions, if ssc doesn't exist in checkpoint", async () => {
    await deployer.updateSSC(bobAcc, {}, 123, "approval.teal", "clear.teal", {});
  });

  it("should fail if user tries to opt-in through execute tx", async () => {
    const execParam: types.OptInASAParam = {
      type: types.TransactionType.OptInASA,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: assetID
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should fail if user tries to modify through execute tx", async () => {
    const execParam: types.ModifyAssetParam = {
      type: types.TransactionType.ModifyAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: assetID,
      fields: {}
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should fail if user tries to freeze through execute tx", async () => {
    const execParam: types.FreezeAssetParam = {
      type: types.TransactionType.FreezeAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: assetID,
      freezeTarget: "acc-name-1",
      freezeState: true
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should fail if user tries to revoke through execute tx", async () => {
    const execParam: types.RevokeAssetParam = {
      type: types.TransactionType.RevokeAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: assetID,
      recipient: bobAcc.addr,
      revocationTarget: "target",
      amount: 1000
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should fail if user tries to destroy through execute tx", async () => {
    const execParam: types.DestroyAssetParam = {
      type: types.TransactionType.DestroyAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: assetID
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should fail if user tries to transfer asa through execute tx", async () => {
    const execParam: types.AssetTransferParam = {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: assetID,
      toAccountAddr: aliceAcc.addr,
      amount: 12
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.ASSET_DELETED
    );
  });

  it("should pass if user tries to opt-out through execute tx", async () => {
    const execParam: types.AssetTransferParam = {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: { closeRemainderTo: bobAcc.addr },
      assetID: assetID,
      toAccountAddr: aliceAcc.addr,
      amount: 12
    };
    await executeTransaction(deployer, execParam);
  });

  it("should throw error if user tries to delete deleted app", async () => {
    const execParam: types.SSCCallsParam = {
      type: types.TransactionType.DeleteSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      appID: appID
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.APP_DELETED
    );
  });

  it("should throw error if user tries to update deleted app", async () => {
    const execParam: types.UpdateSSCParam = {
      type: types.TransactionType.UpdateSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      appID: appID,
      newApprovalProgram: "approval.teal",
      newClearProgram: "clear.teal"
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.APP_DELETED
    );
  });

  it("should throw error if user tries to call deleted app", async () => {
    const execParam: types.SSCCallsParam = {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      appID: appID
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.APP_DELETED
    );
  });

  it("should throw error if user tries to opt-in deleted app", async () => {
    const execParam: types.OptInSSCParam = {
      type: types.TransactionType.OptInSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      appID: appID
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.APP_DELETED
    );
  });

  it("should pass if user tries to opt-out deleted app", async () => {
    const execParam: types.SSCCallsParam = {
      type: types.TransactionType.CloseSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      appID: appID
    };
    await expectBuilderErrorAsync(
      async () => await executeTransaction(deployer, execParam),
      ERRORS.GENERAL.APP_DELETED
    );

    const execParams: types.SSCCallsParam = {
      type: types.TransactionType.ClearSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      appID: appID
    };
    await executeTransaction(deployer, execParams);
  });

  it("should pass if user tries delete app that doesn't exist in checkpoint", async () => {
    const execParam: types.DestroyAssetParam = {
      type: types.TransactionType.DestroyAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      payFlags: {},
      assetID: 123
    };

    await executeTransaction(deployer, execParam);
  });

  it("should pass if user tries delete (asset + app) that doesn't exist in checkpoint", async () => {
    const txGroup: types.ExecParams[] = [
      {
        type: types.TransactionType.DestroyAsset,
        sign: types.SignType.SecretKey,
        fromAccount: bobAcc,
        payFlags: {},
        assetID: 123
      },
      {
        type: types.TransactionType.DeleteSSC,
        sign: types.SignType.SecretKey,
        fromAccount: bobAcc,
        payFlags: {},
        appID: 12213
      }
    ];

    await executeTransaction(deployer, txGroup);
  });
});

describe("Deploy, Delete transactions test in run mode", () => {
  useFixtureProject("stateful");
  let deployer: Deployer;
  let algod: AlgoOperatorDryRunImpl;
  let deployerCfg: DeployerConfig;
  beforeEach(async () => {
    const env = mkEnv("network1");
    algod = new AlgoOperatorDryRunImpl();
    deployerCfg = new DeployerConfig(env, algod);
    deployerCfg.asaDefs = { silver: mkASA() };
    deployer = new DeployerRunMode(deployerCfg);
    sinon.stub(algod.algodClient, "getTransactionParams")
      .returns({ do: async () => mockSuggestedParam });
  });

  afterEach(async () => {
    (algod.algodClient.getTransactionParams as sinon.SinonStub).restore();
  });

  it("should deploy asa in run mode", async () => {
    const execParams: types.ExecParams = {
      type: types.TransactionType.DeployASA,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      asaName: 'silver',
      payFlags: {}
    };

    await executeTransaction(deployer, execParams);

    // should not be stored in checkpoint if in run mode
    expectBuilderError(
      () => deployer.getASAInfo('silver'),
      ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_NOT_DEFINED
    );
  });

  it("should deploy application in run mode", async () => {
    const execParams: types.ExecParams = {
      type: types.TransactionType.DeploySSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      approvalProgram: "approval.teal",
      clearProgram: "clear.teal",
      localInts: 1,
      localBytes: 1,
      globalInts: 1,
      globalBytes: 1,
      payFlags: {}
    };
    await executeTransaction(deployer, execParams);

    // should not be stored in checkpoint if in run mode
    assert.isUndefined(deployer.getSSC("approval.teal", "clear.teal"));
  });

  it("should delete application in run mode", async () => {
    deployer = new DeployerDeployMode(deployerCfg);
    let execParams: types.ExecParams = {
      type: types.TransactionType.DeploySSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      approvalProgram: "approval.teal",
      clearProgram: "clear.teal",
      localInts: 1,
      localBytes: 1,
      globalInts: 1,
      globalBytes: 1,
      payFlags: {}
    };
    const appInfo = await executeTransaction(deployer, execParams);

    deployer = new DeployerRunMode(deployerCfg);
    execParams = {
      type: types.TransactionType.DeleteSSC,
      sign: types.SignType.SecretKey,
      fromAccount: bobAcc,
      appID: appInfo["application-index"],
      payFlags: {}
    };

    await executeTransaction(deployer, execParams);

    const res = deployer.getSSC("approval.teal", "clear.teal");
    assert.isDefined(res);
    assert.equal(res?.deleted, false);
  });
}); */
