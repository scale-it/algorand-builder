const {
  executeTransaction, convert
} = require('@algo-builder/algob');
const { types } = require('@algo-builder/web');

async function run (runtimeEnv, deployer) {
  const creatorAccount = deployer.accountsByName.get('john');

  const appInfo = deployer.getApp('bond-dapp-stateful.py', 'bond-dapp-clear.py');
  const scInitParam = {
    TMPL_APPLICATION_ID: appInfo.appID,
    TMPL_OWNER: creatorAccount.addr
  };
  const issuerLsig = await deployer.loadLogic('issuer-lsig.py', scInitParam);
  const asaInfo = deployer.getASAInfo('bond-token');

  const groupTx = [
    // Bond asa transfer from issuer's address
    {
      type: types.TransactionType.TransferAsset,
      sign: types.SignType.SecretKey,
      fromAccount: creatorAccount,
      toAccountAddr: issuerLsig.address(),
      amount: 1e6,
      assetID: asaInfo.assetIndex,
      payFlags: { }
    },
    // call to bond-dapp
    {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: creatorAccount,
      appID: appInfo.appID,
      payFlags: {},
      appArgs: ['str:burn']
    }
  ];

  console.log('Burning tokens!');
  await executeTransaction(deployer, groupTx);
  console.log('Tokens burned!');
}

module.exports = { default: run };
