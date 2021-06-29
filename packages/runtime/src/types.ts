import {
  Account as AccountSDK,
  ApplicationStateSchema,
  AssetParams,
  EncodedLogicSig,
  EncodedMultisig,
  EncodedTransaction,
  MultisigMetadata
} from "algosdk";
import * as z from 'zod';

import {
  Add, Addr, Arg, Byte, Bytec,
  Bytecblock, Div, Int, Len, Mul,
  Pragma, Sub
} from "./interpreter/opcode-list";
import { TxnFields } from "./lib/constants";
import type { IStack } from "./lib/stack";
import type { ASADefSchema, ASADefsSchema } from "./types-input";

export type Operator = Len | Add | Sub |
Mul | Div | Arg | Bytecblock | Bytec | Addr | Int | Byte | Pragma;

export type AppArgs = Array<string | number>;

export type StackElem = bigint | Uint8Array;
export type TEALStack = IStack<bigint | Uint8Array>;

export interface Txn extends EncodedTransaction {
  txID: string
}

export type TxField = keyof typeof TxnFields[2];

export enum TxnType {
  unknown = '0', // Unknown type. Invalid transaction
  pay = '1', // Payment
  keyreg = '2', // KeyRegistration
  acfg = '3', // AssetConfig
  axfer = '4', // AssetTransfer
  afrz = '5', // AssetFreeze
  appl = '6' // ApplicationCall
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

export enum EncodingType {
  BASE64,
  BASE32,
  HEX,
  UTF8
}

export type AccountAddress = string;

export interface AccountsMap {
  [addr: string]: AccountStoreI
}

/**
 * RuntimeAccountMap is for AccountStore used in runtime
 * (where we use maps instead of arrays in sdk structures). */
export type RuntimeAccountMap = Map<string, AccountStoreI>;

export interface State {
  accounts: Map<string, AccountStoreI>
  globalApps: Map<number, string>
  assetDefs: Map<number, AccountAddress>
  assetNameInfo: Map<string, ASAInfo>
  appNameInfo: Map<string, SSCInfo>
  appCounter: number
  assetCounter: number
}

export interface DeployedAssetInfo {
  creator: AccountAddress
  txId: string
  confirmedRound: number
  deleted: boolean
}

// ASA deployment information (log)
export interface ASAInfo extends DeployedAssetInfo {
  assetIndex: number
  assetDef: ASADef
}

// Stateful smart contract deployment information (log)
export interface SSCInfo extends DeployedAssetInfo {
  appID: number
  timestamp: number
}

// describes interpreter's local context (state + txns)
export interface Context {
  state: State
  tx: Txn // current txn
  gtxs: Txn[] // all transactions
  args?: Uint8Array[]
  debugStack?: number //  max number of top elements from the stack to print after each opcode execution.
  getAccount: (address: string) => AccountStoreI
  getAssetAccount: (assetId: number) => AccountStoreI
  getApp: (appID: number, line?: number) => SSCAttributesM
  transferAlgo: (txnParam: AlgoTransferParam) => void
  deductFee: (sender: AccountAddress, index: number) => void
  transferAsset: (txnParam: AssetTransferParam) => void
  modifyAsset: (assetId: number, fields: AssetModFields) => void
  freezeAsset: (assetId: number, freezeTarget: string, freezeState: boolean) => void
  revokeAsset: (
    recipient: string, assetID: number,
    revocationTarget: string, amount: bigint
  ) => void
  destroyAsset: (assetId: number) => void
  deleteApp: (appID: number) => void
  closeApp: (sender: AccountAddress, appID: number) => void
  processTransactions: (txnParams: ExecParams[]) => void
  addAsset: (name: string, fromAccountAddr: AccountAddress, flags: ASADeploymentFlags) => number
  optIntoASA: (assetIndex: number, address: AccountAddress, flags: TxParams) => void
  addApp: (
    fromAccountAddr: string, flags: SSCDeploymentFlags,
    approvalProgram: string, clearProgram: string
  ) => number
  optInToApp: (accountAddr: string, appID: number) => void
  updateApp: (appID: number, approvalProgram: string, clearProgram: string) => void
}

// custom AssetHolding for AccountStore (using bigint in amount instead of number)
export interface AssetHoldingM {
  amount: bigint
  'asset-id': number
  creator: string
  'is-frozen': boolean
}

// custom AppsLocalState for AccountStore (using maps instead of array in 'key-value')
export interface AppLocalStateM {
  id: number
  'key-value': Map<string, StackElem> // string represents bytes as string eg. 11,22,34
  schema: ApplicationStateSchema
}

// custom SSCAttributes for AccountStore (using maps instead of array in 'global-state')
export interface SSCAttributesM {
  'approval-program': string
  'clear-state-program': string
  creator: string
  'global-state': Map<string, StackElem>
  'global-state-schema': ApplicationStateSchema
  'local-state-schema': ApplicationStateSchema
}

// custom CreatedApp for AccountStore
export interface CreatedAppM {
  id: number
  attributes: SSCAttributesM
}

// represent account used in tests and by the context
// NOTE: custom notations are used rather than SDK AccountState notations
export interface AccountStoreI {
  address: string
  assets: Map<number, AssetHoldingM>
  amount: bigint
  minBalance: number
  appsLocalState: Map<number, AppLocalStateM>
  appsTotalSchema: ApplicationStateSchema
  createdApps: Map<number, SSCAttributesM>
  createdAssets: Map<number, AssetParams>
  account: AccountSDK

