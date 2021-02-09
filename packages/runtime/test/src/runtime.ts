import { LogicSig } from "algosdk";
import { assert, expect } from "chai";
import sinon from "sinon";

import { StoreAccount } from "../../src/account";
import { ERRORS } from "../../src/errors/errors-list";
import { Runtime } from "../../src/runtime";
import type { AlgoTransferParam, AssetModFields, AssetTransferParam, ExecParams } from "../../src/types";
import { SignType, TransactionType } from "../../src/types";
import { expectTealError } from "../helpers/errors";
import { getProgram } from "../helpers/files";
import { useFixture } from "../helpers/integration";
import { elonMuskAccount } from "../mocks/account";

const programName = "basic.teal";
const minBalance = 1e7;

describe("Logic Signature Transaction in Runtime", function () {
  useFixture("basic-teal");
  const john = new StoreAccount(minBalance);
  const bob = new StoreAccount(minBalance);
  const alice = new StoreAccount(minBalance);

  let runtime: Runtime;
  let lsig: LogicSig;
  let txnParam: ExecParams;
  this.beforeAll(function () {
    runtime = new Runtime([john, bob, alice]);
    lsig = runtime.getLogicSig(getProgram(programName), []);
    txnParam = {
      type: TransactionType.TransferAlgo,
      sign: SignType.LogicSignature,
      fromAccount: john.account,
      toAccountAddr: bob.account.addr,
      amountMicroAlgos: 1000,
      lsig: lsig,
      payFlags: { totalFee: 1000 }
    };
  });

  it("should execute the lsig and verify john(delegated signature)", () => {
    lsig.sign(john.account.sk);
    runtime.executeTx(txnParam);

    // balance should be updated because logic is verified and accepted
    const bobAcc = runtime.getAccount(bob.address);
    assert.equal(bobAcc.balance(), minBalance + 1000);
  });

  it("should not verify signature because alice sent it", () => {
    txnParam.fromAccount = alice.account;

    // execute transaction (logic signature validation failed)
    expectTealError(
      () => runtime.executeTx(txnParam),
      ERRORS.TEAL.LOGIC_SIGNATURE_VALIDATION_FAILED
    );
  });

  it("should verify signature but reject logic", async () => {
    const logicSig = runtime.getLogicSig(getProgram("reject.teal"), []);
    txnParam.lsig = logicSig;
    txnParam.fromAccount = john.account;

    logicSig.sign(john.account.sk);
    // execute transaction (rejected by logic)
    // - Signature successfully validated for john
    // - But teal file logic is rejected
    expectTealError(
      () => runtime.executeTx(txnParam),
      ERRORS.TEAL.REJECTED_BY_LOGIC
    );
  });
});

describe("Rounds Test", function () {
  useFixture("basic-teal");
  let john = new StoreAccount(minBalance);
  let bob = new StoreAccount(minBalance);
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
      amountMicroAlgos: 100,
      payFlags: { firstValid: 5, validRounds: 200 }
    };
  });

  afterEach(function () {
    john = new StoreAccount(minBalance);
    bob = new StoreAccount(minBalance);
    runtime = new Runtime([john, bob]);
    txnParams.fromAccount = john.account;
    txnParams.toAccountAddr = bob.address;
  });

  function syncAccounts (): void {
    john = runtime.getAccount(john.address);
    bob = runtime.getAccount(bob.address);
  }

  it("should succeed if current round is between first and last valid", () => {
    txnParams.payFlags = { totalFee: 1000, firstValid: 5, validRounds: 200 };
    runtime.setRound(20);

    runtime.executeTx(txnParams);

    // get final state (updated accounts)
    syncAccounts();
    assert.equal(john.balance(), minBalance - 1100);
    assert.equal(bob.balance(), minBalance + 100);
  });

  it("should fail if current round is not between first and last valid", () => {
    runtime.setRound(3);

    expectTealError(
      () => runtime.executeTx(txnParams),
      ERRORS.TEAL.INVALID_ROUND
    );
  });

  it("should succeeded by default (no round requirement is passed)", () => {
    txnParams.payFlags = { totalFee: 1000 };

    runtime.executeTx(txnParams);

    // get final state (updated accounts)
    syncAccounts();
    assert.equal(john.balance(), minBalance - 1100);
    assert.equal(bob.balance(), minBalance + 100);
  });
});

