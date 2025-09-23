import { createPXEService, getPXEServiceConfig } from "@aztec/pxe/server";
import { createAztecNodeClient, waitForPXE } from "@aztec/aztec.js";
import { createStore } from "@aztec/kv-store/lmdb";

const { NODE_URL = "https://aztec-testnet-fullnode.zkv.xyz" } = process.env;

const storeCache = new Map<string, Awaited<ReturnType<typeof createStore>>>();

async function getStore(label: string) {
  if (!storeCache.has(label)) {
    const store = await createStore(label, {
      dataDirectory: "store",
      dataStoreMapSizeKB: 1e6,
    });
    storeCache.set(label, store);
  }
  return storeCache.get(label)!;
}

export async function setupPXE(storeLabel = "pxe") {
  const node = createAztecNodeClient(NODE_URL);
  await node.getNodeInfo();
  const l1Contracts = await node.getL1ContractAddresses();
  const config = getPXEServiceConfig();
  const fullConfig = { ...config, l1Contracts, proverEnabled: true };
  const store = await getStore(storeLabel);
  const pxe = await createPXEService(node, fullConfig, { store });
  await waitForPXE(pxe);
  return pxe;
}
