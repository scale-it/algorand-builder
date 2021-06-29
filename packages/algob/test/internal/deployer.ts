import { types as rtypes } from "@algo-builder/runtime";
import { ASADef } from "@algo-builder/runtime/build/types";
import algosdk, { generateAccount } from "algosdk";
import { assert } from "chai";

import { genAccounts } from "../../src/builtin-tasks/gen-accounts";
import { ERRORS } from "../../src/errors/errors-list";
import { DeployerDeployMode } from "../../src/internal/deployer";
import { DeployerConfig } from "../../src/internal/deployer_cfg";
import { getDummyLsig } from "../../src/lib/lsig";
import { CheckpointRepoImpl } from "../../src/lib/script-checkpoints";
import { Checkpoints, LsigInfo } from "../../src/types";
import { expectBuilderError, expectBuilderErrorAsync } from "../helpers/errors";
import { mkEnv } from "../helpers/params";
import { useFixtureProject } from "../helpers/project";
import { cleanupMutableData } from "../lib/script-checkpoints";
import { AlgoOperatorDryRunImpl } from "../stubs/algo-operator";

function mkASA (): ASADef {
  return {
    total: 1,
    decimals: 1,
    unitName: 'ASA',
    defaultFrozen: false
  };
}

describe("DeployerDeployMode", () => {
  useFixtureProject("config-project");
  let deployerCfg: DeployerConfig, env;
  const mp = new Map<number, rtypes.SSCInfo>();

  beforeEach(function () {
    env = mkEnv("network 123");
    deployerCfg = new DeployerConfig(env, new AlgoOperatorDryRunImpl());
    deployerCfg.asaDefs = {};
    deployerCfg.accounts = new Map();
    deployerCfg.cpData = new CheckpointRepoImpl();
  });

  it("Should ensure metadata existence for network", async () => {
    const cpData = new CheckpointRepoImpl().putMetadata("network 123", "k", "v");
    assert.deepEqual(cleanupMutableData(cpData.precedingCP["network 123"], 12345), {
      timestamp: 12345,
      metadata: new Map([["k", "v"]]),
      asa: new Map<string, rtypes.ASAInfo>(),
      ssc: new Map<string, typeof mp>(),
      dLsig: new Map<string, LsigInfo>()
    });
  });

  it("Should hold metadata of a network", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    deployer.addCheckpointKV("existent", "existent value");
    assert.isUndefined(deployer.getCheckpointKV("nonexistent"));
    assert.equal(deployer.getCheckpointKV("existent"), "existent value");
  });

  it("Should set given data into checkpoint with timestamp", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    deployer.addCheckpointKV("key 1", "val 1");
    deployer.addCheckpointKV("key 2", "val 2");
    const cleanCP = cleanupMutableData(deployerCfg.cpData.precedingCP["network 123"], 12345);
    assert.deepEqual(cleanCP, {
      timestamp: 12345,
      metadata: new Map([["key 1", "val 1"],
        ["key 2", "val 2"]]),
      asa: new Map<string, rtypes.ASAInfo>(),
      ssc: new Map<string, typeof mp>(),
      dLsig: new Map<string, LsigInfo>()
    });
  });

  it("Should append freshly loaded checkpoint values", async () => {
    const cp1: Checkpoints = {
      network1: {
        timestamp: 1,
        metadata: new Map([["key 1", "data 1"]]),
        asa: new Map<string, rtypes.ASAInfo>(),
        ssc: new Map<string, typeof mp>(),
        dLsig: new Map<string, LsigInfo>()
      }
    };
    const cp2: Checkpoints = {
      network2: {
        timestamp: 2,
        metadata: new Map([["key 2", "data 2"]]),
        asa: new Map<string, rtypes.ASAInfo>(),
        ssc: new Map<string, typeof mp>(),
        dLsig: new Map<string, LsigInfo>()
      }
    };
    const cpData = new CheckpointRepoImpl();
    cpData.merge(cp1, "12s");
    cpData.merge(cp2, "12s");
    assert.deepEqual(cpData.precedingCP, {
      network1: {
        timestamp: 1,
        metadata: new Map([["key 1", "data 1"]]),
        asa: new Map<string, rtypes.ASAInfo>(),
        ssc: new Map<string, typeof mp>(),
        dLsig: new Map<string, LsigInfo>()
      },
      network2: {
        timestamp: 2,
        metadata: new Map([["key 2", "data 2"]]),
        asa: new Map<string, rtypes.ASAInfo>(),
        ssc: new Map<string, typeof mp>(),
        dLsig: new Map<string, LsigInfo>()
      }
    });
  });

  it("Should save info to checkpoint after asset deployment", async () => {
    const env = mkEnv("network1");
    const deployerCfg = new DeployerConfig(env, new AlgoOperatorDryRunImpl());
    deployerCfg.asaDefs = { MY_ASA: mkASA() };
    const deployer = new DeployerDeployMode(deployerCfg);

    const asaInfo = await deployer.deployASA("MY_ASA", { creator: deployer.accounts[0] });
    assert.deepEqual(asaInfo,
      {
        creator: "addr-1-get-address-dry-run",
        txId: "tx-id-dry-run",
        confirmedRound: -1,
        assetIndex: 1,
        assetDef: mkASA(),
        deleted: false
      });

    deployerCfg.cpData.precedingCP.network1.timestamp = 515236;
    assert.deepEqual(deployerCfg.cpData.precedingCP, {
      network1: {
        asa: new Map([["MY_ASA", {
          creator: "addr-1-get-address-dry-run",
          txId: "tx-id-dry-run",
          confirmedRound: -1,
          assetIndex: 1,
          assetDef: mkASA(),
          deleted: false
        }]]),
        ssc: new Map(),
        dLsig: new Map(),
        metadata: new Map<string, string>(),
        timestamp: 515236
      }
    });
  });

  it("Should save info to checkpoint after SSC deployment", async () => {
    const env = mkEnv("network1");
    const deployerCfg = new DeployerConfig(env, new AlgoOperatorDryRunImpl());
    const deployer = new DeployerDeployMode(deployerCfg);
    const nestedMap = new Map<number, rtypes.SSCInfo>();
    nestedMap.set(1, {
      creator: "addr-1-get-address-dry-run",
      txId: "tx-id-dry-run",
      confirmedRound: -1,
      appID: 33,
      timestamp: 1,
      deleted: false
    });

    const sscFlags = {
      sender: deployer.accounts[0],
      localInts: 1,
      globalInts: 1,
      localBytes: 1,
      globalBytes: 1
    };
    const sscInfo = await deployer.deploySSC("app", "clear", sscFlags, {});
    assert.deepEqual(sscInfo,
      {
        creator: "addr-1-get-address-dry-run",
        txId: "tx-id-dry-run",
        confirmedRound: -1,
        appID: 33,
        timestamp: 1,
        deleted: false
      });

    deployerCfg.cpData.precedingCP.network1.timestamp = 515236;
    assert.deepEqual(deployerCfg.cpData.precedingCP, {
      network1: {
        asa: new Map(),
        ssc: new Map([["app-clear", nestedMap]]),
        dLsig: new Map(),
        metadata: new Map<string, string>(),
        timestamp: 515236
      }
    });

    nestedMap.set(2, {
      creator: "addr-1-get-address-dry-run",
      txId: "tx-id-dry-run",
      confirmedRound: -1,
      appID: 33,
      timestamp: 2,
      deleted: false
    });

    const updatedInfo = await deployer.updateSSC(deployer.accounts[0], {}, 33, "app", "clear", {});
    assert.deepEqual(updatedInfo,
      {
        creator: "addr-1-get-address-dry-run",
        txId: "tx-id-dry-run",
        confirmedRound: -1,
        appID: 33,
        timestamp: 2,
        deleted: false
      });

    // should create a nested checkpoint if name is same after update
    assert.deepEqual(deployerCfg.cpData.precedingCP, {
      network1: {
        asa: new Map(),
        ssc: new Map([["app-clear", nestedMap]]),
        dLsig: new Map(),
        metadata: new Map<string, string>(),
        timestamp: 515236
      }
    });
  });

  it("Should save overriden asaDef to checkpoint after asset deployment if custom ASA params are passed", async () => {
    const env = mkEnv("network1");
    const deployerCfg = new DeployerConfig(env, new AlgoOperatorDryRunImpl());
    const accounts = genAccounts(4);
    const fixedAccount = generateAccount();
    deployerCfg.asaDefs = {
      MY_ASA: {
        ...mkASA(),
        manager: accounts[0].addr,
        reserve: accounts[1].addr,
        clawback: fixedAccount.addr,
        freeze: fixedAccount.addr
      }
    };
    const deployer = new DeployerDeployMode(deployerCfg);

    // passing different manager & reserve address in customParams during ASA deploy
    const asaInfo = await deployer.deployASA("MY_ASA", { creator: deployer.accounts[0] }, {
      manager: accounts[2].addr,
      reserve: accounts[3].addr
    });

    // manager, reserve should be overriden
    // clawback, freeze should be original one
    const expectedASADef = {
      ...mkASA(),
      manager: accounts[2].addr,
      reserve: accounts[3].addr,
      clawback: fixedAccount.addr,
      freeze: fixedAccount.addr
    };

    assert.deepEqual(asaInfo, {
      creator: "addr-1-get-address-dry-run",
      txId: "tx-id-dry-run",
      confirmedRound: -1,
      assetIndex: 1,
      assetDef: expectedASADef,
      deleted: false
    });

    deployerCfg.cpData.precedingCP.network1.timestamp = 515236;
    assert.deepEqual(deployerCfg.cpData.precedingCP, {
      network1: {
        asa: new Map([["MY_ASA", {
          creator: "addr-1-get-address-dry-run",
          txId: "tx-id-dry-run",
          confirmedRound: -1,
          assetIndex: 1,
          assetDef: expectedASADef,
          deleted: false
        }]]),
        ssc: new Map(),
        dLsig: new Map(),
        metadata: new Map<string, string>(),
        timestamp: 515236
      }
    });

    // after recreating deployer with the same config, assetDef should be expected (overriden) one
    const newDeployer = new DeployerDeployMode(deployerCfg);
    assert.deepEqual(newDeployer.asa.get("MY_ASA")?.assetDef, expectedASADef);
  });

  it("Should load delegated logic signature", async () => {
    const env = mkEnv("network1");
    const deployerCfg = new DeployerConfig(env, new AlgoOperatorDryRunImpl());
    deployerCfg.asaDefs = { MY_ASA: mkASA() };
    const deployer = new DeployerDeployMode(deployerCfg);

    const logicSig = getDummyLsig() as any;

    const cp1: Checkpoints = {
      network1: {
        timestamp: 1,
        metadata: new Map([["key 1", "data 1"]]),
        asa: new Map<string, rtypes.ASAInfo>(),
        ssc: new Map<string, typeof mp>(),
        dLsig: new Map<string, LsigInfo>([["MY_LSIG", {
          creator: "addr-1-get-address-dry-run",
          contractAddress: "ASDFGDDSSS12A",
          lsig: logicSig
        }]])
      }
    };

    deployerCfg.cpData.merge(cp1, "12s");
    const result = deployer.getDelegatedLsig("MY_LSIG");
    assert.deepEqual(logicSig, result);
  });

  it("Should use getCheckpointKV and isDefined from CheckpointData", async () => {
    const networkName = "network1";
    const env = mkEnv(networkName);
    const cpData = new CheckpointRepoImpl()
      .registerASA(networkName, "ASA name", {
        creator: "ASA creator 123",
        txId: "",
        confirmedRound: 0,
        assetIndex: 0,
        assetDef: {} as rtypes.ASADef,
        deleted: false
      })
      .registerSSC(networkName, "ASC name", {
        creator: "ASC creator 951",
        txId: "",
        confirmedRound: 0,
        appID: -1,
        timestamp: 1,
        deleted: false
      })
      .registerLsig(networkName, "Lsig name", {
        creator: "Lsig creator",
        contractAddress: "addr-1",
        lsig: {} as rtypes.LogicSig
      })
      .putMetadata(networkName, "k", "v");
    const deployerCfg = new DeployerConfig(env, new AlgoOperatorDryRunImpl());
    deployerCfg.cpData = cpData;
    const deployer = new DeployerDeployMode(deployerCfg);

    assert.isTrue(deployer.isDefined("ASC name"));
    assert.equal(deployer.getCheckpointKV("k"), "v");
  });

  it("Should ignore same metadata of the same network", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    deployer.addCheckpointKV("existent", "existent value");
    deployer.addCheckpointKV("existent", "existent value");
    assert.equal(deployer.getCheckpointKV("existent"), "existent value");
  });

  it("Should crash when same metadata key is set second time & different value", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    deployer.addCheckpointKV("metadata_key", "orig_value");
    expectBuilderError(
      () => deployer.addCheckpointKV("metadata_key", "new_value"),
      ERRORS.BUILTIN_TASKS.DEPLOYER_METADATA_ALREADY_PRESENT,
      "metadata_key"
    );
  });

  it("Should crash when same ASA name is tried to deploy to second time", async () => {
    deployerCfg.asaDefs = { ASA_key: mkASA() };
    const deployer = new DeployerDeployMode(deployerCfg);
    await deployer.deployASA("ASA_key", { creator: deployer.accounts[0] });
    await expectBuilderErrorAsync(
      async () => await deployer.deployASA("ASA_key", { creator: deployer.accounts[0] }),
      ERRORS.BUILTIN_TASKS.DEPLOYER_ASSET_ALREADY_PRESENT,
      "ASA_key"
    );
  });

  it("Should crash when ASA for given name doesn't exist", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    await expectBuilderErrorAsync(
      async () => await deployer.deployASA("ASA_key", { creator: deployer.accounts[0] }),
      ERRORS.BUILTIN_TASKS.DEPLOYER_ASA_DEF_NOT_FOUND,
      "ASA_key"
    );
  });

  it("Should not crash when same ASC Contract Mode name is tried to fund second time", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    await deployer.fundLsig("Lsig", { funder: deployer.accounts[1], fundingMicroAlgo: 1000 }, {});
  });

  it("Should return empty ASA map on no CP", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    assert.deepEqual(deployer.asa, new Map());
  });

  it("Should return empty ASA map on no CP; with ASA in other net", async () => {
    const deployer = new DeployerDeployMode(deployerCfg);
    deployerCfg.cpData.registerASA("hi", "hi123", {
      creator: "",
      txId: "",
      confirmedRound: 0,
      assetIndex: 1337,
      assetDef: {} as rtypes.ASADef,
      deleted: false
    });
    assert.deepEqual(deployer.asa, new Map());
  });

  it("Should return correct ASA in ASA map", async () => {
    deployerCfg.asaDefs = { ASA_key: mkASA() };
    const deployer = new DeployerDeployMode(deployerCfg);
    await deployer.deployASA("ASA_key", { creator: deployer.accounts[0] });
    assert.deepEqual(deployer.asa, new Map([["ASA_key", {
      creator: 'addr-1-get-address-dry-run',
      txId: 'tx-id-dry-run',
      assetIndex: 1,
      confirmedRound: -1,
      assetDef: mkASA(),
      deleted: false
    }]]));
  });
});
