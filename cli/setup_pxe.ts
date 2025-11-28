import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getPXEConfig } from "@aztec/pxe/config";
import { createStore } from "@aztec/kv-store/lmdb";
import { NODE_URL } from "./constants";
import { TestWallet } from "@aztec/test-wallet/server";

const node = createAztecNodeClient(NODE_URL);
let l1Contracts: any = null;
let config: any = null;

async function getConfig() {
  if (!l1Contracts) {
    l1Contracts = await node.getL1ContractAddresses();
  }
  if (!config) {
    config = getPXEConfig();
    const fullConfig = { ...config, l1Contracts };
    fullConfig.proverEnabled = false;
    return fullConfig;
  }
  return { ...config, l1Contracts, proverEnabled: false };
}

/**
 * Setup default shared PXE (for backward compatibility)
 * For signer-specific PXE, use setupPXEForSigner from pxe-manager
 */
export async function setupPXE() {
  const fullConfig = await getConfig();

  const store = await createStore("pxe", {
    dataDirectory: "store",
    dataStoreMapSizeKb: 1e6,
  });
  const wallet = await TestWallet.create(node, fullConfig, {
    store,
  });

  return { wallet, store };
}
