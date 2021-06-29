/* eslint sonarjs/no-identical-functions: 0 */
/* eslint sonarjs/no-duplicate-string: 0 */
import { AssetParams, decodeAddress, decodeUint64, encodeAddress, encodeUint64, isValidAddress, verifyBytes } from "algosdk";
import { Message, sha256 } from "js-sha256";
import { sha512_256 } from "js-sha512";
import { Keccak } from 'sha3';

import { RUNTIME_ERRORS } from "../errors/errors-list";
import { RuntimeError } from "../errors/runtime-errors";
import { compareArray } from "../lib/compare";
import { AssetParamMap, GlobalFields, MAX_CONCAT_SIZE, MAX_UINT64, MaxTEALVersion, TxArrFields } from "../lib/constants";
import {
  assertLen, assertOnlyDigits, convertToBuffer,
  convertToString, getEncoding, parseBinaryStrToBigInt, stringToBytes
} from "../lib/parsing";
import { Stack } from "../lib/stack";
import { txAppArg, txnSpecbyField } from "../lib/txn";
import { DecodingMode, EncodingType, StackElem, TEALStack, TxnOnComplete, TxnType } from "../types";
import { Interpreter } from "./interpreter";
import { Op } from "./opcode";

// Opcodes reference link: https://developer.algorand.org/docs/reference/teal/opcodes/

