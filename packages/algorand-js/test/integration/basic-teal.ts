import { assert } from "chai";

import { ERRORS } from "../../src/errors/errors-list";
import { Runtime } from "../../src/index";
import { StoreAccountImpl } from "../../src/runtime/account";
import { expectTealErrorAsync } from "../helpers/errors";
import { useFixtureProject } from "../helpers/project";

describe("Algorand Smart Contracts", function () {
  useFixtureProject("smart-contracts");

  const john = new StoreAccountImpl(1000);
  const bob = new StoreAccountImpl(500);
  // set up transaction paramenters
  const txnParams = {
    type: 0, // payment
    sign: 0,
    fromAccount: john.account,
    toAccountAddr: bob.address,
    amountMicroAlgos: 100,
    payFlags: { totalFee: 1000 }
  };

  let runtime: Runtime;
  this.beforeAll(function () {
    runtime = new Runtime([john, bob]); // setup test
  });

  it("should send algo's from john to bob if stateless teal logic is correct", async function () {
    // check initial balance
    assert.equal(john.balance(), 1000);
    assert.equal(bob.balance(), 500);

    // execute transaction
    await runtime.executeTx(txnParams, 'basic.teal', []);

    assert.equal(john.balance(), 900); // check if 100 microAlgo's are withdrawn
    assert.equal(bob.balance(), 600);
  });

  it("should throw error if logic is incorrect", async function () {
    // initial balance
    const escrowBal = john.balance();
    const johnBal = bob.balance();

    const invalidParams = Object.assign({}, txnParams);
    invalidParams.amountMicroAlgos = 50;

    // execute transaction (should fail is logic is incorrect)
    await expectTealErrorAsync(
      async () => await runtime.executeTx(invalidParams, 'incorrect-logic.teal', []),
      ERRORS.TEAL.INVALID_STACK_ELEM
    );

    // verify account balance remains unchanged
    assert.equal(john.balance(), escrowBal);
    assert.equal(bob.balance(), johnBal);
  });
});
