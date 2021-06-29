import type { ApplicationStateSchema, AssetHolding } from "algosdk";

import { AccountAddress, Deployer } from "../types";

/**
 * Returns `account` asset holding of `assetID`. Returns undefined if the account is not
 * opt-in to the given asset id.
 * @param deployer algob deployer
 * @param accountAddress account to return assetholding info
 * @param assetID asset index
 */
export async function balanceOf (
  deployer: Deployer,
  accountAddress: AccountAddress,
  assetID: number
): Promise<AssetHolding | undefined> {
  const accountInfo = await deployer.algodClient.accountInformation(accountAddress).do();
  for (const asset of accountInfo.assets) {
    if (asset['asset-id'] === assetID) {
      console.log("Asset Holding Info:", asset);
      return asset;
    }
  }
  return undefined;
};

/**
 * fetches and returns the global state of application.
 * @param deployer Deployer
 * @param creator Account from which call needs to be made
 * @param appID ID of the application being configured or empty if creating
 */
export async function readGlobalStateSSC (
  deployer: Deployer,
  creator: AccountAddress,
  appID: number): Promise<ApplicationStateSchema[] | undefined> {
  const accountInfoResponse = await deployer.algodClient.accountInformation(creator).do();
  for (const app of accountInfoResponse['created-apps']) {
    if (app.id === appID) { return app.params['global-state']; }
  }
  return undefined;
}

/**
 * Read and return the local state of application from an account.
 * @param deployer Deployer
 * @param account account from the which the local state has to be read
 * @param appID ID of the application being configured or empty if creating
 */
export async function readLocalStateSSC (
  deployer: Deployer,
  account: AccountAddress,
  appID: number): Promise<ApplicationStateSchema[] | undefined> {
  const accountInfoResponse = await deployer.algodClient.accountInformation(account).do();
  for (const app of accountInfoResponse['apps-local-state']) {
    if (app.id === appID) { return app[`key-value`]; }
  }
  return undefined;
}

/**
 * Prints account asset holdings and ALGO balance (in microalgos)
 * @param deployer algob deployer object
 * @param account account whose asset holding to print
 */
export async function printAssets (deployer: Deployer, account: string): Promise<void> {
  const accountInfo = await deployer.algodClient.accountInformation(account).do();
  console.log("Asset Holding Info:", accountInfo.assets);
  console.log("Account's ALGO (microalgos):", accountInfo["amount-without-pending-rewards"]);
}

/**
 * print account's local state of a stateful smart contract
 * @param deployer algob deployer
 * @param accountAddr account address to print local state
 * @param appID application index of smart contract
 */
export async function printLocalStateSSC (
  deployer: Deployer,
  accountAddr: AccountAddress,
  appID: number): Promise<void> {
  const localState = await readLocalStateSSC(deployer, accountAddr, appID);
  if (localState === undefined) { return; }
  console.log("User's local state:");
  for (let n = 0; n < localState.length; n++) {
    console.log(localState[n]);
  }
}

/**
 * print global state of a stateful smart contract
 * @param deployer algob deployer
 * @param creatorAddr creator address of stateful smart contract
 * @param appID application index of smart contract
 */
export async function printGlobalStateSSC (
  deployer: Deployer,
  creatorAddr: AccountAddress,
  appID: number): Promise<void> {
  const globalState = await readGlobalStateSSC(deployer, creatorAddr, appID);
  if (globalState === undefined) { return; }
  console.log("Application's global state:");
  for (let n = 0; n < globalState.length; n++) {
    console.log(globalState[n]);
  }
}