// Store TEAL version
// push to stack [...stack]
export class Pragma extends Op {
  readonly version: number;
  readonly line: number;
  /**
   * Store Pragma version
   * @param args Expected arguments: ["version", version number]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 2, line);
    if (this.line > 1) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.PRAGMA_NOT_AT_FIRST_LINE, { line: line });
    }
    if (args[0] === "version" && Number(args[1]) <= MaxTEALVersion) {
      this.version = Number(args[1]);
      interpreter.tealVersion = this.version;
    } else {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.PRAGMA_VERSION_ERROR, { got: args.join(' '), line: line });
    }
  }

  // Returns Pragma version
  getVersion (): number {
    return this.version;
  }

  execute (stack: TEALStack): void {}
}

// pops string([]byte) from stack and pushes it's length to stack
// push to stack [...stack, bigint]
export class Len extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const last = this.assertBytes(stack.pop(), this.line);
    stack.push(BigInt(last.length));
  }
}

// pops two unit64 from stack(last, prev) and pushes their sum(last + prev) to stack
// panics on overflow (result > max_unit64)
// push to stack [...stack, bigint]
export class Add extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    const result = prev + last;
    this.checkOverflow(result, this.line);
    stack.push(result);
  }
}

// pops two unit64 from stack(last, prev) and pushes their diff(last - prev) to stack
// panics on underflow (result < 0)
// push to stack [...stack, bigint]
export class Sub extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    const result = prev - last;
    this.checkUnderflow(result, this.line);
    stack.push(result);
  }
}

// pops two unit64 from stack(last, prev) and pushes their division(last / prev) to stack
// panics if prev == 0
// push to stack [...stack, bigint]
export class Div extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (last === 0n) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.ZERO_DIV, { line: this.line });
    }
    stack.push(prev / last);
  }
}

// pops two unit64 from stack(last, prev) and pushes their mult(last * prev) to stack
// panics on overflow (result > max_unit64)
// push to stack [...stack, bigint]
export class Mul extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    const result = prev * last;
    this.checkOverflow(result, this.line);
    stack.push(result);
  }
}

// pushes argument[N] from argument array to stack
// push to stack [...stack, bytes]
export class Arg extends Op {
  readonly _arg?: Uint8Array;
  readonly line: number;

  /**
   * Gets the argument value from interpreter.args array.
   * store the value in _arg variable
   * @param args Expected arguments: [argument number]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);
    assertOnlyDigits(args[0], this.line);

    const index = Number(args[0]);
    this.checkIndexBound(index, interpreter.runtime.ctx.args as Uint8Array[], this.line);

    this._arg = interpreter.runtime.ctx.args ? interpreter.runtime.ctx.args[index] : undefined;
  }

  execute (stack: TEALStack): void {
    const last = this.assertBytes(this._arg, this.line);
    stack.push(last);
  }
}

// load block of byte-array constants
// push to stack [...stack]
export class Bytecblock extends Op {
  readonly bytecblock: Uint8Array[];
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Store blocks of bytes in bytecblock
   * @param args Expected arguments: [bytecblock] // Ex: ["value1" "value2"]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    const bytecblock: Uint8Array[] = [];
    for (const val of args) {
      bytecblock.push(stringToBytes(val));
    }

    this.interpreter = interpreter;
    this.bytecblock = bytecblock;
  }

  execute (stack: TEALStack): void {
    this.assertArrLength(this.bytecblock, this.line);
    this.interpreter.bytecblock = this.bytecblock;
  }
}

// push bytes constant from bytecblock to stack by index
// push to stack [...stack, bytes]
export class Bytec extends Op {
  readonly index: number;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Sets index according to arguments passed
   * @param args Expected arguments: [byteblock index number]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);

    this.index = Number(args[0]);
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    this.checkIndexBound(this.index, this.interpreter.bytecblock, this.line);
    const bytec = this.assertBytes(this.interpreter.bytecblock[this.index], this.line);
    stack.push(bytec);
  }
}

// load block of uint64 constants
// push to stack [...stack]
export class Intcblock extends Op {
  readonly intcblock: Array<bigint>;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Stores block of integer in intcblock
   * @param args Expected arguments: [integer block] // Ex: [100 200]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    const intcblock: Array<bigint> = [];
    for (const val of args) {
      assertOnlyDigits(val, this.line);
      intcblock.push(BigInt(val));
    }

    this.interpreter = interpreter;
    this.intcblock = intcblock;
  }

  execute (stack: TEALStack): void {
    this.assertArrLength(this.intcblock, this.line);
    this.interpreter.intcblock = this.intcblock;
  }
}

// push value from uint64 intcblock to stack by index
// push to stack [...stack, bigint]
export class Intc extends Op {
  readonly index: number;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Sets index according to arguments passed
   * @param args Expected arguments: [intcblock index number]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);

    this.index = Number(args[0]);
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    this.checkIndexBound(this.index, this.interpreter.intcblock, this.line);
    const intc = this.assertBigInt(this.interpreter.intcblock[this.index], this.line);
    stack.push(intc);
  }
}

// pops two unit64 from stack(last, prev) and pushes their modulo(last % prev) to stack
// Panic if B == 0.
// push to stack [...stack, bigint]
export class Mod extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (last === 0n) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.ZERO_DIV, { line: this.line });
    }
    stack.push(prev % last);
  }
}

// pops two unit64 from stack(last, prev) and pushes their bitwise-or(last | prev) to stack
// push to stack [...stack, bigint]
export class BitwiseOr extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    stack.push(prev | last);
  }
}

// pops two unit64 from stack(last, prev) and pushes their bitwise-and(last & prev) to stack
// push to stack[...stack, bigint]
export class BitwiseAnd extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    stack.push(prev & last);
  }
}

// pops two unit64 from stack(last, prev) and pushes their bitwise-xor(last ^ prev) to stack
// push to stack [...stack, bigint]
export class BitwiseXor extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    stack.push(prev ^ last);
  }
}

// pop unit64 from stack and push it's bitwise-invert(~last) to stack
// push to stack [...stack, bigint]
export class BitwiseNot extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    stack.push(~last);
  }
}

// pop last value from the stack and store to scratch space
// push to stack [...stack]
export class Store extends Op {
  readonly index: number;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Stores index number according to arguments passed
   * @param args Expected arguments: [index number]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 1, this.line);
    assertOnlyDigits(args[0], this.line);

    this.index = Number(args[0]);
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    this.checkIndexBound(this.index, this.interpreter.scratch, this.line);
    this.assertMinStackLen(stack, 1, this.line);
    const top = stack.pop();
    this.interpreter.scratch[this.index] = top;
  }
}

// copy last value from scratch space to the stack
// push to stack [...stack, bigint/bytes]
export class Load extends Op {
  readonly index: number;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Stores index number according to arguments passed.
   * @param args Expected arguments: [index number]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 1, this.line);
    assertOnlyDigits(args[0], this.line);

    this.index = Number(args[0]);
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    this.checkIndexBound(this.index, this.interpreter.scratch, this.line);
    stack.push(this.interpreter.scratch[this.index]);
  }
}

// err opcode : Error. Panic immediately.
// push to stack [...stack]
export class Err extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    throw new RuntimeError(RUNTIME_ERRORS.TEAL.TEAL_ENCOUNTERED_ERR, { line: this.line });
  }
}

// SHA256 hash of value X, yields [32]byte
// push to stack [...stack, bytes]
export class Sha256 extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const hash = sha256.create();
    const val = this.assertBytes(stack.pop(), this.line) as Message;
    hash.update(val);
    const hashedOutput = Buffer.from(hash.hex(), 'hex');
    const arrByte = Uint8Array.from(hashedOutput);
    stack.push(arrByte);
  }
}

// SHA512_256 hash of value X, yields [32]byte
// push to stack [...stack, bytes]
export class Sha512_256 extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const hash = sha512_256.create();
    const val = this.assertBytes(stack.pop(), this.line) as Message;
    hash.update(val);
    const hashedOutput = Buffer.from(hash.hex(), 'hex');
    const arrByte = Uint8Array.from(hashedOutput);
    stack.push(arrByte);
  }
}

// Keccak256 hash of value X, yields [32]byte
// https://github.com/phusion/node-sha3#example-2
// push to stack [...stack, bytes]
export class Keccak256 extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const top = this.assertBytes(stack.pop(), this.line);

    const hash = new Keccak(256);
    hash.update(convertToString(top));
    const arrByte = Uint8Array.from(hash.digest());
    stack.push(arrByte);
  }
}

// for (data A, signature B, pubkey C) verify the signature of
// ("ProgData" || program_hash || data) against the pubkey => {0 or 1}
// push to stack [...stack, bigint]
export class Ed25519verify extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 3, this.line);
    const pubkey = this.assertBytes(stack.pop(), this.line);
    const signature = this.assertBytes(stack.pop(), this.line);
    const data = this.assertBytes(stack.pop(), this.line);

    const addr = encodeAddress(pubkey);
    const isValid = verifyBytes(data, signature, addr);
    if (isValid) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A < B pushes '1' else '0'
// push to stack [...stack, bigint]
export class LessThan extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (prev < last) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A > B pushes '1' else '0'
// push to stack [...stack, bigint]
export class GreaterThan extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (prev > last) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A <= B pushes '1' else '0'
// push to stack [...stack, bigint]
export class LessThanEqualTo extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (prev <= last) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A >= B pushes '1' else '0'
// push to stack [...stack, bigint]
export class GreaterThanEqualTo extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (prev >= last) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A && B is true pushes '1' else '0'
// push to stack [...stack, bigint]
export class And extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (last && prev) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A || B is true pushes '1' else '0'
// push to stack [...stack, bigint]
export class Or extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    const prev = this.assertBigInt(stack.pop(), this.line);
    if (prev || last) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// If A == B pushes '1' else '0'
// push to stack [...stack, bigint]
export class EqualTo extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = stack.pop();
    const prev = stack.pop();
    if (typeof last !== typeof prev) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.INVALID_TYPE, {
        expected: typeof prev,
        actual: typeof last,
        line: this.line
      });
    }
    if (typeof last === "bigint") {
      stack = this.pushBooleanCheck(stack, (last === prev));
    } else {
      stack = this.pushBooleanCheck(stack,
        compareArray(this.assertBytes(last, this.line), this.assertBytes(prev, this.line)));
    }
  }
}

// If A != B pushes '1' else '0'
// push to stack [...stack, bigint]
export class NotEqualTo extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const last = stack.pop();
    const prev = stack.pop();
    if (typeof last !== typeof prev) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.INVALID_TYPE, {
        expected: typeof prev,
        actual: typeof last,
        line: this.line
      });
    }
    if (typeof last === "bigint") {
      stack = this.pushBooleanCheck(stack, last !== prev);
    } else {
      stack = this.pushBooleanCheck(stack,
        !compareArray(this.assertBytes(last, this.line), this.assertBytes(prev, this.line)));
    }
  }
}

// X == 0 yields 1; else 0
// push to stack [...stack, bigint]
export class Not extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);
    if (last === 0n) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// converts uint64 X to big endian bytes
// push to stack [...stack, big endian bytes]
export class Itob extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const uint64 = this.assertBigInt(stack.pop(), this.line);
    stack.push(encodeUint64(uint64));
  }
}

// converts bytes X as big endian to uint64
// btoi panics if the input is longer than 8 bytes.
// push to stack [...stack, bigint]
export class Btoi extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const bytes = this.assertBytes(stack.pop(), this.line);
    const uint64 = decodeUint64(bytes, DecodingMode.BIGINT);
    stack.push(uint64);
  }
}

// A plus B out to 128-bit long result as sum (top) and carry-bit uint64 values on the stack
// push to stack [...stack, bigint]
export class Addw extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const valueA = this.assertBigInt(stack.pop(), this.line);
    const valueB = this.assertBigInt(stack.pop(), this.line);
    let valueC = valueA + valueB;

    if (valueC > MAX_UINT64) {
      valueC -= MAX_UINT64;
      stack.push(1n);
      stack.push(valueC - 1n);
    } else {
      stack.push(0n);
      stack.push(valueC);
    }
  }
}

// A times B out to 128-bit long result as low (top) and high uint64 values on the stack
// push to stack [...stack, bigint]
export class Mulw extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const valueA = this.assertBigInt(stack.pop(), this.line);
    const valueB = this.assertBigInt(stack.pop(), this.line);
    const result = valueA * valueB;

    const low = result & MAX_UINT64;
    this.checkOverflow(low, this.line);

    const high = result >> BigInt('64');
    this.checkOverflow(high, this.line);

    stack.push(high);
    stack.push(low);
  }
}

// Pop one element from stack
// [...stack] // pop value.
export class Pop extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    stack.pop();
  }
}

// duplicate last value on stack
// push to stack [...stack, duplicate value]
export class Dup extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const lastValue = stack.pop();

    stack.push(lastValue);
    stack.push(lastValue);
  }
}

// duplicate two last values on stack: A, B -> A, B, A, B
// push to stack [...stack, B, A, B, A]
export class Dup2 extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const lastValueA = stack.pop();
    const lastValueB = stack.pop();

    stack.push(lastValueB);
    stack.push(lastValueA);
    stack.push(lastValueB);
    stack.push(lastValueA);
  }
}

// pop two byte strings A and B and join them, push the result
// concat panics if the result would be greater than 4096 bytes.
// push to stack [...stack, string]
export class Concat extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const valueA = this.assertBytes(stack.pop(), this.line);
    const valueB = this.assertBytes(stack.pop(), this.line);

    if (valueA.length + valueB.length > MAX_CONCAT_SIZE) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.CONCAT_ERROR, { line: this.line });
    }
    const c = new Uint8Array(valueB.length + valueA.length);
    c.set(valueB);
    c.set(valueA, valueB.length);
    stack.push(c);
  }
}

// pop last byte string X. For immediate values in 0..255 M and N:
// extract last range of bytes from it starting at M up to but not including N,
// push the substring result. If N < M, or either is larger than the string length,
// the program fails
// push to stack [...stack, substring]
export class Substring extends Op {
  readonly start: bigint;
  readonly end: bigint;
  readonly line: number;

  /**
   * Stores values of `start` and `end` according to arguments passed.
   * @param args Expected arguments: [start index number, end index number]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 2, line);
    assertOnlyDigits(args[0], line);
    assertOnlyDigits(args[1], line);

    this.start = BigInt(args[0]);
    this.end = BigInt(args[1]);
  };

  execute (stack: TEALStack): void {
    const byteString = this.assertBytes(stack.pop(), this.line);
    const start = this.assertUint8(this.start, this.line);
    const end = this.assertUint8(this.end, this.line);

    const subString = this.subString(start, end, byteString, this.line);
    stack.push(subString);
  }
}

// pop last byte string A and two integers B and C.
// Extract last range of bytes from A starting at B up to
// but not including C, push the substring result. If C < B,
// or either is larger than the string length, the program fails
// push to stack [...stack, substring]
export class Substring3 extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    const byteString = this.assertBytes(stack.pop(), this.line);
    const end = this.assertBigInt(stack.pop(), this.line);
    const start = this.assertBigInt(stack.pop(), this.line);

    const subString = this.subString(start, end, byteString, this.line);
    stack.push(subString);
  }
}

// push field from current transaction to stack
// push to stack [...stack, transaction field]
export class Txn extends Op {
  readonly field: string;
  readonly idx: number | undefined;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Set transaction field according to arguments passed
   * @param args Expected arguments: [transaction field]
   * // Note: Transaction field is expected as string instead of number.
   * For ex: `Fee` is expected and `0` is not expected.
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    this.idx = undefined;

    this.assertTxFieldDefined(args[0], interpreter.tealVersion, line);
    if (TxArrFields[interpreter.tealVersion].has(args[0])) { // eg. txn Accounts 1
      assertLen(args.length, 2, line);
      assertOnlyDigits(args[1], line);
      this.idx = Number(args[1]);
    } else {
      assertLen(args.length, 1, line);
    }
    this.assertTxFieldDefined(args[0], interpreter.tealVersion, line);

    this.field = args[0]; // field
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    let result;
    if (this.idx !== undefined) { // if field is an array use txAppArg (with "Accounts"/"ApplicationArgs"/'Assets'..)
      result = txAppArg(this.field, this.interpreter.runtime.ctx.tx, this.idx, this,
        this.interpreter.tealVersion, this.line);
    } else {
      result = txnSpecbyField(
        this.field,
        this.interpreter.runtime.ctx.tx,
        this.interpreter.runtime.ctx.gtxs,
        this.interpreter.tealVersion);
    }
    stack.push(result);
  }
}

// push field to the stack from a transaction in the current transaction group
// If this transaction is i in the group, gtxn i field is equivalent to txn field.
// push to stack [...stack, transaction field]
export class Gtxn extends Op {
  readonly field: string;
  readonly txFieldIdx: number | undefined;
  readonly interpreter: Interpreter;
  readonly line: number;
  protected txIdx: number;

  /**
   * Sets `field`, `txIdx` values according to arguments passed.
   * @param args Expected arguments: [transaction group index, transaction field]
   * // Note: Transaction field is expected as string instead of number.
   * For ex: `Fee` is expected and `0` is not expected.
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    this.txFieldIdx = undefined;
    if (TxArrFields[interpreter.tealVersion].has(args[1])) {
      assertLen(args.length, 3, line); // eg. gtxn 0 Accounts 1
      assertOnlyDigits(args[2], line);
      this.txFieldIdx = Number(args[2]);
    } else {
      assertLen(args.length, 2, line);
    }
    assertOnlyDigits(args[0], line);
    this.assertTxFieldDefined(args[1], interpreter.tealVersion, line);

    this.txIdx = Number(args[0]); // transaction group index
    this.field = args[1]; // field
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    this.assertUint8(BigInt(this.txIdx), this.line);
    this.checkIndexBound(this.txIdx, this.interpreter.runtime.ctx.gtxs, this.line);
    let result;

    if (this.txFieldIdx !== undefined) {
      const tx = this.interpreter.runtime.ctx.gtxs[this.txIdx]; // current tx
      result = txAppArg(this.field, tx, this.txFieldIdx, this, this.interpreter.tealVersion, this.line);
    } else {
      result = txnSpecbyField(
        this.field,
        this.interpreter.runtime.ctx.gtxs[this.txIdx],
        this.interpreter.runtime.ctx.gtxs,
        this.interpreter.tealVersion);
    }
    stack.push(result);
  }
}

/**
 * push value of an array field from current transaction to stack
 * push to stack [...stack, value of an array field ]
 * NOTE: a) for arg="Accounts" index 0 means sender's address, and index 1 means first address
 * from accounts array (eg. txna Accounts 1: will push 1st address from Accounts[] to stack)
 * b) for arg="ApplicationArgs" index 0 means first argument for application array (normal indexing)
 */
export class Txna extends Op {
  readonly field: string;
  readonly idx: number;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Sets `field` and `idx` values according to arguments passed.
   * @param args Expected arguments: [transaction field, transaction field array index]
   * // Note: Transaction field is expected as string instead of number.
   * For ex: `Fee` is expected and `0` is not expected.
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    assertLen(args.length, 2, line);
    assertOnlyDigits(args[1], line);
    this.assertTxArrFieldDefined(args[0], interpreter.tealVersion, line);

