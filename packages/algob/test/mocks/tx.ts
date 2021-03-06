import algosdk, { Algodv2, AssetInfo, ConfirmedTxInfo, LogicSig, SuggestedParams } from "algosdk";

import { bobAcc } from "./account";

export const mockAlgod = new Algodv2("dummyToken", "https://dummyNetwork", 8080);

export const mockSuggestedParam: SuggestedParams = {
  flatFee: false,
  fee: 100,
  firstRound: 2,
  lastRound: 100,
  genesisID: 'testnet-v1.0',
  genesisHash: 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI='
};

export const mockConfirmedTx: ConfirmedTxInfo = {
  'confirmed-round': 1,
  "asset-index": 1,
  'application-index': 1,
  'global-state-delta': "string",
  'local-state-delta': "string"
};

export const mockAssetInfo: AssetInfo = {
  index: 1,
  params: {
    creator: "addr-1",
    total: 1000,
    decimals: 8,
    defaultFrozen: false,
    unitName: "TKN",
    name: "ASA-1",
    url: "link",
    metadataHash: "12312442142141241244444411111133",
    manager: bobAcc.addr,
    reserve: undefined,
    freeze: bobAcc.addr,
    clawback: undefined
  }
};

const mockProgram = new Uint8Array([
  2, 32, 4, 1, 4, 100, 144, 78, 49, 16,
  34, 18, 49, 16, 35, 18, 17, 49, 8, 36,
  14, 16, 49, 18, 36, 14, 16, 49, 32, 50,
  3, 18, 16, 49, 9, 50, 3, 18, 16, 49,
  1, 37, 14, 16
]);

export const mockLsig = algosdk.makeLogicSig(mockProgram, []);
