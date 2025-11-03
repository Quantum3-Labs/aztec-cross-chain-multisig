import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getPXEConfig } from "@aztec/pxe/config";
import { createStore } from "@aztec/kv-store/lmdb";
import { NODE_URL } from "./constants";
import { TestWallet } from "@aztec/test-wallet/server";

const node = createAztecNodeClient(NODE_URL);
const l1Contracts = await node.getL1ContractAddresses();
const config = getPXEConfig();
const fullConfig = { ...config, l1Contracts };
fullConfig.proverEnabled = false;

export async function setupPXE() {
  const store = await createStore("pxe", {
    dataDirectory: "store",
    dataStoreMapSizeKb: 1e6,
  });
  const wallet = await TestWallet.create(node, fullConfig, {
    store,
  });

  return { wallet, store };
}