    this.field = args[0]; // field
    this.idx = Number(args[1]);
    this.interpreter = interpreter;
  }

  execute (stack: TEALStack): void {
    const result = txAppArg(this.field, this.interpreter.runtime.ctx.tx, this.idx, this,
      this.interpreter.tealVersion, this.line);
    stack.push(result);
  }
}

/**
 * push value of a field to the stack from a transaction in the current transaction group
 * push to stack [...stack, value of field]
 * NOTE: for arg="Accounts" index 0 means sender's address, and index 1 means first address from accounts
 * array (eg. gtxna 0 Accounts 1: will push 1st address from Accounts[](from the 1st tx in group) to stack)
 * b) for arg="ApplicationArgs" index 0 means first argument for application array (normal indexing)
 */
export class Gtxna extends Op {
  readonly field: string;
  readonly idx: number; // array index
  readonly interpreter: Interpreter;
  readonly line: number;
  protected txIdx: number; // transaction group index

  /**
   * Sets `field`(Transaction Field), `idx`(Array Index) and
   * `txIdx`(Transaction Group Index) values according to arguments passed.
   * @param args Expected arguments:
   * [transaction group index, transaction field, transaction field array index]
   * // Note: Transaction field is expected as string instead of number.
   * For ex: `Fee` is expected and `0` is not expected.
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 3, line);
    assertOnlyDigits(args[0], line);
    assertOnlyDigits(args[2], line);
    this.assertTxArrFieldDefined(args[1], interpreter.tealVersion, line);

    this.txIdx = Number(args[0]); // transaction group index
    this.field = args[1]; // field
    this.idx = Number(args[2]); // transaction field array index
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertUint8(BigInt(this.txIdx), this.line);
    this.checkIndexBound(this.txIdx, this.interpreter.runtime.ctx.gtxs, this.line);
    const tx = this.interpreter.runtime.ctx.gtxs[this.txIdx];
    const result = txAppArg(this.field, tx, this.idx, this, this.interpreter.tealVersion, this.line);
    stack.push(result);
  }
}

// represents branch name of a new branch
// push to stack [...stack]
export class Label extends Op {
  readonly label: string;
  readonly line: number;

  /**
   * Sets `label` according to arguments passed.
   * @param args Expected arguments: [label]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    assertLen(args.length, 1, line);
    this.label = args[0].split(':')[0];
    this.line = line;
  };

  execute (stack: TEALStack): void {}
}

// branch unconditionally to label
// push to stack [...stack]
export class Branch extends Op {
  readonly label: string;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Sets `label` according to arguments passed.
   * @param args Expected arguments: [label of branch]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 1, line);
    this.label = args[0];
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.interpreter.jumpForward(this.label, this.line);
  }
}

// branch conditionally if top of stack is zero
// push to stack [...stack]
export class BranchIfZero extends Op {
  readonly label: string;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Sets `label` according to arguments passed.
   * @param args Expected arguments: [label of branch]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 1, line);
    this.label = args[0];
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);

    if (last === 0n) {
      this.interpreter.jumpForward(this.label, this.line);
    }
  }
}

// branch conditionally if top of stack is non zero
// push to stack [...stack]
export class BranchIfNotZero extends Op {
  readonly label: string;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Sets `label` according to arguments passed.
   * @param args Expected arguments: [label of branch]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 1, line);
    this.label = args[0];
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const last = this.assertBigInt(stack.pop(), this.line);

    if (last !== 0n) {
      this.interpreter.jumpForward(this.label, this.line);
    }
  }
}

// use last value on stack as success value; end
// push to stack [...stack, last]
export class Return extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);

    const last = stack.pop();
    while (stack.length()) {
      stack.pop();
    }
    stack.push(last); // use last value as success
    this.interpreter.instructionIndex = this.interpreter.instructions.length; // end execution
  }
}

// push field from current transaction to stack
export class Global extends Op {
  readonly field: string;
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Stores global field to query as string
   * @param args Expected arguments: [field] // Ex: ["GroupSize"]
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 1, line);
    this.assertGlobalDefined(args[0], interpreter.tealVersion, line);

    this.field = args[0]; // global field
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    let result;
    switch (this.field) {
      case 'GroupSize': {
        result = this.interpreter.runtime.ctx.gtxs.length;
        break;
      }
      case 'CurrentApplicationID': {
        result = this.interpreter.runtime.ctx.tx.apid;
        this.interpreter.runtime.assertAppDefined(
          result as number,
          this.interpreter.getApp(result as number, this.line),
          this.line);
        break;
      }
      case 'Round': {
        result = this.interpreter.runtime.getRound();
        break;
      }
      case 'LatestTimestamp': {
        result = this.interpreter.runtime.getTimestamp();
        break;
      }
      case 'CreatorAddress': {
        const appID = this.interpreter.runtime.ctx.tx.apid;
        const app = this.interpreter.getApp(appID as number, this.line);
        result = decodeAddress(app.creator).publicKey;
        break;
      }
      default: {
        result = GlobalFields[this.interpreter.tealVersion][this.field];
      }
    }

    if (typeof result === 'number') {
      stack.push(BigInt(result));
    } else {
      stack.push(result);
    }
  }
}

// check if account specified by Txn.Accounts[A] opted in for the application B => {0 or 1}
// params: account index, application id (top of the stack on opcode entry).
// push to stack [...stack, 1] if opted in
// push to stack[...stack, 0] 0 otherwise
export class AppOptedIn extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const appID = this.assertBigInt(stack.pop(), this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);

    const account = this.interpreter.getAccount(accountIndex, this.line);
    const localState = account.appsLocalState;

    const isOptedIn = localState.get(Number(appID));
    if (isOptedIn) {
      stack.push(1n);
    } else {
      stack.push(0n);
    }
  }
}

// read from account specified by Txn.Accounts[A] from local state of the current application key B => value
// push to stack [...stack, bigint/bytes] If key exist
// push to stack [...stack, 0] otherwise
export class AppLocalGet extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const key = this.assertBytes(stack.pop(), this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);

    const account = this.interpreter.getAccount(accountIndex, this.line);
    const appID = this.interpreter.runtime.ctx.tx.apid ?? 0;

    const val = account.getLocalState(appID, key);
    if (val) {
      stack.push(val);
    } else {
      stack.push(0n); // The value is zero if the key does not exist.
    }
  }
}

// read from application local state at Txn.Accounts[A] => app B => key C from local state.
// push to stack [...stack, value, 1] (Note: value is 0 if key does not exist)
export class AppLocalGetEx extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 3, this.line);
    const key = this.assertBytes(stack.pop(), this.line);
    const appID = this.assertBigInt(stack.pop(), this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);

    const account = this.interpreter.getAccount(accountIndex, this.line);
    const val = account.getLocalState(Number(appID), key);
    if (val) {
      stack.push(val);
      stack.push(1n);
    } else {
      stack.push(0n); // The value is zero if the key does not exist.
      stack.push(0n); // did_exist_flag
    }
  }
}

// read key A from global state of a current application => value
// push to stack[...stack, 0] if key doesn't exist
// otherwise push to stack [...stack, value]
export class AppGlobalGet extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const key = this.assertBytes(stack.pop(), this.line);

    const appID = this.interpreter.runtime.ctx.tx.apid ?? 0;
    const val = this.interpreter.getGlobalState(appID, key, this.line);
    if (val) {
      stack.push(val);
    } else {
      stack.push(0n); // The value is zero if the key does not exist.
    }
  }
}

// read from application Txn.ForeignApps[A] global state key B pushes to the stack
// push to stack [...stack, value, 1] (Note: value is 0 if key does not exist)
// A is specified as an account index in the ForeignApps field of the ApplicationCall transaction,
// zero index means this app
export class AppGlobalGetEx extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const key = this.assertBytes(stack.pop(), this.line);
    let appIndex = this.assertBigInt(stack.pop(), this.line);

    const foreignApps = this.interpreter.runtime.ctx.tx.apfa;
    let appID;
    if (appIndex === 0n) {
      appID = this.interpreter.runtime.ctx.tx.apid; // zero index means current app
    } else {
      this.checkIndexBound(Number(--appIndex), foreignApps as number[], this.line);
      appID = foreignApps ? foreignApps[Number(appIndex)] : undefined;
    }

    const val = this.interpreter.getGlobalState(appID as number, key, this.line);
    if (val) {
      stack.push(val);
      stack.push(1n);
    } else {
      stack.push(0n); // The value is zero if the key does not exist.
      stack.push(0n); // did_exist_flag
    }
  }
}

// write to account specified by Txn.Accounts[A] to local state of a current application key B with value C
// pops from stack [...stack, value, key]
// pushes nothing to stack, updates the app user local storage
export class AppLocalPut extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 3, this.line);
    const value = stack.pop();
    const key = this.assertBytes(stack.pop(), this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);

    const account = this.interpreter.getAccount(accountIndex, this.line);
    const appID = this.interpreter.runtime.ctx.tx.apid ?? 0;

    // get updated local state for account
    const localState = account.setLocalState(appID, key, value, this.line);
    const acc = this.interpreter.runtime.assertAccountDefined(account.address,
      this.interpreter.runtime.ctx.state.accounts.get(account.address), this.line);
    acc.appsLocalState.set(appID, localState);
  }
}

// write key A and value B to global state of the current application
// push to stack [...stack]
export class AppGlobalPut extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const value = stack.pop();
    const key = this.assertBytes(stack.pop(), this.line);

    const appID = this.interpreter.runtime.ctx.tx.apid ?? 0; // if undefined use 0 as default
    this.interpreter.setGlobalState(appID, key, value, this.line);
  }
}

// delete from account specified by Txn.Accounts[A] local state key B of the current application
// push to stack [...stack]
export class AppLocalDel extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const key = this.assertBytes(stack.pop(), this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);

    const appID = this.interpreter.runtime.ctx.tx.apid ?? 0;
    const account = this.interpreter.getAccount(accountIndex, this.line);

    const localState = account.appsLocalState.get(appID);
    if (localState) {
      localState["key-value"].delete(key.toString()); // delete from local state

      let acc = this.interpreter.runtime.ctx.state.accounts.get(account.address);
      acc = this.interpreter.runtime.assertAccountDefined(account.address, acc, this.line);
      acc.appsLocalState.set(appID, localState);
    }
  }
}

// delete key A from a global state of the current application
// push to stack [...stack]
export class AppGlobalDel extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    assertLen(args.length, 0, line);
    this.interpreter = interpreter;
    this.line = line;
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const key = this.assertBytes(stack.pop(), this.line);

    const appID = this.interpreter.runtime.ctx.tx.apid ?? 0;

    const app = this.interpreter.getApp(appID, this.line);
    if (app) {
      const globalState = app["global-state"];
      globalState.delete(key.toString());
    }
  }
}

// get balance for the requested account specified
// by Txn.Accounts[A] in microalgos. A is specified as an account
// index in the Accounts field of the ApplicationCall transaction,
// zero index means the sender
// push to stack [...stack, bigint]
export class Balance extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts if arguments length is zero
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter Interpreter Object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.interpreter = interpreter;
    this.line = line;

    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);
    const acc = this.interpreter.getAccount(accountIndex, this.line);

    stack.push(BigInt(acc.balance()));
  }
}

// For Account A, Asset B (txn.accounts[A]) pushes to the
// push to stack [...stack, value(bigint/bytes), 1]
// NOTE: if account has no B holding then value = 0, did_exist = 0,
export class GetAssetHolding extends Op {
  readonly interpreter: Interpreter;
  readonly field: string;
  readonly line: number;

  /**
   * Sets field according to arguments passed.
   * @param args Expected arguments: [Asset Holding field]
   * // Note: Asset holding field will be string
   * For ex: `AssetBalance` is correct `0` is not.
   * @param line line number in TEAL file
   * @param interpreter Interpreter Object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.interpreter = interpreter;
    this.line = line;
    assertLen(args.length, 1, line);

    this.field = args[0];
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const assetId = this.assertBigInt(stack.pop(), this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);

    const account = this.interpreter.getAccount(accountIndex, this.line);
    const assetInfo = account.assets.get(Number(assetId));
    if (assetInfo === undefined) {
      stack.push(0n);
      stack.push(0n);
      return;
    }
    let value: StackElem;
    switch (this.field) {
      case "AssetBalance":
        value = BigInt(assetInfo.amount);
        break;
      case "AssetFrozen":
        value = assetInfo["is-frozen"] ? 1n : 0n;
        break;
      default:
        throw new RuntimeError(RUNTIME_ERRORS.TEAL.INVALID_FIELD_TYPE, { line: this.line });
    }

    stack.push(value);
    stack.push(1n);
  }
}

// get Asset Params Info for given account
// For Index in ForeignAssets array
// push to stack [...stack, value(bigint/bytes), did_exist]
// NOTE: if asset doesn't exist, then did_exist = 0, value = 0
export class GetAssetDef extends Op {
  readonly interpreter: Interpreter;
  readonly field: string;
  readonly line: number;

  /**
   * Sets transaction field according to arguments passed
   * @param args Expected arguments: [Asset Params field]
   * // Note: Asset Params field will be string
   * For ex: `AssetTotal` is correct `0` is not.
   * @param line line number in TEAL file
   * @param interpreter Interpreter Object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.line = line;
    this.interpreter = interpreter;
    assertLen(args.length, 1, line);
    if (AssetParamMap[args[0]] === undefined) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.UNKNOWN_ASSET_FIELD, { field: args[0], line: line });
    }

    this.field = args[0];
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const foreignAssetsIdx = this.assertBigInt(stack.pop(), this.line);
    this.checkIndexBound(
      Number(foreignAssetsIdx),
      this.interpreter.runtime.ctx.tx.apas as number[], this.line);

    let assetId;
    if (this.interpreter.runtime.ctx.tx.apas) {
      assetId = this.interpreter.runtime.ctx.tx.apas[Number(foreignAssetsIdx)];
    } else {
      throw new Error("foreign asset id not found");
    }
    const AssetDefinition = this.interpreter.getAssetDef(assetId);
    let def: string;

    if (AssetDefinition === undefined) {
      stack.push(0n);
      stack.push(0n);
    } else {
      let value: StackElem;
      const s = AssetParamMap[this.field] as keyof AssetParams;

      switch (this.field) {
        case "AssetTotal":
          value = BigInt(AssetDefinition.total);
          break;
        case "AssetDecimals":
          value = BigInt(AssetDefinition.decimals);
          break;
        case "AssetDefaultFrozen":
          value = AssetDefinition.defaultFrozen ? 1n : 0n;
          break;
        default:
          def = AssetDefinition[s] as string;
          if (isValidAddress(def)) {
            value = decodeAddress(def).publicKey;
          } else {
            value = stringToBytes(def);
          }
          break;
      }

      stack.push(value);
      stack.push(1n);
    }
  }
}

/** Pseudo-Ops **/
// push integer to stack
// push to stack [...stack, integer value]
export class Int extends Op {
  readonly uint64: bigint;
  readonly line: number;

