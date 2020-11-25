/**
 * Description:
 *  This script demonstrates a transaction validated by an asc signed by multisig account with a threshold of 2
    User saves the signed logic in assets/ which is extracted and used here.
*/
const { executeTransaction } = require("./common/common");
const { TransactionType, SignType, createMsigAddress } = require("algob");

async function run(runtimeEnv, deployer) {
  const masterAccount = deployer.accountsByName.get("master-account")
  const alice = deployer.accountsByName.get("alice-account");
  const johnAccount = deployer.accountsByName.get("john-account");
  const bobAccount = deployer.accountsByName.get("bob-account");

  //Generate multi signature account hash
  const addrs =  [alice.addr, johnAccount.addr, bobAccount.addr]  // you can replace these addresses with your custom addrs for multisig account.
  const [mparams, multsigaddr] = createMsigAddress(1, 2, addrs);   // passing (version, threshold, address list)

  let txnParams = {
    type: TransactionType.TransferAlgo,
    sign: SignType.SecretKey,
    fromAccount: masterAccount,
    toAccountAddr: multsigaddr,
    amountMicroAlgos: 10000000,
    payFlags: {note: "Funding multisig account"}
  }
  //Funding multisignature account
  await executeTransaction(deployer, txnParams);
  // below we can also use an lsig using a decompiled file generated by goal (goal clerk compile -D <path_to_file>)
  // const lsig = await deployer.loadMultiSig("sample-text-asc.lsig", []);

  const lsig = await deployer.loadMultiSig("sample-raw-asc.blsig");

  txnParams = {
    type: TransactionType.TransferAlgo,
    sign: SignType.LogicSignature,
    fromAccount: { addr: multsigaddr },
    toAccountAddr: bobAccount.addr,
    amountMicroAlgos: 20,
    lsig: lsig,
    payFlags: {}
  }
  // Transaction PASSES
  await executeTransaction(deployer, txnParams);

  // Transaction FAIL - according to teal logic, amount should be <= 100
  txnParams.amountMicroAlgos = 200;
  await executeTransaction(deployer, txnParams);
}

module.exports = { default: run }
