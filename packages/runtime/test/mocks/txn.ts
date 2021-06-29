import { decodeAddress, generateAccount } from "algosdk";

import { bobAccount, elonMuskAccount, johnAccount } from "./account";

export const ALGORAND_MIN_TX_FEE = 1000;

const account = generateAccount();
const addr = decodeAddress(account.addr);

export const elonAddr = elonMuskAccount.addr;
export const johnAddr = johnAccount.addr;

/**
 * Mock (encoded)transaction object used in tests
 * reference for these fields: https://developer.algorand.org/docs/reference/transactions/
 * Or check TxnFields map in ../lib/constants
 */
export const TXN_OBJ = {
  snd: Buffer.from(addr.publicKey),
  rcv: Buffer.from(addr.publicKey),
  asnd: Buffer.from(addr.publicKey),
  arcv: Buffer.from(addr.publicKey),
  fee: 1000,
  amt: 20200,
  aamt: 100,
  fv: 258820,
  lv: 259820,
  note: Buffer.from("Note"),
  gen: 'default-v1',
  gh: Buffer.from('default-v1'),
  lx: Buffer.from(""),
  aclose: Buffer.from(addr.publicKey),
  close: Buffer.from(addr.publicKey),
  votekey: Buffer.from("voteKey"),
  selkey: Buffer.from("selectionKey"),
  votefst: 123,
  votelst: 345,
  votekd: 1234,
  xaid: 1101,
  caid: 101,
  apar: {
    t: 10,
    dc: 0,
    df: false,
    m: Buffer.from(addr.publicKey),
    r: Buffer.from(addr.publicKey),
    f: Buffer.from(addr.publicKey),
    c: Buffer.from(addr.publicKey),
    un: 'tst',
    an: 'testcoin',
    au: 'testURL',
    am: Buffer.from('test-hash')
  },
  fadd: Buffer.from(addr.publicKey),
  faid: 202,
  afrz: false,
  apid: 1201,
  apan: 0,
  apap: Buffer.from("approval"),
  apsu: Buffer.from("clear"),
  apaa: [Buffer.from("arg1"), Buffer.from("arg2")],
  apat: [Buffer.from(decodeAddress(johnAddr).publicKey),
    Buffer.from(decodeAddress(bobAccount.addr).publicKey)],
  apfa: [1828, 1002, 1003],
  apas: [2001, 2002, 2003],
  type: 'pay',
  apls: {
    nui: 1,
    nbs: 2
  },
  apgs: {
    nui: 3,
    nbs: 4
  },
  txID: 'transaction-id',
  rekey: Buffer.from(addr.publicKey),
  grp: Buffer.from('group')
};
