const { getProgram } = require('@algo-builder/algob');
const {
  Runtime, AccountStore, types
} = require('@algo-builder/runtime');

const minBalance = 10e6; // 10 ALGO's

describe('Test-Example', function () {
  const creator = new AccountStore(minBalance);

  let runtime;
  let flags;
  let applicationId;
  const approvalProgram = getProgram('approval.py');
  const clearProgram = getProgram('clear.py');

  it('deploy, call test', () => {
    runtime = new Runtime([creator]);

    flags = {
      sender: creator.account,
      localInts: 1,
      localBytes: 0,
      globalInts: 5,
      globalBytes: 3
    };

    applicationId = runtime.addApp(
      { ...flags, appArgs: ['str:50'] }, {}, approvalProgram, clearProgram);

    const tx = {
      type: types.TransactionType.CallNoOpSSC,
      sign: types.SignType.SecretKey,
      fromAccount: creator.account,
      appId: applicationId,
      payFlags: { totalFee: 1000 }
    };

    runtime.executeTx(tx);
  });
});
