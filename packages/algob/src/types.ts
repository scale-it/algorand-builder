import { types as rtypes } from "@algo-builder/runtime";
import { ASADef } from "@algo-builder/runtime/build/types";
import * as algosdk from "algosdk";

import * as types from "./internal/core/params/argument-types";
// Begin config types

// IMPORTANT: This t.types MUST be kept in sync with the actual types.

export type Timestamp = number;

export interface Account {
  name: string
  mnemonic: string
}

export interface HDAccount {
  mnemonic: string
  initialIndex?: number
  count?: number
  path: string
}

export interface MnemonicAccount {
  name: string
  addr: string
  mnemonic: string
}

export type AccountDef =
  | MnemonicAccount
  | HDAccount
  | rtypes.Account;

interface CommonNetworkConfig {
  accounts: rtypes.Account[]
  // optional, when provided KMD accounts will be loaded by the config resolver
  // and merged into the accounts variable (above)
  kmdCfg?: KmdCfg
  chainName?: string
  // from?: string;
  // TODO: timeout?: number;
}

export interface ChainCfg extends CommonNetworkConfig {
  throwOnTransactionFailures?: boolean
  throwOnCallFailures?: boolean
  loggingEnabled?: boolean
  initialDate?: string
}

export interface HttpNetworkConfig extends CommonNetworkConfig {
  host: string // with optional http o https prefix
  port: number
  token: string
  httpHeaders?: { [name: string]: string }
}

export type NetworkConfig = ChainCfg | HttpNetworkConfig;

export interface Networks {
  [networkName: string]: NetworkConfig
}

export interface KmdWallet {
  name: string
  password: string
  accounts: Array<{name: string, address: string}> // both are obligatory
}

export interface KmdCfg {
  host: string
  port: number
  token: string
  wallets: KmdWallet[]
}

export interface NetworkCredentials {
  host: string
  port: number
  token: string
}

/**
 * The project paths:
 * * root: the project's root.
 * * configFile: the algob's config filepath.
 * * cache: project's cache directory.
 * * artifacts: artifact's directory.
 * * sources: project's sources directory.
 * * tests: project's tests directory.
 */
export interface ProjectPaths {
  root: string
  configFile: string
  cache: string
  artifacts: string
  sources: string
  tests: string
}

export type UserPaths = Omit<Partial<ProjectPaths>, "configFile">;

export interface Config {
  networks?: Networks
  paths?: UserPaths
  mocha?: Mocha.MochaOptions
}

export interface ResolvedConfig extends Config {
  paths?: ProjectPaths
  networks: Networks
}

// End config types

/**
 * A function that receives a RuntimeEnv and
 * modify its properties or add new ones.
 */
export type EnvironmentExtender = (env: RuntimeEnv) => void;

export type ConfigExtender = (
  config: ResolvedConfig,
  userConfig: Readonly<Config>
) => void;

export interface TasksMap {
  [name: string]: TaskDefinition
}

export interface ConfigurableTaskDefinition {
  setDescription: (description: string) => this

  setAction: (action: ActionType<TaskArguments>) => this

  addParam: <T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>,
    isOptional?: boolean
  ) => this

  addOptionalParam: <T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>
  ) => this

  addPositionalParam: <T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>,
    isOptional?: boolean
  ) => this

  addOptionalPositionalParam: <T>(
    name: string,
    description?: string,
    defaultValue?: T,
    type?: types.ArgumentType<T>
  ) => this

  addVariadicPositionalParam: <T>(
    name: string,
    description?: string,
    defaultValue?: T[],
    type?: types.ArgumentType<T>,
    isOptional?: boolean
  ) => this

  addOptionalVariadicPositionalParam: <T>(
    name: string,
    description?: string,
    defaultValue?: T[],
    type?: types.ArgumentType<T>
  ) => this

  addFlag: (name: string, description?: string) => this
}

export interface ParamDefinition<T> {
  name: string
  shortName?: string
  defaultValue?: T
  type: types.ArgumentType<T>
  description?: string
  isOptional: boolean
  isFlag: boolean
  isVariadic: boolean
}

export type ParamDefinitionAny = ParamDefinition<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface OptionalParamDefinition<T> extends ParamDefinition<T> {
  defaultValue: T
  isOptional: true
}

export interface ParamDefinitionsMap {
  [paramName: string]: ParamDefinitionAny
}

/**
 * Algob arguments:
 * + network: the network to be used (default="default").
 * + showStackTraces: flag to show stack traces.
 * + version: flag to show algob's version.
 * + help: flag to show algob's help message.
 * + config: used to specify algob's config file.
 */
export interface RuntimeArgs {
  network: string
  showStackTraces: boolean
  version: boolean
  help: boolean
  config?: string
  verbose: boolean
}

