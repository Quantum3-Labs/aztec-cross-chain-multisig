import { createPXEService, getPXEServiceConfig } from '@aztec/pxe/server';
import { createStore } from "@aztec/kv-store/lmdb";
import { createAztecNodeClient, waitForPXE } from '@aztec/aztec.js';

const { NODE_URL = 'https://aztec-alpha-testnet-fullnode.zkv.xyz' } = process.env;

export const setupPXE = async () => {
    console.log('Connecting to node:', NODE_URL);
    const node = createAztecNodeClient(NODE_URL);
    
    const l1Contracts = await node.getL1ContractAddresses();
    const config = getPXEServiceConfig();
    const fullConfig = { ...config, l1Contracts };
    fullConfig.proverEnabled = false;

    const store = await createStore('pxe', {
        dataDirectory: 'store',
        dataStoreMapSizeKB: 1e6,
    });

    const pxe = await createPXEService(node, fullConfig, {store});
    await waitForPXE(pxe);
    
    return pxe;
};