const fs = require("fs");

// check if local config in /examples exists if yes then use it, otherwise use a template
// config provided by this repository.

let config = "../algob.config-local.js";
try{
  fs.accessSync(config, fs.constants.F_OK);
} catch {
  config = "../algob.config-template.js";
}
console.log("config file: ", config);

module.exports = require(config);
