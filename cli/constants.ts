enum NetworkType {
  TESTNET = "testnet",
  DEVNET = "devnet",
}

const NETWORK = process.env.NETWORK || NetworkType.DEVNET;
// const NODE_URL = "https://devnet.aztec-labs.com";
const NODE_URL = "http://localhost:8080";
const SECRET_KEY = process.env.SECRET_KEY || "0x111";
const SALT = process.env.SALT || "0x222";
const WORMHOLE_ADDRESS =
  process.env.WORMHOLE_ADDRESS_AZTEC ||
  "0x2f56338d0bf01e37b89edea0ee8e96474c89575aa5e6f35012789738a06ed0ac";
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
