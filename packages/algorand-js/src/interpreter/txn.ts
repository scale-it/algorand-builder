import { TealError } from "../errors/errors";
import { ERRORS } from "../errors/errors-list";
import { TxFieldDefaults } from "../lib/constants";
import { toBytes } from "../lib/parse-data";
import { AssetParamsEnc, StackElem, TxField, TxnEncodedObj, TxnFields, TxnType } from "../types";
import { Interpreter } from "./interpreter";
import { Op } from "./opcode";

const assetTxnFields = new Set([
  'ConfigAssetTotal',
  'ConfigAssetDecimals',
  'ConfigAssetDefaultFrozen',
  'ConfigAssetUnitName',
  'ConfigAssetName',
  'ConfigAssetURL',
  'ConfigAssetMetadataHash',
  'ConfigAssetManager',
  'ConfigAssetReserve',
  'ConfigAssetFreeze',
  'ConfigAssetClawback'
]);

// return default value of txField if undefined,
// otherwise return parsed data to interpreter
export function parseToStackElem (a: unknown, field: TxField): any {
  if (Buffer.isBuffer(a)) {
    return new Uint8Array(a);
  }
  if (typeof a === "number") {
    return BigInt(a);
  }
  if (typeof a === "string") {
    return toBytes(a);
  }

  return TxFieldDefaults[field];
}

/**
 * Description: returns specific transaction field value from tx object
 * @param txField: transaction field
 * @param interpreter: interpreter
 */
export function txnSpecbyField (txField: string, interpreter: Interpreter): StackElem {
  const tx = interpreter.tx;
  const gtxs = interpreter.gtxs;
  let result; // store raw result, parse and return

  // handle nested encoded obj (for assetParams)
  if (assetTxnFields.has(txField)) {
    const s = TxnFields[txField];
    const assetMetaData = tx.apar;
    result = assetMetaData[s as keyof AssetParamsEnc];
    return parseToStackElem(result, txField);
  }

  // handle other cases
  switch (txField) {
    case 'FirstValidTime': { // Causes program to fail; reserved for future use
      throw new TealError(ERRORS.TEAL.LOGIC_REJECTION);
    }
    case 'TypeEnum': {
      result = TxnType[tx.type as keyof typeof TxnType]; // TxnType['pay']
      break;
    }
    case 'GroupIndex': {
      result = gtxs.indexOf(tx);
      break;
    }
    case 'TxID': {
      return toBytes(tx.txID);
    }
    case 'NumAppArgs': {
      const appArg = TxnFields.ApplicationArgs as keyof TxnEncodedObj;
      const appArgs = tx[appArg] as Buffer[];
      result = appArgs?.length;
      break;
    }
    case 'NumAccounts': {
      const appAcc = TxnFields.Accounts as keyof TxnEncodedObj;
      const appAccounts = tx[appAcc] as Buffer[];
      result = appAccounts?.length;
      break;
    }
    default: {
      const s = TxnFields[txField]; // eg: rcv = TxnFields["Receiver"]
      result = tx[s as keyof TxnEncodedObj]; // pk_buffer = tx['rcv']
    }
  }

  return parseToStackElem(result, txField);
}

/**
 * Description: returns specific transaction field value from array
 * of accounts or application args
 * @param tx: current transaction
 * @param txField: transaction field
 * @param idx: array index
 */
export function txAppArg (txField: TxField, tx: TxnEncodedObj, idx: number, op: Op): Uint8Array {
  if (txField === 'Accounts' || txField === 'ApplicationArgs') {
    const s = TxnFields[txField]; // 'apaa' or 'apat'
    const result = tx[s as keyof TxnEncodedObj] as Buffer[]; // array of pk buffers (accounts or appArgs)

    if (!result) { // handle
      return TxFieldDefaults[txField];
    }
    op.checkIndexBound(idx, result);
    return parseToStackElem(result[idx], txField);
  }

  throw new TealError(ERRORS.TEAL.INVALID_OP_ARG, {
    opcode: "txna or gtxna"
  });
}