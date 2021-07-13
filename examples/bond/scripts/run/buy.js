const {
  executeTransaction, convert
} = require('@algo-builder/algob');
const { types } = require('@algo-builder/web');

async function run (runtimeEnv, deployer) {
  const masterAccount = deployer.accountsByName.get('master-account');
  const creatorAccount = deployer.accountsByName.get('john');
  const buyerAccount = deployer.accountsByName.get('bob');
  const storeManagerAccount = deployer.accountsByName.get('alice');

  const algoTxnParams = {
    type: types.TransactionType.TransferAlgo,
    sign: types.SignType.SecretKey,
    fromAccount: masterAccount,
    toAccountAddr: buyerAccount.addr,
    amountMicroAlgos: 200000000,
    payFlags: {}
  };
  await executeTransaction(deployer, algoTxnParams);

  const appInfo = deployer.getApp('bond-dapp-stateful.py', 'bond-dapp-clear.py');
  const scInitParam = {
    TMPL_APPLICATION_ID: appInfo.appID,
    TMPL_OWNER: creatorAccount.addr,
    TMPL_STORE_MANAGER: storeManagerAccount.addr
  };
  const issuerLsig = await deployer.loadLogic('issuer-lsig.py', scInitParam);
  const asaInfo = deployer.getASAInfo('bond-token');
  await deployer.optInAcountToASA(asaInfo.assetIndex, 'bob', { totalFee: 1000 });

  const algoAmount = 10 * 1000 + 1000;

  const groupTx = [
    // Algo transfer from buyer to issuer
    {
      type: types.TransactionType.TransferAlgo,
      sign: types.SignType.SecretKey,
      fromAccount: buyerAccount,
      toAccountAddr: issuerLsig.address(),
      amountMicroAlgos: algoAmount,
      payFlags: {}
    },
    // Bond token transfer from issuer's address
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.LogicSignature,
      fromAccountAddr: issuerLsig.address(),
      lsig: issuerLsig,
      toAccountAddr: buyerAccount.addr,
      amount: 10,
      assetID: asaInfo.assetIndex,
      payFlags: { totalFee: 1000 }
    },
    // call to bond-dapp
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: buyerAccount,
      appID: appInfo.appID,
      payFlags: {},
      appArgs: ['str:buy']
    }
  ];

  console.log('Buying tokens!');
  await executeTransaction(deployer, groupTx);
  console.log('Tokens Bought!');
}

module.exports = { default: run };