  /**
   * Sets uint64 variable according to arguments passed.
   * @param args Expected arguments: [number]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);

    let uint64;
    const intConst = TxnOnComplete[args[0] as keyof typeof TxnOnComplete] ||
      TxnType[args[0] as keyof typeof TxnType];

    // check if string is keyof TxnOnComplete or TxnType
    if (intConst !== undefined) {
      uint64 = BigInt(intConst);
    } else {
      assertOnlyDigits(args[0], line);
      uint64 = BigInt(args[0]);
    }

    this.checkOverflow(uint64, line);
    this.uint64 = uint64;
  }

  execute (stack: TEALStack): void {
    stack.push(this.uint64);
  }
}

// push bytes to stack
// push to stack [...stack, converted data]
export class Byte extends Op {
  readonly str: string;
  readonly encoding: EncodingType;
  readonly line: number;

  /**
   * Sets `str` and  `encoding` values according to arguments passed.
   * @param args Expected arguments: [data string]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    [this.str, this.encoding] = getEncoding(args, line);
  }

  execute (stack: TEALStack): void {
    const buffer = convertToBuffer(this.str, this.encoding);
    stack.push(new Uint8Array(buffer));
  }
}

// decodes algorand address to bytes and pushes to stack
// push to stack [...stack, address]
export class Addr extends Op {
  readonly addr: string;
  readonly line: number;

  /**
   * Sets `addr` value according to arguments passed.
   * @param args Expected arguments: [Address]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    assertLen(args.length, 1, line);
    if (!isValidAddress(args[0])) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.INVALID_ADDR, { addr: args[0], line: line });
    }
    this.addr = args[0];
    this.line = line;
  };

  execute (stack: TEALStack): void {
    const addr = decodeAddress(this.addr);
    stack.push(addr.publicKey);
  }
}

/* TEALv3 Ops */

// immediately fail unless value top is a non-zero number
// pops from stack: [...stack, uint64]
export class Assert extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const top = this.assertBigInt(stack.pop(), this.line);
    if (top === 0n) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.TEAL_ENCOUNTERED_ERR, { line: this.line });
    }
  }
}

