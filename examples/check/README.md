# ASA deployment using [Algo Builder](https://github.com/scale-it/algo-builder/)

This project shows how to create Algorand Standard Asset (ASA).
We will create gold and tesla assets. In algob, we recommend to
create assets using a specification file, as provided in `assets/asa.yaml`.

Each of these assets are owned by their specific owner accounts.
After the creation, a third account is opted-in in order to receive the assets.

Transfers can be executed by executing `algob run scripts/transfer/gold-to-john.js` and other scripts in `scripts/transfer/`.
These scripts contain logic to transfer assets to `john-account` but other accounts can be configured as well.

Balances can be queried by executing `algob run scripts/query/john-balances.js`.

This example also includes creation of ASA owned by contract with following features:
- Maximum number of ASA creation limit is 1.
- Transaction must be signed by owner to get ASA out from contract
- Only owner can call - update smart contract to set a new owner
- Only owner can transfer ASA out from the smart contract and maximum payment is 100 ASA.

## Usage

Please follow the [setup](../README.md) instructions to install dependencies and update the config.
This example is using PyTEAL, so make sure to follow the Python3 setup described above.

### Run
```
yarn algob deploy
yarn algob run scripts/query/john-balances.js
```
