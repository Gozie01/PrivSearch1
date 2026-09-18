require("dotenv").config();
require("@nomicfoundation/hardhat-ethers");

const PURECHAIN_RPC_URL = process.env.PURECHAIN_RPC_URL || "https://purechainnode.com";
const PURECHAIN_CHAIN_ID = Number(process.env.PURECHAIN_CHAIN_ID || "900520900520");
const PURECHAIN_GAS_PRICE = Number(process.env.PURECHAIN_GAS_PRICE || "0");
const DEPLOYER_PRIVATE_KEY = process.env.PURECHAIN_PRIVATE_KEY;
const EXTERNAL_EVM_RPC_URL = process.env.EXTERNAL_EVM_RPC_URL || "";
const EXTERNAL_EVM_CHAIN_ID = Number(process.env.EXTERNAL_EVM_CHAIN_ID || "11155111");
const EXTERNAL_EVM_GAS_PRICE = process.env.EXTERNAL_EVM_GAS_PRICE
  ? Number(process.env.EXTERNAL_EVM_GAS_PRICE)
  : undefined;

const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    purechain: {
      url: PURECHAIN_RPC_URL,
      chainId: PURECHAIN_CHAIN_ID,
      gasPrice: PURECHAIN_GAS_PRICE,
      accounts,
    },
    external: {
      url: EXTERNAL_EVM_RPC_URL,
      chainId: EXTERNAL_EVM_CHAIN_ID,
      gasPrice: EXTERNAL_EVM_GAS_PRICE,
      accounts,
    },
  },
};
