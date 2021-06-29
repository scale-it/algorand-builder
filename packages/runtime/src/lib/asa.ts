import type { AssetParams } from "algosdk";
import { existsSync } from "fs";
import path from "path";
import * as z from 'zod';

import { RUNTIME_ERRORS } from "../errors/errors-list";
import { RuntimeError } from "../errors/runtime-errors";
import { parseZodError } from "../errors/validation-errors";
import { AccountMap, ASADef, ASADefs, AssetModFields, RuntimeAccountMap } from "../types";
import { ASADefSchema } from "../types-input";
import { getPathFromDirRecursive, loadFromYamlFileSilent } from "./files";

export const ASSETS_DIR = "assets";
/**
 * Validates asset definitions and checks if opt-in acc names are present in network
 * @param accounts AccountMap is the SDK account type, used in builder. RuntimeAccountMap is
 * for AccountStore used in runtime (where we use maps instead of arrays in sdk structures).
 * @param filename asa filename
 * @param asaDef asset definition
 */
function validateOptInAccNames (accounts: AccountMap | RuntimeAccountMap,
  asaDef: ASADef,
  source?: string): void {
  if (!asaDef.optInAccNames || asaDef.optInAccNames.length === 0) {
    return;
  }
  for (const accName of asaDef.optInAccNames) {
    if (!accounts.get(accName)) {
      throw new RuntimeError(
        RUNTIME_ERRORS.ASA.PARAM_ERROR_NO_NAMED_OPT_IN_ACCOUNT, {
          source: source,
          optInAccName: accName
        });
    }
  }
}

/**
 * Validate and parse each field of asset definition
 * @param asaDef asset definition
 * @param source source of assetDef: asa.yaml file OR function deployASA
 * @returns parsed asa definition
 */
function _parseASADef (asaDef: ASADef, source?: string): ASADef {
  try {
    const parsedDef = ASADefSchema.parse(asaDef);
    parsedDef.manager = parsedDef.manager !== "" ? parsedDef.manager : undefined;
    parsedDef.reserve = parsedDef.reserve !== "" ? parsedDef.reserve : undefined;
    parsedDef.freeze = parsedDef.freeze !== "" ? parsedDef.freeze : undefined;
    parsedDef.clawback = parsedDef.clawback !== "" ? parsedDef.clawback : undefined;
    parsedDef.defaultFrozen = parsedDef.defaultFrozen ?? false;
    return parsedDef;
  } catch (e) {
    if (e instanceof z.ZodError) {
      throw new RuntimeError(
        RUNTIME_ERRORS.ASA.PARAM_PARSE_ERROR, {
          reason: parseZodError(e),
          source: source
        }, e);
    }
    throw e;
  }
}

/**
 * Override & validate ASA definition in asa.yaml using custom params passed via deployASA
 * @param accounts accounts by name
 * @param origDef source asset definition (in asa.yaml)
 * @param newDef custom asset def params (passed during ASA deployment)
 * @returns overriden asset definition. If custom params are empty, return source asa def
 */
export function overrideASADef (
  accounts: AccountMap,
  origDef: ASADef,
  newDef?: Partial<ASADef>): ASADef {
  if (newDef === undefined) { return origDef; }

  const source = 'ASA deployment';
  Object.assign(origDef, newDef);
  origDef = _parseASADef(origDef, source);
  validateOptInAccNames(accounts, origDef, source);
  return origDef;
}

/**
 * Parses, overrides and validates asset defs map. Filaname parameter is used to
   indicate an ASA definition source when reporting errors.
 * @param asaDefs asset definitions to validate
 * @param accounts map of string => account. AccountMap is the SDK account type,
 * used in builder. RuntimeAccountMap is for AccountStore used in runtime
 * (where we use maps instead of arrays in sdk structures).
 * @param filename asa filename
 */
export function validateASADefs (
  asaDefs: ASADefs, accounts: AccountMap | RuntimeAccountMap, filename: string): ASADefs {
  for (const name in asaDefs) {
    asaDefs[name] = _parseASADef(asaDefs[name], filename);
    validateOptInAccNames(accounts, asaDefs[name], filename);
  }
  return asaDefs;
}

/**
 * Loads, validates and returns asset definitions from the assets/asa.yaml file
 * @param accounts map of string => account. AccountMap is the SDK account type,
 * used in builder. RuntimeAccountMap is for AccountStore used in runtime
 * (where we use maps instead of arrays in sdk structures).
 */
export function loadASAFile (accounts: AccountMap | RuntimeAccountMap): ASADefs {
  let filePath;
  if (!existsSync(ASSETS_DIR)) { // to handle tests
    filePath = path.join(ASSETS_DIR, "asa.yaml");
  } else {
    filePath = getPathFromDirRecursive(ASSETS_DIR, "asa.yaml", "ASA file not defined") as string;
  }

  return validateASADefs(
    loadFromYamlFileSilent(filePath),
    accounts,
    filePath);
}

function isDefined (value: string | undefined): boolean {
  if (value !== undefined && value !== "") return true;
  return false;
}

/**
 * Check and Change ASA fields
 * @param fields Custom ASA fields
 * @param asset Defined ASA fields
 */
export function checkAndSetASAFields (fields: AssetModFields, asset: AssetParams): void {
  for (const x of ['manager', 'reserve', 'freeze', 'clawback']) {
    const customField = fields[x as keyof AssetModFields];
    const asaField = asset[x as keyof AssetModFields];
    // Check if custom field is set and defined and ASA field is blank field
    if (isDefined(customField) && !isDefined(asaField)) {
      throw new RuntimeError(RUNTIME_ERRORS.ASA.BLANK_ADDRESS_ERROR);
    } else if (customField !== undefined && isDefined(asaField)) { // Change if ASA field and custom field is defined
      asset[x as keyof AssetModFields] = customField;
    }
  }
}
