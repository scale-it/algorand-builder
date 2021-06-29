import { assert } from "chai";
import sinon from "sinon";

import { AccountStore } from "../../src/account";
import { RUNTIME_ERRORS } from "../../src/errors/errors-list";
import { ASSET_CREATION_FEE } from "../../src/lib/constants";
import { Runtime } from "../../src/runtime";
import type { AlgoTransferParam, AssetModFields, AssetTransferParam, DestroyAssetParam, ExecParams, FreezeAssetParam, ModifyAssetParam, RevokeAssetParam } from "../../src/types";
import { LogicSig, SignType, TransactionType } from "../../src/types";
import { getProgram } from "../helpers/files";
import { useFixture } from "../helpers/integration";
import { expectRuntimeError } from "../helpers/runtime-errors";
import { elonMuskAccount } from "../mocks/account";

const programName = "basic.teal";
const minBalance = BigInt(1e7);

describe("Logic Signature Transaction in Runtime", function () {
  useFixture("basic-teal");
  const john = new AccountStore(minBalance);
  const bob = new AccountStore(minBalance);
  const alice = new AccountStore(minBalance);

  let runtime: Runtime;
  let lsig: LogicSig;
  let txnParam: ExecParams;
  this.beforeAll(function () {
    runtime = new Runtime([john, bob, alice]);
    lsig = runtime.getLogicSig(getProgram(programName), []);
    txnParam = {
      type: TransactionType.TransferAlgo,
      sign: SignType.LogicSignature,
      fromAccountAddr: john.account.addr,
      toAccountAddr: bob.account.addr,
      amountMicroAlgos: 1000n,
      lsig: lsig,
      payFlags: { totalFee: 1000 }
    };
  });

  it("should execute the lsig and verify john(delegated signature)", () => {
    lsig.sign(john.account.sk);
    runtime.executeTx(txnParam);

    // balance should be updated because logic is verified and accepted
    const bobAcc = runtime.getAccount(bob.address);
    assert.equal(bobAcc.balance(), minBalance + 1000n);
  });

  it("should not verify signature because alice sent it", () => {
    const invalidParams: ExecParams = {
      ...txnParam,
      sign: SignType.LogicSignature,
      fromAccountAddr: alice.account.addr,
      lsig: lsig
    };

    // execute transaction (logic signature validation failed)
    expectRuntimeError(
      () => runtime.executeTx(invalidParams),
      RUNTIME_ERRORS.GENERAL.LOGIC_SIGNATURE_VALIDATION_FAILED
    );
  });

  it("should verify signature but reject logic", async () => {
    const logicSig = runtime.getLogicSig(getProgram("reject.teal"), []);
    const txParams: ExecParams = {
      ...txnParam,
      sign: SignType.LogicSignature,
      fromAccountAddr: john.account.addr,
      lsig: logicSig
    };

    logicSig.sign(john.account.sk);
    // execute transaction (rejected by logic)
    // - Signature successfully validated for john
    // - But teal file logic is rejected
    expectRuntimeError(
      () => runtime.executeTx(txParams),
      RUNTIME_ERRORS.TEAL.REJECTED_BY_LOGIC
    );
  });
});

describe("Rounds Test", function () {
  useFixture("basic-teal");
  let john = new AccountStore(minBalance);
  let bob = new AccountStore(minBalance);
  let runtime: Runtime;
  let txnParams: AlgoTransferParam;
  this.beforeAll(function () {
    runtime = new Runtime([john, bob]); // setup test

    // set up transaction paramenters
    txnParams = {
      type: TransactionType.TransferAlgo, // payment
      sign: SignType.SecretKey,
      fromAccount: john.account,
      toAccountAddr: bob.address,
      amountMicroAlgos: 100n,
      payFlags: { firstValid: 5, validRounds: 200 }
    };
  });

  afterEach(function () {
    john = new AccountStore(minBalance);
    bob = new AccountStore(minBalance);
    runtime = new Runtime([john, bob]);
    txnParams = {
      ...txnParams,
      sign: SignType.SecretKey,
      fromAccount: john.account,
      toAccountAddr: bob.address
    };
  });

  function syncAccounts (): void {
    john = runtime.getAccount(john.address);
    bob = runtime.getAccount(bob.address);
  }

  it("should succeed if current round is between first and last valid", () => {
    txnParams.payFlags = { totalFee: 1000, firstValid: 5, validRounds: 200 };
    runtime.setRoundAndTimestamp(20, 20);

    runtime.executeTx(txnParams);

    // get final state (updated accounts)
    syncAccounts();
    assert.equal(john.balance(), minBalance - 1100n);
    assert.equal(bob.balance(), minBalance + 100n);
  });

  it("should fail if current round is not between first and last valid", () => {
    runtime.setRoundAndTimestamp(3, 20);

    expectRuntimeError(
      () => runtime.executeTx(txnParams),
      RUNTIME_ERRORS.GENERAL.INVALID_ROUND
    );
  });

  it("should succeeded by default (no round requirement is passed)", () => {
    txnParams.payFlags = { totalFee: 1000 };

    runtime.executeTx(txnParams);

    // get final state (updated accounts)
    syncAccounts();
    assert.equal(john.balance(), minBalance - 1100n);
    assert.equal(bob.balance(), minBalance + 100n);
  });
});

