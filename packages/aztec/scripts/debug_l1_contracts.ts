import "dotenv/config";
import { createAztecNodeClient } from '@aztec/aztec.js';

const { NODE_URL = 'https://aztec-alpha-testnet-fullnode.zkv.xyz' } = process.env;

async function debugL1Contracts() {
    console.log('Connecting to node:', NODE_URL);
    const node = createAztecNodeClient(NODE_URL);
    
    const l1Contracts = await node.getL1ContractAddresses();
    console.log('L1 Contracts:', JSON.stringify(l1Contracts, null, 2));
}

debugL1Contracts().catch(console.error);
