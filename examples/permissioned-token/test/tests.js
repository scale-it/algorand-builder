const {
  getProgram
} = require('@algo-builder/algob');
const { Runtime, AccountStore, types } = require('@algo-builder/runtime');
const { assert } = require('chai');

const minBalance = 20e6; // 20 ALGOs

const CLAWBACK = 'clawback.py';
const CONTROLLER = 'controller.py';
const PERMISSIONS = 'permissions.py';
const CLEAR_STATE = 'clear_state_program.py';

const ALICE_ADDRESS = 'EDXG4GGBEHFLNX6A7FGT3F6Z3TQGIU6WVVJNOXGYLVNTLWDOCEJJ35LWJY';

describe('Permissioned Token Tests', function () {
  let master = new AccountStore(10000e6);
  let alice, bob, elon;
  let runtime;
  let assetIndex, asaDef;
  let lsig, clawbackAddress;
  let controllerAppID, permissionsAppId;

  let CLAWBACK_PROGRAM;
  const CONTROLLER_PROGRAM = getProgram(CONTROLLER);
  const PERMISSIONS_PROGRAM = getProgram(PERMISSIONS);
  const CLEAR_STATE_PROGRAM = getProgram(CLEAR_STATE);

  function syncInfo () {
    master = runtime.getAccount(master.address);
    alice = runtime.getAccount(alice.address);
    bob = runtime.getAccount(bob.address);
    elon = runtime.getAccount(elon.address);
    asaDef = runtime.getAssetDef(assetIndex);
  }

  function optInToASA (acc) {
    runtime.optIntoASA(assetIndex, acc.address, {});
    syncInfo();
  }

  function optInToPermissions (address) {
    runtime.optInToApp(address, permissionsAppId, {}, {});
    syncInfo();
  }

  function issue (acc, amount) {
    const txns = [
      {
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: alice.account,
        appId: controllerAppID,
        payFlags: { totalFee: 1000 },
        appArgs: ['str:issue'],
        foreignAssets: [assetIndex]
      },
      {
        type: types.TransactionType.RevokeAsset,
        sign: types.SignType.LogicSignature,
        fromAccountAddr: clawbackAddress,
        recipient: acc.address,
        assetID: assetIndex,
        revocationTarget: alice.address,
        amount: amount,
        lsig: lsig,
        payFlags: { totalFee: 1000 }
      }
    ];
    runtime.executeTx(txns);
  }

  function killToken () {
    runtime.executeTx({
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: alice.account,
      appId: controllerAppID,
      payFlags: { totalFee: 1000 },
      appArgs: ['str:kill'],
      foreignAssets: [assetIndex]
    });
  }

  function whitelist (address) {
    optInToPermissions(address);
    runtime.executeTx({
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: alice.account,
      appId: permissionsAppId,
      payFlags: { totalFee: 1000 },
      appArgs: ['str:add_whitelist', `int:${controllerAppID}`],
      accounts: [address],
      foreignAssets: [assetIndex],
      foreignApps: [controllerAppID]
    });
  }

  this.beforeEach(async function () {
    // Create Accounts and Env
    alice = new AccountStore(minBalance, { addr: ALICE_ADDRESS, sk: new Uint8Array(0) });
    bob = new AccountStore(minBalance);
    elon = new AccountStore(minBalance);
    runtime = new Runtime([master, alice, bob, elon]);

    // Deploy ASA
    assetIndex = runtime.addAsset('gold', { creator: { ...alice.account, name: 'alice' } });
    asaDef = runtime.getAssetDef(assetIndex);

    // Setup Controller SSC
    let sscFlags = {
      sender: alice.account,
      localInts: 0,
      localBytes: 1,
      globalInts: 4,
      globalBytes: 2,
      appArgs: [`int:${assetIndex}`],
      foreignAssets: [assetIndex]
    };
    controllerAppID = runtime.addApp(
      sscFlags, {}, CONTROLLER_PROGRAM, CLEAR_STATE_PROGRAM
    );

    // Setup Permissions SSC
    sscFlags = {
      sender: alice.account,
      localInts: 1,
      localBytes: 0,
      globalInts: 3,
      globalBytes: 1,
      appArgs: [`int:${controllerAppID}`]
    };
    permissionsAppId = runtime.addApp(
      sscFlags, {}, PERMISSIONS_PROGRAM, CLEAR_STATE_PROGRAM
    );

    // Add permissions SSC config to Controller SSC
    const appArgs = [
      'str:add_permission',
      `int:${permissionsAppId}`,
      `addr:${alice.address}`
    ];
    runtime.executeTx({
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: alice.account,
      appId: controllerAppID,
      payFlags: { totalFee: 1000 },
      appArgs: appArgs,
      foreignAssets: [assetIndex]
    });

    // Deploy Clawback Lsig and Modify Asset
    CLAWBACK_PROGRAM = getProgram(CLAWBACK, {
      TOKEN_ID: assetIndex,
      CONTROLLER_APP_ID: controllerAppID
    });
    lsig = runtime.getLogicSig(CLAWBACK_PROGRAM, []);
    clawbackAddress = lsig.address();
    runtime.executeTx({
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: master.account,
      toAccountAddr: clawbackAddress,
      amountMicroAlgos: minBalance,
      payFlags: {}
    });
    runtime.executeTx({
      type: types.TransactionType.ModifyAsset,
      sign: types.SignType.SecretKey,
      fromAccount: alice.account,
      assetID: assetIndex,
      fields: {
        manager: asaDef.manager,
        reserve: asaDef.reserve,
        freeze: asaDef.freeze,
        clawback: clawbackAddress
      },
      payFlags: { totalFee: 1000 }
    });
    runtime.optIntoASA(assetIndex, clawbackAddress, {});
    syncInfo();
  });

  it('Token Issuance', () => {
    // Cannot issue before opting-in
    assert.throws(() => issue(elon, 20), 'RUNTIME_ERR1404');

    // Can issue after optin-in
    optInToASA(elon);
    // syncInfo();
    issue(elon, 20);
    assert.equal(20, runtime.getAssetHolding(assetIndex, elon.address).amount);

    // Cannot issue after killing token
    killToken();
    assert.throws(() => issue(elon, 20), 'RUNTIME_ERR1009');
  });

  it('Token Transfer', () => {
    // Issue some tokens to Bob and Elon
    optInToASA(elon);
    optInToASA(bob);
    issue(elon, 80);
    issue(bob, 100);

    const amount = 5;

    // Cannot transfer directly
    assert.throws(() => runtime.executeTx({
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: bob.account,
      toAccountAddr: elon.address,
      amount: amount,
      assetID: assetIndex,
      payFlags: {}
    }), 'RUNTIME_ERR1505');

    // Cannot transfer before being whitelisted
    const Gtxn = [
      {
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: bob.account,
        appId: controllerAppID,
        payFlags: { totalFee: 1000 },
        appArgs: ['str:transfer'],
        accounts: [elon.address]
      },
      {
        type: types.TransactionType.RevokeAsset,
        sign: types.SignType.LogicSignature,
        fromAccountAddr: clawbackAddress,
        recipient: elon.address,
        assetID: assetIndex,
        revocationTarget: bob.address,
        amount: amount,
        lsig: lsig,
        payFlags: { totalFee: 1000 }
      },
      {
        type: types.TransactionType.TransferAlgo,
        sign: types.SignType.SecretKey,
        fromAccount: bob.account,
        toAccountAddr: clawbackAddress,
        amountMicroAlgos: 1000,
        payFlags: { totalFee: 1000 }
      },
      {
        type: types.TransactionType.CallNoOpSSC,
        sign: types.SignType.SecretKey,
        fromAccount: bob.account,
        appId: permissionsAppId,
        payFlags: { totalFee: 1000 },
        appArgs: ['str:transfer'],
        accounts: [elon.address]
      }
    ];
    assert.throws(() => runtime.executeTx(Gtxn), 'RUNTIME_ERR1009');

    // Can transfer after being whitelisted
    whitelist(elon.address);
    whitelist(bob.address);
    const elonBalance = runtime.getAssetHolding(assetIndex, elon.address).amount;
    console.log(runtime.getAssetHolding(assetIndex, elon.address));
    console.log(runtime.getAssetHolding(assetIndex, bob.address));
    const bobBalance = runtime.getAssetHolding(assetIndex, elon.address).amount;
    runtime.executeTx(Gtxn);
    assert.equal(
      Number(runtime.getAssetHolding(assetIndex, elon.address).amount),
      Number(elonBalance) + amount
    );
    assert.equal(
      Number(runtime.getAssetHolding(assetIndex, elon.address).amount),
      Number(bobBalance) + amount
    );
  });
});