export type ParamDefinitions = {
  [param in keyof Required<RuntimeArgs>]: OptionalParamDefinition<
  RuntimeArgs[param]
  >;
};

export interface ShortParamSubstitutions {
  [name: string]: string
};

export interface TaskDefinition extends ConfigurableTaskDefinition {
  readonly name: string
  readonly description?: string
  readonly action: ActionType<TaskArguments>
  readonly isInternal: boolean

  // TODO: Rename this to something better. It doesn't include the positional
  // params, and that's not clear.
  readonly paramDefinitions: ParamDefinitionsMap

  readonly positionalParamDefinitions: ParamDefinitionAny[]
}

/**
 * @type TaskArguments {object-like} - the input arguments for a task.
 *
 * TaskArguments type is set to 'any' because it's interface is dynamic.
 * It's impossible in TypeScript to statically specify a variadic
 * number of fields and at the same time define specific types for\
 * the argument values.
 *
 * For example, we could define:
 * type TaskArguments = Record<string, any>;
 *
 * ...but then, we couldn't narrow the actual argument value's type in compile time,
 * thus we have no other option than forcing it to be just 'any'.
 */
export type TaskArguments = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export type RunTaskFunction = (
  name: string,
  taskArguments?: TaskArguments
) => PromiseAny;

export interface RunSuperFunction<ArgT extends TaskArguments> {
  (taskArguments?: ArgT): PromiseAny
  isDefined: boolean
}

export type ActionType<ArgsT extends TaskArguments> = (
  taskArgs: ArgsT,
  env: RuntimeEnv,
  runSuper: RunSuperFunction<ArgsT>
) => PromiseAny;

export interface Network {
  name: string
  config: NetworkConfig
  // provider:
}

export interface RuntimeEnv {
  readonly config: ResolvedConfig
  readonly runtimeArgs: RuntimeArgs
  readonly tasks: TasksMap
  readonly run: RunTaskFunction
  readonly network: Network
}

export interface Artifact {
  contractName: string
  abi: any // eslint-disable-line @typescript-eslint/no-explicit-any
  bytecode: string // "0x"-prefixed hex string
  deployedBytecode: string // "0x"-prefixed hex string
  linkReferences: LinkReferences
  deployedLinkReferences: LinkReferences
}

export interface LinkReferences {
  [libraryFileName: string]: {
    [libraryName: string]: Array<{ length: number, start: number }>
  }
}

export type AccountAddress = string;

// stateless smart contract deployment information (log)
export interface LsigInfo {
  creator: AccountAddress
  contractAddress: string
  lsig: rtypes.LogicSig
}

/**
 * Checkpoint implementation
 */
export interface CheckpointRepo {
  /**
   * Accumulates state as scripts are executed. This way it hides values generated by
   * remaining checkpoints. It is what should be exposed to the running scripts. */
  precedingCP: Checkpoints
  /**
   * Variables that current script introduced, short version of what was added.
   * Used for state persistence. */
  strippedCP: Checkpoints
  /**
   * All possible values that are loaded in advance.
   * This allows to prevent asset name clashes between scripts. */
  allCPs: Checkpoints

  merge: (c: Checkpoints, scriptName: string) => CheckpointRepo
  mergeToGlobal: (c: Checkpoints, scriptName: string) => CheckpointRepo

  /**
   * Sets metadata key-value for a specified network. */
  putMetadata: (networkName: string, key: string, value: string) => CheckpointRepo
  /**
   * Gets metadata key-value for a specified network. */
  getMetadata: (networkName: string, key: string) => string | undefined

  registerASA: (networkName: string, name: string, info: rtypes.ASAInfo) => CheckpointRepo
  registerSSC: (networkName: string, name: string, info: rtypes.SSCInfo) => CheckpointRepo
  registerLsig: (networkName: string, name: string, info: LsigInfo) => CheckpointRepo

  isDefined: (networkName: string, name: string) => boolean
  networkExistsInCurrentCP: (networkName: string) => boolean
};

export interface Checkpoints {
  [network: string]: Checkpoint
}

export interface Checkpoint {
  timestamp: number
  metadata: Map<string, string>
  asa: Map<string, rtypes.ASAInfo>
  ssc: Map<string, Map<Timestamp, rtypes.SSCInfo>>
  dLsig: Map<string, LsigInfo>
};

export interface FundASCFlags {
  funder: rtypes.Account
  fundingMicroAlgo: number
}

export interface AssetScriptMap {
  [assetName: string]: string
}

export interface CheckpointFunctions {
  /**
   * Queries a stateful smart contract info from checkpoint using key. */
  getSSCfromCPKey: (key: string) => rtypes.SSCInfo | undefined

