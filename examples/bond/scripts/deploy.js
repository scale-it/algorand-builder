const {
  executeTransaction, convert
} = require('@algo-builder/algob');
const { types } = require('@algo-builder/web');

async function run (runtimeEnv, deployer) {
  const masterAccount = deployer.accountsByName.get('master-account');
  const storeManagerAccount = deployer.accountsByName.get('alice');
  const creatorAccount = deployer.accountsByName.get('john');

  const algoTxnParams = {
    type: types.TransactionType.TransferAlgo,
    sign: types.SignType.SecretKey,
    fromAccount: masterAccount,
    toAccountAddr: storeManagerAccount.addr,
    amountMicroAlgos: 200000000,
    payFlags: {}
  };
  await executeTransaction(deployer, algoTxnParams);
  algoTxnParams.toAccountAddr = creatorAccount.addr;
  await executeTransaction(deployer, algoTxnParams);

  // Create B_0 - Bond Token
  const asaInfo = await deployer.deployASA('bond-token', { creator: creatorAccount });
  console.log(asaInfo);

  // Bond-Dapp initialization parameters
  const storeManager = convert.addressToPk(storeManagerAccount.addr);
  const issuePrice = 'int:1000';
  const nominalPrice = 'int:1000';
  const maturityDate = convert.uint64ToBigEndian(Math.round(new Date().getTime() / 1000) + 1000);
  const couponValue = 'int:100';
  const epoch = 'int:0';
  const currentBond = convert.uint64ToBigEndian(asaInfo.assetIndex);
  const asset = await deployer.getAssetByID(asaInfo.assetIndex);
  const maxAmount = convert.uint64ToBigEndian(asset.params.total);

  const appArgs = [
    storeManager,
    issuePrice,
    nominalPrice,
    maturityDate,
    couponValue,
    epoch,
    currentBond,
    maxAmount
  ];

  // Create Application
  const appInfo = await deployer.deployApp(
    'bond-dapp-stateful.py',
    'bond-dapp-clear.py', {
      sender: storeManagerAccount,
      localInts: 1,
      localBytes: 1,
      globalInts: 8,
      globalBytes: 15,
      appArgs: appArgs
    }, {});
  console.log(appInfo);

  // Initialize issuer lsig with bond-app ID
  const scInitParam = {
    TMPL_APPLICATION_ID: appInfo.appID,
    TMPL_OWNER: creatorAccount.addr
  };
  const issuerLsig = await deployer.loadLogic('issuer-lsig.py', scInitParam);

  await deployer.optInLsigToASA(asaInfo.assetIndex, issuerLsig, { totalFee: 1000 });

  // update issuer address in bond-dapp
}

module.exports = { default: run };