// push immediate UINT to the stack as an integer
// push to stack: [...stack, uint64]
export class PushInt extends Op {
  /**
   * NOTE: in runtime this class is similar to Int, but from tealv3 perspective this is optimized
   * because pushint args are not added to the intcblock during assembly processes
   */
  readonly uint64: bigint;
  readonly line: number;

  /**
   * Sets uint64 variable according to arguments passed.
   * @param args Expected arguments: [number]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);
    assertOnlyDigits(args[0], line);

    this.checkOverflow(BigInt(args[0]), line);
    this.uint64 = BigInt(args[0]);
  }

  execute (stack: TEALStack): void {
    stack.push(this.uint64);
  }
}

// push bytes to stack
// push to stack [...stack, converted data]
export class PushBytes extends Op {
  /**
   * NOTE: in runtime this class is similar to Byte, but from tealv3 perspective this is optimized
   * because pushbytes args are not added to the bytecblock during assembly processes
   */
  readonly str: string;
  readonly encoding: EncodingType;
  readonly line: number;

  /**
   * Sets `str` and  `encoding` values according to arguments passed.
   * @param args Expected arguments: [data string]
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);
    [this.str, this.encoding] = getEncoding(args, line);
    if (this.encoding !== EncodingType.UTF8) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.UNKOWN_DECODE_TYPE, { val: args[0], line: line });
    }
  }

  execute (stack: TEALStack): void {
    const buffer = convertToBuffer(this.str, this.encoding);
    stack.push(new Uint8Array(buffer));
  }
}

// swaps two last values on stack: A, B -> B, A (A,B = any)
// pops from stack: [...stack, A, B]
// pushes to stack: [...stack, B, A]
export class Swap extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const a = stack.pop();
    const b = stack.pop();
    stack.push(a);
    stack.push(b);
  }
}

/**
 * bit indexing begins with low-order bits in integers.
 * Setting bit 4 to 1 on the integer 0 yields 16 (int 0x0010, or 2^4).
 * Indexing begins in the first bytes of a byte-string
 * (as seen in getbyte and substring). Setting bits 0 through 11 to 1
 * in a 4 byte-array of 0s yields byte 0xfff00000
 * Pops from stack: [ ... stack, {any A}, {uint64 B}, {uint64 C} ]
 * Pushes to stack: [ ...stack, uint64 ]
 * pop a target A, index B, and bit C. Set the Bth bit of A to C, and push the result
 */
export class SetBit extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 3, this.line);
    const bit = this.assertBigInt(stack.pop(), this.line);
    const index = this.assertBigInt(stack.pop(), this.line);
    const target = stack.pop();

    if (bit > 1n) {
      throw new RuntimeError(RUNTIME_ERRORS.TEAL.SET_BIT_VALUE_ERROR, { line: this.line });
    }

    if (typeof target === "bigint") {
      this.assert64BitIndex(index, this.line);
      const binaryStr = target.toString(2);
      const binaryArr = [...(binaryStr.padStart(64, "0"))];
      const size = binaryArr.length;
      binaryArr[size - Number(index) - 1] = (bit === 0n ? "0" : "1");
      stack.push(parseBinaryStrToBigInt(binaryArr));
    } else {
      const byteIndex = Math.floor(Number(index) / 8);
      this.assertBytesIndex(byteIndex, target, this.line);

      const targetBit = Number(index) % 8;
      // 8th bit in a bytes array will be highest order bit in second element
      // that's why mask is reversed
      const mask = 1 << (7 - targetBit);
      if (bit === 1n) {
        // set bit
        target[byteIndex] |= mask;
      } else {
        // clear bit
        const mask = ~(1 << ((7 - targetBit)));
        target[byteIndex] &= mask;
      }
      stack.push(target);
    }
  }
}

