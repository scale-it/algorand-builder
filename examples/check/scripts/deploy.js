const {
  executeTransaction
} = require('@algo-builder/algob');
const { types } = require('@algo-builder/runtime');

async function run (runtimeEnv, deployer) {
  const masterAccount = deployer.accountsByName.get('master-account');
  const creatorAccount = deployer.accountsByName.get('alice');

  const algoTxnParams = {
    type: types.TransactionType.TransferAlgo,
    sign: types.SignType.SecretKey,
    fromAccount: masterAccount,
    toAccountAddr: creatorAccount.addr,
    amountMicroAlgos: 200000000,
    payFlags: {}
  };
  await executeTransaction(deployer, algoTxnParams);

  const sscInfo = await deployer.deploySSC(
    'approval.py', // approval program
    'clear.py', // clear program
    {
      sender: creatorAccount,
      localInts: 3,
      localBytes: 3,
      globalInts: 3,
      globalBytes: 3,
      appArgs: ['str:50']
    }, {});

  console.log('Application Delpoyed!', sscInfo);

  // Assert for Int(50) == Btoi(Bytes("50"))
  const callTx = {
    type: types.TransactionType.CallNoOpSSC,
    sign: types.SignType.SecretKey,
    fromAccount: creatorAccount,
    appId: sscInfo.appID,
    payFlags: {}
  };

  await executeTransaction(deployer, callTx);
}

module.exports = { default: run };