describe("Algorand Standard Assets", function () {
  useFixture('asa-check');
  let john = new StoreAccount(minBalance);
  const bob = new StoreAccount(minBalance);
  let alice = new StoreAccount(minBalance);
  const elon = new StoreAccount(minBalance, elonMuskAccount);
  let runtime: Runtime;
  let modFields: AssetModFields;
  let assetTransferParam: AssetTransferParam;
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
      amount: 10,
      assetID: 1,
      payFlags: { totalFee: 1000 }
    };
  });

  const syncAccounts = (): void => {
    john = runtime.getAccount(john.address);
    alice = runtime.getAccount(alice.address);
  };

  it("should create asset using asa.yaml file", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    const res = runtime.getAssetDef(assetId);
    assert.equal(res.decimals, 0);
    assert.equal(res["default-frozen"], false);
    assert.equal(res.total, 5912599999515);
    assert.equal(res["unit-name"], "GLD");
    assert.equal(res.url, "url");
    assert.equal(res["metadata-hash"], "12312442142141241244444411111133");
    assert.equal(res.manager, elon.address);
    assert.equal(res.reserve, elon.address);
    assert.equal(res.freeze, elon.address);
    assert.equal(res.clawback, elon.address);
  });

  it("should opt-in to asset for john", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);

    // opt-in for john (creator)
    runtime.optIntoASA(assetId, john.address, {});
    const johnAssetHolding = john.getAssetHolding(assetId);
    assert.isDefined(johnAssetHolding);
    assert.equal(johnAssetHolding?.amount as number, 5912599999515);

    // opt-in for alice
    runtime.optIntoASA(assetId, alice.address, {});
    const aliceAssetHolding = alice.getAssetHolding(assetId);
    assert.isDefined(aliceAssetHolding);
    assert.equal(aliceAssetHolding?.amount as number, 0);
  });

  it("should throw error on opt-in of asset does not exist", () => {
    const errMsg = 'TEAL_ERR902: Asset with Index 1234 not found';
    assert.throws(() => runtime.optIntoASA(1234, john.address, {}), errMsg);
  });

  it("should warn if account already is already opted-into asset", () => {
    const spy = sinon.spy(console, 'warn');
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, john.address, {});

    // executing same opt-in tx again
    const warnMsg = `${john.address} is already opted in to asset ${assetId}`;
    runtime.optIntoASA(assetId, john.address, {});
    assert(spy.calledWith(warnMsg));
    spy.restore();
  });

  it("should transfer asset between two accounts", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, john.address, {});
    runtime.optIntoASA(assetId, alice.address, {});

    const initialJohnAssets = john.getAssetHolding(assetId)?.amount as number;
    const initialAliceAssets = alice.getAssetHolding(assetId)?.amount as number;
    assert.isDefined(initialJohnAssets);
    assert.isDefined(initialAliceAssets);

    assetTransferParam.assetID = assetId;
    assetTransferParam.amount = 100;
    runtime.executeTx(assetTransferParam);
    syncAccounts();

    assert.equal(john.getAssetHolding(assetId)?.amount, initialJohnAssets - 100);
    assert.equal(alice.getAssetHolding(assetId)?.amount, initialAliceAssets + 100);
  });

  it("should throw error on transfer asset if asset is frozen", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, john.address, {});
    runtime.optIntoASA(assetId, alice.address, {});
    // freezing asset holding for john
    runtime.freezeAsset(elon.address, assetId, john.address, true, {});

    assetTransferParam.assetID = assetId;
    const errMsg = `TEAL_ERR904: Asset index ${assetId} frozen for account ${john.address}`;
    assert.throws(() => runtime.executeTx(assetTransferParam), errMsg);
  });

  it("should close john account for transfer asset if close remainder to is specified", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    const res = runtime.getAssetDef(assetId);
    assert.isDefined(res);
    runtime.optIntoASA(assetId, john.address, {});
    runtime.optIntoASA(assetId, alice.address, {});

    syncAccounts();
    const initialJohnAssets = john.getAssetHolding(assetId)?.amount as number;
    const initialAliceAssets = alice.getAssetHolding(assetId)?.amount as number;
    assert.isDefined(initialJohnAssets);
    assert.isDefined(initialAliceAssets);

    assetTransferParam.assetID = assetId;
    assetTransferParam.amount = 0;
    assetTransferParam.payFlags = { totalFee: 1000, closeRemainderTo: alice.address };
    runtime.executeTx(assetTransferParam); // transfer all assets of john => alice (using closeRemTo)
    syncAccounts();

    assert.equal(john.getAssetHolding(assetId)?.amount, 0);
    assert.equal(alice.getAssetHolding(assetId)?.amount, initialAliceAssets + initialJohnAssets);
  });

  it("should throw error if asset is not found while modifying", () => {
    expectTealError(
      () => runtime.modifyAsset(john.address, 120, modFields, {}),
      ERRORS.ASA.ASSET_NOT_FOUND
    );
  });

  it("should modify asset", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    runtime.modifyAsset(elon.address, assetId, modFields, {});

    const res = runtime.getAssetDef(assetId);
    assert.equal(res.manager, bob.address);
    assert.equal(res.reserve, bob.address);
    assert.equal(res.clawback, john.address);
    assert.equal(res.freeze, john.address);
  });

  it("Blank field test, should not modify asset because field is set to blank", () => {
    const assetId = runtime.createAsset('silver',
      { creator: { ...john.account, name: "john" } });

    const modFields: AssetModFields = {
      manager: bob.address,
      reserve: bob.address,
      clawback: john.address,
      freeze: alice.address
    };

    expect(() => {
      runtime.modifyAsset(elon.address, assetId, modFields, {});
    }).to.throw("Cannot reset a blank address");
  });

  it("should fail because only manager account can modify asset", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    expect(() => {
      runtime.modifyAsset(bob.address, assetId, modFields, {});
    }).to.throw("Only Manager account can modify asset");
  });

  it("should fail because only freeze account can freeze asset", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    expect(() => {
      runtime.freezeAsset(bob.address, assetId, john.address, false, {});
    }).to.throw(Error, "Only Freeze account can freeze asset");
  });

  it("should freeze asset", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    runtime.optIntoASA(assetId, john.address, {});
    runtime.freezeAsset(elon.address, assetId, john.address, true, {});

    const johnAssetHolding = runtime.getAssetHolding(assetId, john.address);
    assert.equal(johnAssetHolding["is-frozen"], true);
  });

  it("should fail because only clawback account can revoke assets", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    expect(() => {
      runtime.revokeAsset(alice.address, john.address, assetId, bob.address, 1, {});
    }).to.throw(Error, "Only Clawback account can revoke assets");
  });

  it("should revoke assets", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    runtime.optIntoASA(assetId, john.address, {});
    runtime.optIntoASA(assetId, bob.address, {});

    assetTransferParam.toAccountAddr = bob.address;
    assetTransferParam.amount = 20;
    assetTransferParam.assetID = assetId;
    assetTransferParam.payFlags = {};

    runtime.executeTx(assetTransferParam);

    let bobHolding = runtime.getAssetHolding(assetId, bob.address);
    const beforeRevokeJohn = runtime.getAssetHolding(assetId, john.address).amount;
    assert.equal(bobHolding.amount, assetTransferParam.amount);

    runtime.revokeAsset(elon.address, john.address, assetId, bob.address, 15, {});

    const johnHolding = runtime.getAssetHolding(assetId, john.address);
    bobHolding = runtime.getAssetHolding(assetId, bob.address);
    assert.equal(beforeRevokeJohn + 15, johnHolding.amount);
    assert.equal(bobHolding.amount, 5);
  });

  it("should not revoke if asset is frozen", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    runtime.optIntoASA(assetId, john.address, {});
    runtime.optIntoASA(assetId, bob.address, {});

    assetTransferParam.toAccountAddr = bob.address;
    assetTransferParam.amount = 20;
    assetTransferParam.assetID = assetId;
    assetTransferParam.payFlags = {};
    runtime.executeTx(assetTransferParam);
    runtime.freezeAsset(elon.address, assetId, bob.address, true, {});

    const errMsg = `TEAL_ERR904: Asset index ${assetId} frozen for account ${bob.address}`;
    assert.throws(() =>
      runtime.revokeAsset(elon.address, john.address, assetId, bob.address, 15, {}), errMsg);
  });

  it("Should fail because only manager can destroy assets", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });
    runtime.optIntoASA(assetId, john.address, {});

    expect(() => {
      runtime.destroyAsset(alice.address, assetId, {});
    }).to.throw(Error, "Only Manager account can destroy assets");
  });

  it("Should destroy asset", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });
    runtime.optIntoASA(assetId, john.address, {});

    runtime.destroyAsset(elon.address, assetId, {});

    expectTealError(
      () => runtime.getAssetDef(assetId),
      ERRORS.ASA.ASSET_NOT_FOUND
    );
  });

  it("Should not destroy asset if total assets are not in creator's account", () => {
    const assetId = runtime.createAsset('gold',
      { creator: { ...john.account, name: "john" } });

    runtime.optIntoASA(assetId, john.address, {});
    runtime.optIntoASA(assetId, bob.address, {});

    assetTransferParam.toAccountAddr = bob.address;
    assetTransferParam.amount = 20;
    assetTransferParam.assetID = assetId;
    assetTransferParam.payFlags = {};
    runtime.executeTx(assetTransferParam);

    expect(() => {
      runtime.destroyAsset(elon.address, assetId, {});
    }).to.throw(Error, "All of the created assets should be in creator's account");
  });
});