describe("Algorand Standard Assets", function () {
  useFixture('asa-check');
  let john = new AccountStore(minBalance);
  const bob = new AccountStore(minBalance);
  let alice = new AccountStore(minBalance);
  const elon = new AccountStore(minBalance, elonMuskAccount);
  let runtime: Runtime;
  let modFields: AssetModFields;
  let assetTransferParam: AssetTransferParam;
  let assetId: number;
  this.beforeAll(() => {
    runtime = new Runtime([john, bob, alice, elon]);
    modFields = {
      manager: bob.address,
      reserve: bob.address,
      clawback: john.address,
      freeze: john.address
    };
    assetTransferParam = {
      type: TransactionType.TransferAsset,
      sign: SignType.SecretKey,
      fromAccount: john.account,
      toAccountAddr: alice.account.addr,
      amount: 10n,
      assetID: 1,
      payFlags: { totalFee: 1000 }
    };
  });

  this.beforeEach(() => {
    assetId = runtime.addAsset('gold',
      { creator: { ...john.account, name: "john" } });
    assetTransferParam.assetID = assetId;
    syncAccounts();
  });

  const syncAccounts = (): void => {
    john = runtime.getAccount(john.address);
    alice = runtime.getAccount(alice.address);
  };

  it("should create asset using asa.yaml file and raise account minimum balance", () => {
    const initialMinBalance = john.minBalance;
    assetId = runtime.addAsset('gold', { creator: { ...john.account, name: "john" } });
    syncAccounts();

    const res = runtime.getAssetDef(assetId);
    assert.equal(res.decimals, 0);
    assert.equal(res.defaultFrozen, false);
    assert.equal(res.total, 5912599999515n);
    assert.equal(res.unitName, "GLD");
    assert.equal(res.url, "url");
    assert.equal(res.metadataHash, "12312442142141241244444411111133");
    assert.equal(res.manager, elon.address);
    assert.equal(res.reserve, elon.address);
    assert.equal(res.freeze, elon.address);
    assert.equal(res.clawback, elon.address);
    assert.equal(john.minBalance, initialMinBalance + ASSET_CREATION_FEE);
  });

  it("should opt-in to asset", () => {
    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);

    const johnAssetHolding = john.getAssetHolding(assetId);
    assert.isDefined(johnAssetHolding);
    assert.equal(johnAssetHolding?.amount as bigint, 5912599999515n);

    // opt-in for alice
    runtime.optIntoASA(assetId, alice.address, {});
    const aliceAssetHolding = alice.getAssetHolding(assetId);
    assert.isDefined(aliceAssetHolding);
    assert.equal(aliceAssetHolding?.amount as bigint, 0n);
  });

  it("should throw error on opt-in of asset does not exist", () => {
    expectRuntimeError(
      () => runtime.optIntoASA(1234, john.address, {}),
      RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND
    );
  });

  it("should warn if account already is already opted-into asset", () => {
    // console is mocked in package.json mocha options
    const stub = console.warn as sinon.SinonStub;
    stub.reset();

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);

    // executing same opt-in tx again
    runtime.optIntoASA(assetId, john.address, {});
    assert(stub.calledWith(
      `${john.address} is already opted in to asset ${assetId}`));
  });

  it("should transfer asset between two accounts", () => {
    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, alice.address, {});

    const initialJohnAssets = john.getAssetHolding(assetId)?.amount as bigint;
    const initialAliceAssets = alice.getAssetHolding(assetId)?.amount as bigint;
    assert.isDefined(initialJohnAssets);
    assert.isDefined(initialAliceAssets);

    assetTransferParam.amount = 100n;
    runtime.executeTx(assetTransferParam);
    syncAccounts();

    assert.equal(john.getAssetHolding(assetId)?.amount, initialJohnAssets - 100n);
    assert.equal(alice.getAssetHolding(assetId)?.amount, initialAliceAssets + 100n);
  });

  it("should throw error on transfer asset if asset is frozen and amount > 0", () => {
    const freezeParam: FreezeAssetParam = {
      type: TransactionType.FreezeAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      freezeTarget: john.address,
      freezeState: true,
      payFlags: {}
    };

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, alice.address, {});
    // freezing asset holding for john
    runtime.executeTx(freezeParam);

    expectRuntimeError(
      () => runtime.executeTx(assetTransferParam),
      RUNTIME_ERRORS.TRANSACTION.ACCOUNT_ASSET_FROZEN
    );

    assetTransferParam.amount = 0n;
    assert.doesNotThrow(
      () => runtime.executeTx(assetTransferParam), // should pass successfully
      `RUNTIME_ERR1505: Asset index 7 frozen for account ${john.address}`
    );
  });

  it("should close alice account for transfer asset if close remainder to is specified", () => {
    const initialAliceMinBalance = alice.minBalance;
    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, alice.address, {});

    // transfer few assets to alice
    runtime.executeTx({
      ...assetTransferParam,
      toAccountAddr: alice.address,
      amount: 30n
    });

    syncAccounts();
    assert.equal(alice.minBalance, initialAliceMinBalance + ASSET_CREATION_FEE); // alice min balance raised after opt-in
    const initialJohnAssets = john.getAssetHolding(assetId)?.amount as bigint;
    const initialAliceAssets = alice.getAssetHolding(assetId)?.amount as bigint;
    assert.isDefined(initialJohnAssets);
    assert.isDefined(initialAliceAssets);

    runtime.executeTx({
      ...assetTransferParam,
      sign: SignType.SecretKey,
      fromAccount: alice.account,
      toAccountAddr: alice.address,
      payFlags: { totalFee: 1000, closeRemainderTo: john.address } // transfer all assets of alice => john (using closeRemTo)
    });
    syncAccounts();

    assert.isUndefined(alice.getAssetHolding(assetId));
    assert.equal(john.getAssetHolding(assetId)?.amount, initialJohnAssets + initialAliceAssets);
    assert.equal(alice.minBalance, initialAliceMinBalance); // min balance should decrease to initial value after opt-out
  });

  it("should throw error if trying to close asset holding of asset creator account", () => {
    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, alice.address, {});

    expectRuntimeError(
      () => runtime.executeTx({
        ...assetTransferParam,
        payFlags: { totalFee: 1000, closeRemainderTo: alice.address } // creator of ASA trying to close asset holding to alice
      }),
      RUNTIME_ERRORS.ASA.CANNOT_CLOSE_ASSET_BY_CREATOR
    );
  });

  it("should throw error if asset is not found while modifying", () => {
    const modifyParam: ModifyAssetParam = {
      type: TransactionType.ModifyAsset,
      sign: SignType.SecretKey,
      fromAccount: john.account,
      assetID: 120,
      fields: modFields,
      payFlags: {}
    };
    expectRuntimeError(
      () => runtime.executeTx(modifyParam),
      RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND
    );
  });

  it("should modify asset", () => {
    const modifyParam: ModifyAssetParam = {
      type: TransactionType.ModifyAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      fields: modFields,
      payFlags: {}
    };
    runtime.executeTx(modifyParam);

    const res = runtime.getAssetDef(assetId);
    assert.equal(res.manager, bob.address);
    assert.equal(res.reserve, bob.address);
    assert.equal(res.clawback, john.address);
    assert.equal(res.freeze, john.address);
  });

  it("Blank field test, should not modify asset because field is set to blank", () => {
    const assetId = runtime.addAsset('silver',
      { creator: { ...john.account, name: "john" } });

    const modFields: AssetModFields = {
      manager: bob.address,
      reserve: bob.address,
      clawback: john.address,
      freeze: alice.address
    };
    const modifyParam: ModifyAssetParam = {
      type: TransactionType.ModifyAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      fields: modFields,
      payFlags: {}
    };

    expectRuntimeError(
      () => runtime.executeTx(modifyParam),
      RUNTIME_ERRORS.ASA.BLANK_ADDRESS_ERROR
    );
  });

  it("should fail because only manager account can modify asset", () => {
    const modifyParam: ModifyAssetParam = {
      type: TransactionType.ModifyAsset,
      sign: SignType.SecretKey,
      fromAccount: bob.account,
      assetID: assetId,
      fields: modFields,
      payFlags: {}
    };
    expectRuntimeError(
      () => runtime.executeTx(modifyParam),
      RUNTIME_ERRORS.ASA.MANAGER_ERROR
    );
  });

  it("should fail because only freeze account can freeze asset", () => {
    const freezeParam: FreezeAssetParam = {
      type: TransactionType.FreezeAsset,
      sign: SignType.SecretKey,
      fromAccount: bob.account,
      assetID: assetId,
      freezeTarget: john.address,
      freezeState: true,
      payFlags: {}
    };

    expectRuntimeError(
      () => runtime.executeTx(freezeParam),
      RUNTIME_ERRORS.ASA.FREEZE_ERROR
    );
  });

  it("should freeze asset", () => {
    const freezeParam: FreezeAssetParam = {
      type: TransactionType.FreezeAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      freezeTarget: john.address,
      freezeState: true,
      payFlags: {}
    };
    runtime.executeTx(freezeParam);

    const johnAssetHolding = runtime.getAssetHolding(assetId, john.address);
    assert.equal(johnAssetHolding["is-frozen"], true);
  });

  it("should fail because only clawback account can revoke assets", () => {
    const revokeParam: RevokeAssetParam = {
      type: TransactionType.RevokeAsset,
      sign: SignType.SecretKey,
      fromAccount: alice.account,
      recipient: john.address,
      assetID: assetId,
      revocationTarget: bob.address,
      amount: 1n,
      payFlags: {}
    };
    expectRuntimeError(
      () => runtime.executeTx(revokeParam),
      RUNTIME_ERRORS.ASA.CLAWBACK_ERROR
    );
  });

  it("should revoke assets", () => {
    const revokeParam: RevokeAssetParam = {
      type: TransactionType.RevokeAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      recipient: john.address,
      assetID: assetId,
      revocationTarget: bob.address,
      amount: 15n,
      payFlags: {}
    };
    runtime.optIntoASA(assetId, bob.address, {});

    assetTransferParam.toAccountAddr = bob.address;
    assetTransferParam.amount = 20n;
    assetTransferParam.payFlags = {};

    runtime.executeTx(assetTransferParam);

    let bobHolding = runtime.getAssetHolding(assetId, bob.address);
    const beforeRevokeJohn = runtime.getAssetHolding(assetId, john.address).amount;
    assert.equal(bobHolding.amount, assetTransferParam.amount);

    runtime.executeTx(revokeParam);

    const johnHolding = runtime.getAssetHolding(assetId, john.address);
    bobHolding = runtime.getAssetHolding(assetId, bob.address);
    assert.equal(beforeRevokeJohn + 15n, johnHolding.amount);
    assert.equal(bobHolding.amount, 5n);
  });

  it("should fail because only clawback account can revoke assets", () => {
    const revokeParam: RevokeAssetParam = {
      type: TransactionType.RevokeAsset,
      sign: SignType.SecretKey,
      fromAccount: alice.account,
      recipient: john.address,
      assetID: assetId,
      revocationTarget: bob.address,
      amount: 1n,
      payFlags: {}
    };
    expectRuntimeError(
      () => runtime.executeTx(revokeParam),
      RUNTIME_ERRORS.ASA.CLAWBACK_ERROR
    );
  });

  it("should throw error if trying to close asset holding by clawback", () => { /* eslint sonarjs/no-identical-functions: "off" */
    const closebyClawbackParam: RevokeAssetParam = {
      type: TransactionType.RevokeAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      recipient: john.address,
      assetID: assetId,
      revocationTarget: john.address,
      amount: 0n,
      payFlags: { closeRemainderTo: alice.address } // closing to alice using clawback
    };

    // opt-in to asset by alice
    runtime.optIntoASA(assetId, alice.address, {});
    expectRuntimeError(
      () => runtime.executeTx(closebyClawbackParam),
      RUNTIME_ERRORS.ASA.CANNOT_CLOSE_ASSET_BY_CLAWBACK
    );
  });

  it("should revoke if asset is frozen", () => {
    const freezeParam: FreezeAssetParam = {
      type: TransactionType.FreezeAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      freezeTarget: bob.address,
      freezeState: true,
      payFlags: {}
    };
    const revokeParam: RevokeAssetParam = {
      type: TransactionType.RevokeAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      recipient: john.address,
      assetID: assetId,
      revocationTarget: bob.address,
      amount: 15n,
      payFlags: {}
    };
    runtime.optIntoASA(assetId, bob.address, {});

    assetTransferParam.toAccountAddr = bob.address;
    assetTransferParam.amount = 20n;
    assetTransferParam.payFlags = {};
    runtime.executeTx(assetTransferParam);
    runtime.executeTx(freezeParam);
    let bobHolding = runtime.getAssetHolding(assetId, bob.address);
    const beforeRevokeJohn = runtime.getAssetHolding(assetId, john.address).amount;
    assert.equal(bobHolding.amount, assetTransferParam.amount);

    runtime.executeTx(revokeParam);

    const johnHolding = runtime.getAssetHolding(assetId, john.address);
    bobHolding = runtime.getAssetHolding(assetId, bob.address);
    assert.equal(beforeRevokeJohn + 15n, johnHolding.amount);
    assert.equal(bobHolding.amount, 5n);
  });

  it("Should fail because only manager can destroy assets", () => {
    const destroyParam: DestroyAssetParam = {
      type: TransactionType.DestroyAsset,
      sign: SignType.SecretKey,
      fromAccount: alice.account,
      assetID: assetId,
      payFlags: {}
    };
    expectRuntimeError(
      () => runtime.executeTx(destroyParam),
      RUNTIME_ERRORS.ASA.MANAGER_ERROR
    );
  });

  it("Should destroy asset", () => {
    const initialCreatorMinBalance = john.minBalance;
    const destroyParam: DestroyAssetParam = {
      type: TransactionType.DestroyAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      payFlags: {}
    };

    runtime.executeTx(destroyParam);
    syncAccounts();

    expectRuntimeError(
      () => runtime.getAssetDef(assetId),
      RUNTIME_ERRORS.ASA.ASSET_NOT_FOUND
    );
    // verify min balance of creator decreased after deleting app (by asa.manager)
    assert.equal(john.minBalance, initialCreatorMinBalance - ASSET_CREATION_FEE);
  });

  it("Should not destroy asset if total assets are not in creator's account", () => {
    const destroyParam: DestroyAssetParam = {
      type: TransactionType.DestroyAsset,
      sign: SignType.SecretKey,
      fromAccount: elon.account,
      assetID: assetId,
      payFlags: {}
    };
    runtime.optIntoASA(assetId, bob.address, {});

    assetTransferParam.toAccountAddr = bob.address;
    assetTransferParam.amount = 20n;
    assetTransferParam.payFlags = {};
    runtime.executeTx(assetTransferParam);

    expectRuntimeError(
      () => runtime.executeTx(destroyParam),
      RUNTIME_ERRORS.ASA.ASSET_TOTAL_ERROR
    );
  });
});

