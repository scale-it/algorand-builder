import { AssetParams } from "algosdk";

import { stringToBytes } from "../../src/lib/parsing";
import { AppLocalStateM, AssetHoldingM, SSCAttributesM, StackElem } from "../../src/types";
import { elonAddr } from "./txn";
import { BaseModel, BaseModelI } from '../../src/account';

const convertToKey = (str: string): string => { return stringToBytes(str).toString(); };

const appLocalState = new Map<number, AppLocalStateM>();
const createdApps = new Map<number, SSCAttributesM>();
const createdAssets = new Map<number, AssetParams>();

const assets = new Map<number, AssetHoldingM>();
assets.set(3, { 'asset-id': 3, amount: 2n, creator: "string", 'is-frozen': false });
assets.set(32, { 'asset-id': 32, amount: 2n, creator: "AS", 'is-frozen': false });

const globalStateMap = new Map<string, StackElem>();
globalStateMap.set(convertToKey('Hello'), stringToBytes('World'));
globalStateMap.set(convertToKey('global-key'), stringToBytes('global-val'));

const localStateMap = new Map<string, StackElem>();
localStateMap.set(convertToKey('Local-key'), stringToBytes('Local-val'));

let base: BaseModel = new BaseModelI();
export const accInfo = [{
  address: "addr-1",
  assets: assets,
  amount: 123,
  appsLocalState: appLocalState.set(1847, {
    id: 1847,
    'key-value': localStateMap,
    schema: {
      ...base,
      numByteSlice: 2,
      numUint: 1
    }
  }),
  appsTotalSchema: { ...base, 'numByteSlice': 583, 'numUint': 105 },
  createdApps: createdApps.set(1828, {
    'approval-program': '',
    'clear-state-program': '',
    creator: elonAddr,
    'global-state': globalStateMap,
    'global-state-schema': { ...base, 'numByteSlice': 3, 'numUint': 1 },
    'local-state-schema': { ...base, 'numByteSlice': 0, 'numUint': 16 }
  }),
  createdAssets: createdAssets.set(3, {
    creator: "addr-1",
    total: 10000n,
    decimals: 10,
    defaultFrozen: false,
    unitName: "AD",
    name: "ASSETAD",
    url: "assetUrl",
    metadataHash: "hash",
    manager: "addr-1",
    reserve: "addr-2",
    freeze: "addr-3",
    clawback: "addr-4",
    ...base
  })
}];