  balance: () => bigint
  getApp: (appID: number) => SSCAttributesM | undefined
  getAppFromLocal: (appID: number) => AppLocalStateM | undefined
  addApp: (appID: number, params: SSCDeploymentFlags,
    approvalProgram: string, clearProgram: string) => CreatedAppM
  getAssetDef: (assetId: number) => AssetParams | undefined
  getAssetHolding: (assetId: number) => AssetHoldingM | undefined
  addAsset: (assetId: number, name: string, asadef: ASADef) => AssetParams
  modifyAsset: (assetId: number, fields: AssetModFields) => void
  closeAsset: (assetId: number) => void
  setFreezeState: (assetId: number, state: boolean) => void
  destroyAsset: (assetId: number) => void
  optInToApp: (appID: number, appParams: SSCAttributesM) => void
  optInToASA: (assetIndex: number, assetHolding: AssetHoldingM) => void
  deleteApp: (appID: number) => void
  closeApp: (appID: number) => void
  getLocalState: (appID: number, key: Uint8Array | string) => StackElem | undefined
  setLocalState: (appID: number, key: Uint8Array | string, value: StackElem, line?: number) => AppLocalStateM
  getGlobalState: (appID: number, key: Uint8Array | string) => StackElem | undefined
  setGlobalState: (appID: number, key: Uint8Array | string, value: StackElem, line?: number) => void
}

/**
 * https://developer.algorand.org/docs/reference/teal/specification/#oncomplete */
export enum TxnOnComplete {
  NoOp = '0',
  OptIn = '1',
  CloseOut = '2',
  ClearState = '3',
  UpdateApplication = '4',
  DeleteApplication = '5'
}

/**
 * https://developer.algorand.org/docs/reference/teal/specification/#execution-modes */
export enum ExecutionMode {
  SIGNATURE, // stateless TEAL
  APPLICATION // application call (NoOp, CloseOut..)
}

/**
 * Common transaction parameters (fees, note..) */
export interface TxParams {
  /**
   * feePerByte or totalFee is used to set the appropriate transaction fee parameter.
   * If both are set then totalFee takes precedence.
   * NOTE: SDK expects`fee: number` and boolean `flatFee`. But the API expects only one
   * on parameter: `fee`. Here, we define feePerByte and totalFee - both as numberic
   * parameters. We think that this is more explicit. */
  feePerByte?: number
  totalFee?: number
  // The first round for when the transaction is valid.
  firstValid?: number
  // firstValid + validRounds will give us the ending round for which the transaction is valid.
  validRounds?: number
  // A lease enforces mutual exclusion of transactions.
  lease?: Uint8Array
  // Any data up to 1000 bytes.
  note?: string
  noteb64?: string
  // When set, it indicates that the transaction is requesting
  // that the Sender account should be closed, and all remaining
  // funds, after the fee and amount are paid, be transferred to this address.
  closeRemainderTo?: AccountAddress
  // Specifies the authorized address.
  rekeyTo?: AccountAddress
  // you can learn more about these parameters here.(https://developer.algorand.org/docs/reference/transactions/#common-fields-header-and-type)
}

/**
 * Stateful Smart contract flags for specifying sender and schema */
export interface SSCDeploymentFlags extends SSCOptionalFlags {
  sender: AccountSDK
  localInts: number
  localBytes: number
  globalInts: number
  globalBytes: number
}

/**
 * Stateful smart contract transaction optional parameters (accounts, args..). */
export interface SSCOptionalFlags {
  /**
   * Transaction specific arguments accessed from
   * the application's approval-program and clear-state-program.
   */
  appArgs?: Array<Uint8Array | string>
  /**
   * List of accounts in addition to the sender that may
   * be accessed from the application's approval-program and clear-state-program.
   */
  accounts?: string[]
  /**
   * Lists the applications in addition to the application-id
   * whose global states may be accessed by this
   * application's approval-program and clear-state-program. The access is read-only.
   */
  foreignApps?: number[]
  /**
   * Lists the assets whose AssetParams may be accessed by
   * this application's approval-program and clear-state-program.
   * The access is read-only.
   */
  foreignAssets?: number[]
  // Any data up to 1000 bytes.
  note?: Uint8Array
  // A lease enforces mutual exclusion of transactions.
  lease?: Uint8Array
  // you can learn more about these parameters from here.(https://developer.algorand.org/docs/reference/transactions/#application-call-transaction)
}

/**
 * Transaction execution parameters (on blockchain OR runtime) */
export type ExecParams = AlgoTransferParam | AssetTransferParam | SSCCallsParam |
ModifyAssetParam | FreezeAssetParam | RevokeAssetParam |
DestroyAssetParam | DeployASAParam | DeploySSCParam |
OptInSSCParam | OptInASAParam | UpdateSSCParam;

export enum SignType {
  SecretKey,
  LogicSignature
}

export enum TransactionType {
  TransferAlgo,
  TransferAsset,
  ModifyAsset,
  FreezeAsset,
  RevokeAsset,
  DestroyAsset,
  CallNoOpSSC,
  ClearSSC,
  CloseSSC,
  DeleteSSC,
  DeployASA,
  DeploySSC,
  OptInASA,
  OptInSSC,
  UpdateSSC
}

interface SignWithSk {
  sign: SignType.SecretKey
  fromAccount: AccountSDK
  /**
   * if passed then it will be used as the from account address, but tx will be signed
   * by fromAcount's sk. This is used if an account address is rekeyed to another account. */
  fromAccountAddr?: AccountAddress
}

interface SignWithLsig {
  sign: SignType.LogicSignature
  fromAccountAddr: AccountAddress
  lsig: LogicSig
  /** stateless smart contract args */
  args?: Uint8Array[]
}

export type Sign = SignWithSk | SignWithLsig;

export type BasicParams = Sign & {
  payFlags: TxParams
};

export type DeployASAParam = BasicParams & {
  type: TransactionType.DeployASA
  asaName: string
  asaDef?: Partial<ASADef>
};

export type DeploySSCParam = BasicParams & SSCOptionalFlags & {
  type: TransactionType.DeploySSC
  approvalProgram: string
  clearProgram: string
  localInts: number
  localBytes: number
  globalInts: number
  globalBytes: number
  approvalProg?: Uint8Array
  clearProg?: Uint8Array
};

export type UpdateSSCParam = BasicParams & SSCOptionalFlags & {
  type: TransactionType.UpdateSSC
  appID: number
  newApprovalProgram: string
  newClearProgram: string
  approvalProg?: Uint8Array
  clearProg?: Uint8Array
};

export type OptInSSCParam = BasicParams & SSCOptionalFlags & {
  type: TransactionType.OptInSSC
  appID: number
};

export type OptInASAParam = BasicParams & {
  type: TransactionType.OptInASA
  assetID: number | string
};

export type ModifyAssetParam = BasicParams & {
  type: TransactionType.ModifyAsset
  assetID: number | string
  fields: AssetModFields
};

export type FreezeAssetParam = BasicParams & {
  type: TransactionType.FreezeAsset
  assetID: number | string
  freezeTarget: AccountAddress
  freezeState: boolean
};

export type RevokeAssetParam = BasicParams & {
  type: TransactionType.RevokeAsset
  /**
   * Revoked assets are sent to this address
   */
  recipient: AccountAddress
  assetID: number | string
  /** Revocation target is the account from which the clawback revokes asset. */
  revocationTarget: AccountAddress
  amount: number | bigint
};

export type DestroyAssetParam = BasicParams & {
  type: TransactionType.DestroyAsset
  assetID: number | string
};

export type AlgoTransferParam = BasicParams & {
  type: TransactionType.TransferAlgo
  toAccountAddr: AccountAddress
  amountMicroAlgos: number | bigint
};

export type AssetTransferParam = BasicParams & {
  type: TransactionType.TransferAsset
  toAccountAddr: AccountAddress
  amount: number | bigint
  assetID: number | string
};

export type SSCCallsParam = BasicParams & SSCOptionalFlags & {
  type: TransactionType.CallNoOpSSC | TransactionType.ClearSSC |
  TransactionType.CloseSSC | TransactionType.DeleteSSC
  appID: number
};

export interface AnyMap {
  [key: string]: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface Account extends AccountSDK {
  // from AccountSDK: addr: string;
  //                  sk: Uint8Array
  name: string
}

export interface ASADeploymentFlags extends TxParams {
  creator: Account
}

/**
 * SDK account type, used in algob */
export type AccountMap = Map<string, Account>;

export type ASADef = z.infer<typeof ASADefSchema>;

export type ASADefs = z.infer<typeof ASADefsSchema>;

/**
 * After an asset has been created only the manager,
 * reserve, freeze and reserve accounts can be changed.
 * All other parameters are locked for the life of the asset.
 */
export interface AssetModFields {
  manager?: string
  reserve?: string
  freeze?: string
  clawback?: string
}

/**
 * SDK decoding types (Configure how the integer will be decoded)
 * https://github.com/algorand/js-algorand-sdk/blob/develop/src/encoding/uint64.ts#L29
 */
export enum DecodingMode {
  SAFE = 'safe',
  MIXED = 'mixed',
  BIGINT = 'bigint'
}

interface LogicSigStorageStructure {
  tag: Buffer
  logic: Uint8Array
  args: Uint8Array[]
  sig?: Uint8Array
  msig?: EncodedMultisig
}

/** Algosdk types */
export interface LogicSig extends LogicSigStorageStructure {

  get_obj_for_encoding: () => EncodedLogicSig
  from_obj_for_encoding: (encoded: EncodedLogicSig) => LogicSig

  // Performs signature verification
  verify: (msg: Uint8Array) => boolean
  // Compute hash of the logic sig program (that is the same as escrow account address) as string address
  address: () => string
  // Creates signature (if no msig provided) or multi signature otherwise
  sign: (secretKey: Uint8Array, msig?: MultisigMetadata) => void
  // Signs and appends a signature
  appendToMultisig: (secretKey: Uint8Array) => void
  // signs and returns program signature, without appending it to this object
  signProgram: (secretKey: Uint8Array) => Uint8Array
  singleSignMultisig: (secretKey: Uint8Array, msig: EncodedMultisig) => [Uint8Array, number]
  // serializes and encodes the LogicSig
  toByte: () => Uint8Array
  // deserializes a LogicSig which was serialized using toByte()
  fromByte: (encoded: Uint8Array) => LogicSig
}
