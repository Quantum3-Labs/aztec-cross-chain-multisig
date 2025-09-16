import 'dotenv/config';
import { setupPXE } from '../src/utils/setup_pxe.js';

async function testPXE() {
    console.log('Starting PXE setup...');
    try {
        const pxe = await setupPXE();
        console.log('PXE setup complete!');
        
        const nodeInfo = await pxe.getNodeInfo();
        console.log('Connected to chain:', nodeInfo.l1ChainId);
        console.log('Protocol version:', nodeInfo.protocolContractAddresses);
    } catch (error) {
        console.error('Error setting up PXE:', error);
    }
}

testPXE().catch(console.error);