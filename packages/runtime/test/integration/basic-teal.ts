import { assert } from "chai";

import { RUNTIME_ERRORS } from "../../src/errors/errors-list";
import { AccountStore, Runtime } from "../../src/index";
import { ALGORAND_ACCOUNT_MIN_BALANCE } from "../../src/lib/constants";
import { AlgoTransferParam, SignType, TransactionType, LogicSig } from "../../src/types";
import { getProgram } from "../helpers/files";
import { useFixture } from "../helpers/integration";
import { expectRuntimeError } from "../helpers/runtime-errors";

const minBalance = BigInt(ALGORAND_ACCOUNT_MIN_BALANCE + 1000); ; // 1000 to cover fee
const initialJohnHolding = minBalance + 2000n;
const initialBobHolding = minBalance + 500n;
const fee = 1000;

describe("Stateless Algorand Smart Contracts delegated signature mode", function () {
  useFixture("basic-teal");
  let john: AccountStore;
  let bob: AccountStore;
  let runtime: Runtime;
  let txnParams: AlgoTransferParam;

  this.beforeAll(async function () {
    john = new AccountStore(initialJohnHolding);
    bob = new AccountStore(initialBobHolding);
    runtime = new Runtime([john, bob]);

    txnParams = {
      type: TransactionType.TransferAlgo, // payment
      sign: SignType.LogicSignature,
      fromAccountAddr: john.account.addr,
      toAccountAddr: bob.address,
      amountMicroAlgos: 100n,
      lsig: {} as LogicSig, // will be set below
      payFlags: { totalFee: fee }
    };
  });

  // helper function
  function syncAccounts (): void {
    john = runtime.getAccount(john.address);
    bob = runtime.getAccount(bob.address);
  }

  it("should send algo's from john to bob if delegated logic check passes", function () {
    // check initial balance
    assert.equal(john.balance(), initialJohnHolding);
    assert.equal(bob.balance(), initialBobHolding);

    // make delegated logic signature
    const lsig = runtime.getLogicSig(getProgram('basic.teal'), []);
    lsig.sign(john.account.sk);

    runtime.executeTx({
      ...txnParams,
      sign: SignType.LogicSignature,
      fromAccountAddr: john.address,
      lsig: lsig
    });

    syncAccounts();
    assert.equal(john.balance(), initialJohnHolding - 100n - BigInt(fee));
    assert.equal(bob.balance(), initialBobHolding + 100n);
  });

  it("should fail if delegated logic check doesn't pass", function () {
    const johnBal = john.balance();
    const bobBal = bob.balance();
    const lsig = runtime.getLogicSig(getProgram('incorrect-logic.teal'), []);
    lsig.sign(john.account.sk);

    const invalidParam = {
      ...txnParams,
      lsig: lsig,
      amountMicroAlgos: 50n
    };

    // should fail because logic check fails
    expectRuntimeError(
      () => runtime.executeTx(invalidParam),
      RUNTIME_ERRORS.TEAL.REJECTED_BY_LOGIC
    );

    // accounts balance shouldn't be changed
    syncAccounts();
    assert.equal(john.balance(), johnBal);
    assert.equal(bob.balance(), bobBal);
  });
});
