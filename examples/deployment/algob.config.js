// NOTE: below we provide some example accounts.
// DON'T this account in any working environment because everyone can check it and use
// the private keys (this accounts are visible to everyone).

// Example: accounts constructed using mnemonic. `addr` is optional.
// const { mkAccounts } = require("algob");
// let accounts = mkAccounts([{
//   addr: "KFMPC5QWM3SC54X7UWUW6OSDOIT3H3YA5UOCUAE2ABERXYSKZS5Q3X5IZY",
//   mnemonic: "call boy rubber fashion arch day capable one sweet skate outside purse six early learn tuition eagle love breeze pizza loud today popular able divide"
// }]);

//// Example: accounts constructed using the Account object
//let accounts = [{
//  name: "owner",
//  addr: 'UDF7DS5QXECBUEDF3GZVHHLXDRJOVTGR7EORYGDBPJ2FNB5D5T636QMWZY',
//  sk: new Uint8Array([28,  45,  45,  15,  70, 188,  57, 228,  18,  21,  42, 228,  33, 187, 222, 162,  89,  15,  22,  52, 143, 171, 182,  17, 168, 238,  96, 177,  12, 163, 243, 231, 160, 203, 241, 203, 176, 185,   4,  26,  16, 101, 217, 179, 83, 157, 119,  28,  82, 234, 204, 209, 249,  29,  28, 24,  97, 122, 116,  86, 135, 163, 236, 253])
//}]

//const algorandBuilder = require("algorand-builder");
//console.log("hi", ab);
//const { mkAccounts } = require("algorand-builder");

const { mkAccounts } = require("algob");
let accounts = mkAccounts([{
  name: "master-account",
  // goal account list -d ~/.algorand-local/Node/
  addr: "WWYNX3TKQYVEREVSW6QQP3SXSFOCE3SKUSEIVJ7YAGUPEACNI5UGI4DZCE",
  // Use your own account.
  // Export using:
  // goal account export -a WWYNX3TKQYVEREVSW6QQP3SXSFOCE3SKUSEIVJ7YAGUPEACNI5UGI4DZCE -d ~/.algorand-local/Node/
  mnemonic: "enforce drive foster uniform cradle tired win arrow wasp melt cattle chronic sport dinosaur announce shell correct shed amused dismiss mother jazz task above hospital"
},
  {
    name: "gold-owner-account",
    addr: "M7VR2MGHI35EG2NMYOF3X337636PIOFVSP2HNIFUKAG7WW6BDWDCA3E2DA",
    mnemonic: "quick stage planet wild coffee whale build brisk forest leave same segment armed alter fog know run distance excess galaxy limb talent nut able noodle"
  },
  {
    name: "elon-musk-account",
    addr: "WHVQXVVCQAD7WX3HHFKNVUL3MOANX3BYXXMEEJEJWOZNRXJNTN7LTNPSTY",
    mnemonic: "resist derive table space jealous person pink ankle hint venture manual spawn move harbor flip cigar copy throw swap night series hybrid chest absent art"
  },
  {
    name: "john-account",
    addr: "2UBZKFR6RCZL7R24ZG327VKPTPJUPFM6WTG7PJG2ZJLU234F5RGXFLTAKA",
    mnemonic: "found empower message suit siege arrive dad reform museum cake evoke broom comfort fluid flower wheat gasp baby auction tuna sick case camera about flip"
  }
]);

// const { loadAccountsFromFileSync } = require("algob");
// // Example: accounts loaded from a file:
// const accFromFile = loadAccountsFromFileSync("assets/accounts_generated.yaml");
// accounts = accounts.concat(accFromFile);

// Node commands:
// Start whole network:
// goal network start -r ~/.algorand-local/
// Start/stop a single node:
// goal node start -d ~/.algorand-local/Node/

let defaultCfg = {
  host: "http://localhost",
  port: 46469,
  token: "aade468d25a7aa48fec8082d6a847c48492066a2741f3731e613fdde086cd6e9",
  accounts: accounts,
};

module.exports = {
  networks: {
    localhost: defaultCfg,
    default: defaultCfg
  }
};