/**
 * pop a target A (integer or byte-array), and index B. Push the Bth bit of A.
 * Pops from stack: [ ... stack, {any A}, {uint64 B}]
 * Pushes to stack: [ ...stack, uint64]
 */
export class GetBit extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const index = this.assertBigInt(stack.pop(), this.line);
    const target = stack.pop();

    if (typeof target === "bigint") {
      this.assert64BitIndex(index, this.line);
      const binaryStr = target.toString(2);
      const size = binaryStr.length;
      stack.push(BigInt(binaryStr[size - Number(index) - 1]));
    } else {
      const byteIndex = Math.floor(Number(index) / 8);
      this.assertBytesIndex(byteIndex, target, this.line);

      const targetBit = Number(index) % 8;
      const binary = target[byteIndex].toString(2);
      const str = binary.padStart(8, "0");
      stack.push(BigInt(str[targetBit]));
    }
  }
}

/**
 * pop a byte-array A, integer B, and
 * small integer C (between 0..255). Set the Bth byte of A to C, and push the result
 * Pops from stack: [ ...stack, {[]byte A}, {uint64 B}, {uint64 C}]
 * Pushes to stack: [ ...stack, []byte]
 */
export class SetByte extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 3, this.line);
    const smallInteger = this.assertBigInt(stack.pop(), this.line);
    const index = this.assertBigInt(stack.pop(), this.line);
    const target = this.assertBytes(stack.pop(), this.line);
    this.assertUint8(smallInteger, this.line);
    this.assertBytesIndex(Number(index), target, this.line);

    target[Number(index)] = Number(smallInteger);
    stack.push(target);
  }
}