  /**
   * Returns SSC checkpoint key using application index,
   * returns undefined if it doesn't exist
   * @param index Application index
   */
  getAppCheckpointKeyFromIndex: (index: number) => string | undefined

  /**
   * Returns ASA checkpoint key using asset index,
   * returns undefined if it doesn't exist
   * @param index Asset Index
   */
  getAssetCheckpointKeyFromIndex: (index: number) => string | undefined

  getLatestTimestampValue: (map: Map<number, rtypes.SSCInfo>) => number
}

export interface Deployer {
  /**
   * Allows user to know whether a script is running in a `deploy` or `run` mode. */
  isDeployMode: boolean
  accounts: rtypes.Account[]
  accountsByName: rtypes.AccountMap

  /**
   * Mapping of ASA name to deployment log */
  asa: Map<string, rtypes.ASAInfo>

  checkpoint: CheckpointFunctions

  getASAInfo: (name: string) => rtypes.ASAInfo

  /**
   * Sets metadata key value for a current network in the chckpoint file based on the
   * current deployment script. If run in a non deployment mode (eg `algob run script_name.js`)
   * it will throw an exception. */
  addCheckpointKV: (key: string, value: string) => void

  /**
   * Queries metadata key in all checkpoint files of current network. If the key is not defined
   * in any checkpoint then `undefined` is returned. Can be run in both _run_ and _deploy_ mode.
   */
  getCheckpointKV: (key: string) => string | undefined

  /**
   * Creates and deploys ASA.
   * @name  ASA name - deployer will search for the ASA in the /assets/asa.yaml file
   * @flags  deployment flags */
  deployASA: (
    name: string,
    flags: rtypes.ASADeploymentFlags,
    asaParams?: Partial<rtypes.ASADef>
  ) => Promise<rtypes.ASAInfo>

  /**
   * Loads deployed asset definition from checkpoint.
   * NOTE: This function returns "deployed" ASADef, as immutable properties
   * of asaDef could be updated during tx execution (eg. update asset clawback)
   * @name  ASA name - name of ASA in the /assets/asa.yaml file */
  loadASADef: (asaName: string) => ASADef | undefined

  assertNoAsset: (name: string) => void

  getASADef: (name: string, asaParams?: Partial<rtypes.ASADef>) => rtypes.ASADef

  persistCP: () => void

  registerASAInfo: (name: string, asaInfo: rtypes.ASAInfo) => void

  registerSSCInfo: (name: string, sscInfo: rtypes.SSCInfo) => void

  logTx: (message: string, txConfirmation: algosdk.PendingTransactionResponse) => void

  /**
   * Send signed transaction to network and wait for confirmation
   * @param rawTxns Signed Transaction(s)
   */
  sendAndWait: (rawTxns: Uint8Array | Uint8Array[]) => Promise<algosdk.PendingTransactionResponse>

  /**
   * Funds logic signature account (Contract Account).
   * @name  Stateless Smart Contract filename (must be present in assets folder)
   * @payFlags  Transaction Parameters
   * @scTmplParams  Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  fundLsig: (
    name: string,
    flags: FundASCFlags,
    payFlags: rtypes.TxParams,
    scTmplParams?: SCParams
  ) => void

  /**
   * Makes delegated logic signature signed by the `signer`.
   * @name  Stateless Smart Contract filename (must be present in assets folder)
   * @signer  Signer Account which will sign the smart contract
   * @scTmplParams  Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  mkDelegatedLsig: (
    name: string,
    signer: rtypes.Account,
    scTmplParams?: SCParams
  ) => Promise<LsigInfo>

  /**
   * Deploys stateful smart contract.
   * @approvalProgram  approval program filename (must be present in assets folder)
   * @clearProgram  clear program filename (must be present in assets folder)
   * @flags  SSCDeploymentFlags
   * @payFlags  Transaction Parameters
   * @scTmplParams  Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  deploySSC: (
    approvalProgram: string,
    clearProgram: string,
    flags: rtypes.SSCDeploymentFlags,
    payFlags: rtypes.TxParams,
    scTmplParams?: SCParams) => Promise<rtypes.SSCInfo>

  /**
   * Update programs(approval, clear) for a stateful smart contract.
   * @param sender Account from which call needs to be made
   * @param payFlags Transaction Flags
   * @param appID ID of the application being configured or empty if creating
   * @param newApprovalProgram New Approval Program filename
   * @param newClearProgram New Clear Program filename
   * @param flags Optional parameters to SSC (accounts, args..)
   */
  updateSSC: (
    sender: algosdk.Account,
    payFlags: rtypes.TxParams,
    appID: number,
    newApprovalProgram: string,
    newClearProgram: string,
    flags: rtypes.SSCOptionalFlags
  ) => Promise<rtypes.SSCInfo>

