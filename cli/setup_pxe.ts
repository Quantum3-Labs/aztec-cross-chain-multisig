import { createPXEService, getPXEServiceConfig } from "@aztec/pxe/server";
import { createAztecNodeClient, waitForPXE } from "@aztec/aztec.js";
import { createStore } from "@aztec/kv-store/lmdb";
import { NODE_URL } from "./constants";

const node = createAztecNodeClient(NODE_URL);
const l1Contracts = await node.getL1ContractAddresses();
const config = getPXEServiceConfig();
const fullConfig = { ...config, l1Contracts };
fullConfig.proverEnabled = false;

export async function setupPXE() {
  const store = await createStore("pxe", {
    dataDirectory: "store",
    dataStoreMapSizeKB: 1e6,
  });
  const pxe = await createPXEService(node, fullConfig, { store });
  await waitForPXE(pxe);
  return { pxe, store };
}