describe("Stateful Smart Contracts", function () {
  useFixture('stateful');
  const john = new AccountStore(minBalance);
  let runtime: Runtime;
  let approvalProgram: string;
  let clearProgram: string;
  this.beforeEach(() => {
    runtime = new Runtime([john]);
    approvalProgram = getProgram('counter-approval.teal');
    clearProgram = getProgram('clear.teal');
  });
  const creationFlags = {
    sender: john.account,
    globalBytes: 32,
    globalInts: 32,
    localBytes: 8,
    localInts: 8
  };

  it("Should not create application if approval program is empty", () => {
    approvalProgram = "";

    expectRuntimeError(
      () => runtime.addApp(creationFlags, {}, approvalProgram, clearProgram),
      RUNTIME_ERRORS.GENERAL.INVALID_APPROVAL_PROGRAM
    );
  });

  it("Should not create application if clear program is empty", () => {
    clearProgram = "";

    expectRuntimeError(
      () => runtime.addApp(creationFlags, {}, approvalProgram, clearProgram),
      RUNTIME_ERRORS.GENERAL.INVALID_CLEAR_PROGRAM
    );
  });

  it("Should create application", () => {
    const appID = runtime.addApp(creationFlags, {}, approvalProgram, clearProgram);

    const app = runtime.getApp(appID);
    assert.isDefined(app);
  });

  it("Should not update application if approval or clear program is empty", () => {
    const appID = runtime.addApp(creationFlags, {}, approvalProgram, clearProgram);

    expectRuntimeError(
      () => runtime.updateApp(john.address, appID, "", clearProgram, {}, {}),
      RUNTIME_ERRORS.GENERAL.INVALID_APPROVAL_PROGRAM
    );

    expectRuntimeError(
      () => runtime.updateApp(john.address, appID, approvalProgram, "", {}, {}),
      RUNTIME_ERRORS.GENERAL.INVALID_CLEAR_PROGRAM
    );
  });
});