/**
 * pop a byte-array A and integer B. Extract the Bth byte of A and push it as an integer
 * Pops from stack: [ ...stack, {[]byte A}, {uint64 B} ]
 * Pushes to stack: [ ...stack, uint64 ]
 */
export class GetByte extends Op {
  readonly line: number;
  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 2, this.line);
    const index = this.assertBigInt(stack.pop(), this.line);
    const target = this.assertBytes(stack.pop(), this.line);
    this.assertBytesIndex(Number(index), target, this.line);

    stack.push(BigInt(target[Number(index)]));
  }
}

// push the Nth value (0 indexed) from the top of the stack.
// pops from stack: [...stack]
// pushes to stack: [...stack, any (nth slot from top of stack)]
// NOTE: dig 0 is same as dup
export class Dig extends Op {
  readonly line: number;
  readonly depth: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [ depth ] // slot to duplicate
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 1, line);
    assertOnlyDigits(args[0], line);

    this.assertUint8(BigInt(args[0]), line);
    this.depth = Number(args[0]);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, this.depth + 1, this.line);
    const tempStack = new Stack<StackElem>(this.depth + 1); // depth = 2 means 3rd slot from top of stack
    let target;
    for (let i = 0; i <= this.depth; ++i) {
      target = stack.pop();
      tempStack.push(target);
    }
    while (tempStack.length()) { stack.push(tempStack.pop()); }
    stack.push(target as StackElem);
  }
}

