enum NetworkType {
  TESTNET = "testnet",
  DEVNET = "devnet",
}

const NETWORK = process.env.NETWORK || NetworkType.DEVNET;
const NODE_URL = "https://devnet.aztec-labs.com";
const SECRET_KEY = process.env.SECRET_KEY || "0x111";
const SALT = process.env.SALT || "0x222";
const WORMHOLE_ADDRESS =
  process.env.WORMHOLE_ADDRESS_AZTEC ||
  "0x06fb4a7c7c4bc5bcce00451037135b0536ad9b28b907c38dd6b4378dd1549d02";
const SPONSORED_FPC_ADDRESS =
  process.env.SPONSORED_FPC_ADDRESS ||
  "0x299f255076aa461e4e94a843f0275303470a6b8ebe7cb44a471c66711151e529";

export {
  NetworkType,
  NODE_URL,
  NETWORK,
  SECRET_KEY,
  SALT,
  WORMHOLE_ADDRESS,
  SPONSORED_FPC_ADDRESS,
};
