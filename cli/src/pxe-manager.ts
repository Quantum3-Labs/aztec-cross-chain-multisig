import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getPXEConfig } from "@aztec/pxe/config";
import { createStore } from "@aztec/kv-store/lmdb";
import { NODE_URL } from "../constants";
import { TestWallet } from "@aztec/test-wallet/server";
import { Signer } from "./signer-manager";

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
 * Setup PXE for a specific signer with their own isolated data directory
 * Each signer gets their own PXE instance with separate local state
 */
export async function setupPXEForSigner(signer: Signer | string) {
  const signerName = typeof signer === "string" ? signer : signer.name;
  const normalizedName = signerName.replace(/\s+/g, "-").toLowerCase();

  const fullConfig = await getConfig();

  // Use signer-specific data directory
  const store = await createStore(`pxe-${normalizedName}`, {
    dataDirectory: `store/${normalizedName}`,
    dataStoreMapSizeKb: 1e6,
  });

  const wallet = await TestWallet.create(node, fullConfig, {
    store,
  });

  return { wallet, store };
}

/**
 * Setup PXE for shared state account (used during multisig creation)
 * This is a temporary PXE instance for the creator
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