// selects one of two values based on top-of-stack: A, B, C -> (if C != 0 then B else A)
// pops from stack: [...stack, {any A}, {any B}, {uint64 C}]
// pushes to stack: [...stack, any (A or B)]
export class Select extends Op {
  readonly line: number;

  /**
   * Asserts 0 arguments are passed.
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   */
  constructor (args: string[], line: number) {
    super();
    this.line = line;
    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 3, this.line);
    const toCheck = this.assertBigInt(stack.pop(), this.line);
    const notZeroSelection = stack.pop();
    const isZeroSelection = stack.pop();

    if (toCheck !== 0n) { stack.push(notZeroSelection); } else { stack.push(isZeroSelection); }
  }
}

/**
 * push field F of the Ath transaction (A = top of stack) in the current group
 * pops from stack: [...stack, uint64]
 * pushes to stack: [...stack, transaction field]
 * NOTE: "gtxns field" is equivalent to "gtxn _i_ field" (where _i_ is the index
 * of transaction in group, fetched from stack).
 * gtxns exists so that i can be calculated, often based on the index of the current transaction.
 */
export class Gtxns extends Gtxn {
  /**
   * Sets `field`, `txIdx` values according to arguments passed.
   * @param args Expected arguments: [transaction field]
   * // Note: Transaction field is expected as string instead of number.
   * For ex: `Fee` is expected and `0` is not expected.
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    // NOTE: 100 is a mock value (max no of txns in group can be 16 atmost).
    // In gtxns & gtxnsa opcodes, index is fetched from top of stack.
    super(["100", ...args], line, interpreter);
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const top = this.assertBigInt(stack.pop(), this.line);
    this.assertUint8(top, this.line);
    this.txIdx = Number(top);
    super.execute(stack);
  }
}

/**
 * push Ith value of the array field F from the Ath (A = top of stack) transaction in the current group
 * pops from stack: [...stack, uint64]
 * push to stack [...stack, value of field]
 */
export class Gtxnsa extends Gtxna {
  /**
   * Sets `field`(Transaction Field), `idx`(Array Index) values according to arguments passed.
   * @param args Expected arguments: [transaction field(F), transaction field array index(I)]
   * // Note: Transaction field is expected as string instead of number.
   * For ex: `Fee` is expected and `0` is not expected.
   * @param line line number in TEAL file
   * @param interpreter interpreter object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    // NOTE: 100 is a mock value (max no of txns in group can be 16 atmost).
    // In gtxns & gtxnsa opcodes, index is fetched from top of stack.
    super(["100", ...args], line, interpreter);
  }

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const top = this.assertBigInt(stack.pop(), this.line);
    this.assertUint8(top, this.line);
    this.txIdx = Number(top);
    super.execute(stack);
  }
}

/**
 * get minimum required balance for the requested account specified by Txn.Accounts[A] in microalgos.
 * NOTE: A = 0 represents tx.sender account. Required balance is affected by ASA and App usage. When creating
 * or opting into an app, the minimum balance grows before the app code runs, therefore the increase
 * is visible there. When deleting or closing out, the minimum balance decreases after the app executes.
 * pops from stack: [...stack, uint64(account index)]
 * push to stack [...stack, uint64(min balance in microalgos)]
 */
export class MinBalance extends Op {
  readonly interpreter: Interpreter;
  readonly line: number;

  /**
   * Asserts if arguments length is zero
   * @param args Expected arguments: [] // none
   * @param line line number in TEAL file
   * @param interpreter Interpreter Object
   */
  constructor (args: string[], line: number, interpreter: Interpreter) {
    super();
    this.interpreter = interpreter;
    this.line = line;

    assertLen(args.length, 0, line);
  };

  execute (stack: TEALStack): void {
    this.assertMinStackLen(stack, 1, this.line);
    const accountIndex = this.assertBigInt(stack.pop(), this.line);
    const acc = this.interpreter.getAccount(accountIndex, this.line);

    stack.push(BigInt(acc.minBalance));
  }
}