  /**
   * Returns true if ASA or DelegatedLsig or SSC were deployed in any script.
   * Checks even for checkpoints which are out of scope from the execution
   * session and are not obtainable using get methods.
   */
  isDefined: (name: string) => boolean

  algodClient: algosdk.Algodv2

  /**
   * Queries blockchain for a given transaction and waits until it will be processed. */
  waitForConfirmation: (txId: string) => Promise<algosdk.PendingTransactionResponse>

  /**
   * Queries blockchain using algodv2 for asset information by index  */
  getAssetByID: (assetIndex: number | bigint) => Promise<algosdk.modelsv2.Asset>

  /**
   * Creates an opt-in transaction for given ASA name, which must be defined in
   * `/assets/asa.yaml` file. The opt-in transaction is signed by the account secret key */
  optInAcountToASA: (asa: string, accountName: string,
    flags: rtypes.TxParams) => Promise<void>

  /**
   * Creates an opt-in transaction for given ASA name, which must be defined in
   * `/assets/asa.yaml` file. The opt-in transaction is signed by the logic signature */
  optInLsigToASA: (asa: string, lsig: rtypes.LogicSig, flags: rtypes.TxParams) => Promise<void>

  /**
   * Opt-In to stateful smart contract (SSC) for a single account
   * signed by account secret key
   * @param sender sender account
   * @param appID application index
   * @param payFlags Transaction flags
   * @param flags Optional parameters to SSC (accounts, args..)
   */
  optInAccountToSSC: (
    sender: rtypes.Account,
    appID: number,
    payFlags: rtypes.TxParams,
    flags: rtypes.SSCOptionalFlags) => Promise<void>

  /**
   * Opt-In to stateful smart contract (SSC) for a contract account
   * The opt-in transaction is signed by the logic signature
   * @param sender sender account
   * @param appID application index
   * @param payFlags Transaction flags
   * @param flags Optional parameters to SSC (accounts, args..)
   */
  optInLsigToSSC: (
    appID: number,
    lsig: rtypes.LogicSig,
    payFlags: rtypes.TxParams,
    flags: rtypes.SSCOptionalFlags) => Promise<void>

  /**
   * Create an entry in a script log (stored in artifacts/scripts/<script_name>.log) file. */
  log: (msg: string, obj: any) => void

  /**
   * Extracts multi signed logic signature file from `assets/`. */
  loadMultiSig: (name: string) => Promise<rtypes.LogicSig>

  /**
   * Queries a stateful smart contract info from checkpoint. */
  getSSC: (nameApproval: string, nameClear: string) => rtypes.SSCInfo | undefined

  /**
   * Queries a delegated logic signature from checkpoint. */
  getDelegatedLsig: (lsigName: string) => Object | undefined

  /**
   * Loads contract mode logic signature (TEAL or PyTEAL)
   * @name   Smart Contract filename (must be present in assets folder)
   * @scTmplParams  Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  loadLogic: (name: string, scTmplParams?: SCParams) => Promise<rtypes.LogicSig>

  /**
   * Returns ASCCache (with compiled code)
   * @name  Smart Contract filename (must be present in assets folder)
   * @force  if force is true file will be compiled for sure, even if it's checkpoint exist
   * @scTmplParams  scTmplParams: Smart contract template parameters
   *     (used only when compiling PyTEAL to TEAL)
   */
  ensureCompiled: (name: string, force?: boolean, scTmplParams?: SCParams) => Promise<ASCCache>

  /**
   * Checks if checkpoint is deleted for a particular transaction
   * if checkpoint exists and is marked as deleted,
   * throw error(except for opt-out transactions), else pass
   * @param execParams Transaction execution parameters
   */
  assertCPNotDeleted: (execParams: rtypes.ExecParams | rtypes.ExecParams[]) => void
}

// ************************
//     Asset types

export interface ASCCache {
  filename: string
  timestamp: number // compilation time (Unix time)
  compiled: string // the compiled code
  compiledHash: string // hash returned by the compiler
  srcHash: number // source code hash
  base64ToBytes: Uint8Array // compiled base64 in bytes
}

export interface PyASCCache extends ASCCache {
  tealCode: string
}

// ************************
//     helper types

export interface StrMap {
  [key: string]: string
}

export interface SCParams {
  [key: string]: string | bigint
}

export interface ReplaceParams {
  [key: string]: string
}

export interface AnyMap {
  [key: string]: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type PromiseAny = Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

//  LocalWords:  configFile

export interface RequestError extends Error {
  response?: {
    statusCode: number
    text: string
    body: {
      message: string
    }
    error?: Error
  }
  error?: Error
}
