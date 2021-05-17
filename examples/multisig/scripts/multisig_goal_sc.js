/**
 * Description:
 *  This script demonstrates a transaction validated by an asc
 *  signed by multisig account with a threshold of 2
    User saves the signed logic in assets/ which is extracted and used here.
*/
const { executeTransaction } = require('./common/common');
const { createMsigAddress } = require('@algo-builder/algob');
const { types } = require('@algo-builder/runtime');

async function run (runtimeEnv, deployer) {
  const masterAccount = deployer.accountsByName.get('master-account');
  const alice = deployer.accountsByName.get('alice');
  const john = deployer.accountsByName.get('john');
  const bob = deployer.accountsByName.get('bob');

  // Generate multi signature account hash
  const addrs = [alice.addr, john.addr, bob.addr]; // you can replace these addresses with your custom addrs for multisig account.
  const [mparams, multsigaddr] = createMsigAddress(1, 2, addrs); // passing (version, threshold, address list)
  console.log('mparams: %s multisigaddr: %s \n', mparams, multsigaddr);

  let txnParams = {
    type: types.TransactionType.TransferAlgo,
    sign: types.SignType.SecretKey,
    fromAccount: masterAccount,
    toAccountAddr: multsigaddr,
    amountMicroAlgos: 10000000,
    payFlags: { note: 'Funding multisig account', totalFee: 500 } // totalFee will be converted to 1000 as it is minimum required transaction fee
  };
  // Funding multisignature account
  await executeTransaction(deployer, txnParams);
  // below we can also use an lsig using a decompiled file
  // generated by goal (goal clerk compile -D <path_to_file>)
  // const lsig = await deployer.loadMultiSig("sample-text-asc.lsig");

  await deployer.addCheckpointKV('User Checkpoint', 'Fund Multisignature Account');

  const lsig = await deployer.loadMultiSig('sample-raw-asc.blsig');

  // use below line to append bob signature to loaded multisig from file.
  // note: not required in this case as loaded lsig has 2 signtatures & msig threshold is also 2
  // signLogicSigMultiSig(lsig, john);

  txnParams = {
    type: types.TransactionType.TransferAlgo,
    sign: types.SignType.LogicSignature,
    fromAccountAddr: multsigaddr,
    toAccountAddr: bob.addr,
    amountMicroAlgos: 20,
    lsig: lsig,
    payFlags: {}
  };
  // Transaction PASSES
  await executeTransaction(deployer, txnParams);

  // Transaction FAIL - according to teal logic, amount should be <= 100
  txnParams.amountMicroAlgos = 200;
  await executeTransaction(deployer, txnParams);
}

module.exports = { default: run };
