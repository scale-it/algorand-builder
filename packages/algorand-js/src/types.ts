import { TxnEncodedObj } from "algosdk";

import {
  Add, Addr, Arg, Byte, Bytec, Bytecblock, Div, Int, Len, Mul, Pragma,
  Sub
} from "./interpreter/opcode-list";
import { TxnFields } from "./lib/constants";
import type { IStack } from "./lib/stack";

export type Operator = Len | Add | Sub |
Mul | Div | Arg | Bytecblock | Bytec | Addr | Int | Byte | Pragma;

export type AppArgs = Array<string | number>;

export type StackElem = bigint | Uint8Array;
export type TEALStack = IStack<bigint | Uint8Array>;

export interface Txn extends TxnEncodedObj {
  txID: string
}

export type TxField = keyof typeof TxnFields;

export enum TxnType {
  unknown, // Unknown type. Invalid transaction
  pay, // Payment
  keyreg, // KeyRegistration
  acfg, // AssetConfig
  axfer, // AssetTransfer
  afrz, // AssetFreeze
  appl // ApplicationCall
}

export enum GlobalField {
  MinTxnFee, // micro Algos
  MinBalance, // micro Algos
  MaxTxnLife, // rounds
  ZeroAddress, // 32 byte address of all zero bytes
  GroupSize, // Number of transactions in this atomic transaction group. At least 1
  LogicSigVersion, // Maximum supported TEAL version.
  Round, // Current round number
  LatestTimestamp, // Last confirmed block UNIX timestamp. Fails if negative.
  CurrentApplicationID // ID of current application executing. Fails if no such application is executing.
}

// will be mapped to a specific account
export enum AssetHolding {
  AssetBalance, // Amount of the asset unit held by this account
  AssetFrozen // Is the asset frozen or not
}

// this is for global storage
export enum AssetParam {
  AssetTotal, // Total number of units of this asset
  AssetDecimals, // See AssetParams.Decimals
  AssetDefaultFrozen, // Frozen by default or not
  AssetUnitName, // Asset unit name
  AssetName, // Asset name
  AssetURL, // URL with additional info about the asset
  AssetMetadataHash, // Arbitrary commitment
  AssetManager, // Manager commitment
  AssetReserve, // Reserve address
  AssetFreeze, // Freeze address
  AssetClawback // Clawback address
}

export enum EncodingType {
  BASE64,
  BASE32,
  HEX,
  UTF8
}
