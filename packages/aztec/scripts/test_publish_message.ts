import 'dotenv/config';
import { Fr } from '@aztec/aztec.js';
import { getCustomWallet } from '../src/accounts/get_custom_wallet.js';
import { MyCustomAccountContract } from '../src/artifacts/MyCustomAccount.js';
import { IntentBuilder } from '../src/types/cross-chain-intent.js';

async function testPublishMessage() {
    try {
        console.log('🚀 Setting up wallet...');
        const { wallet, pxe } = await getCustomWallet();
        
        const accountAddress = wallet.getAddress();
        console.log('📍 Account address:', accountAddress.toString());
        
        console.log('📝 Getting contract instance...');
        const accountContract = await MyCustomAccountContract.at(accountAddress, wallet);
        
        const intent = IntentBuilder.createSimpleIntent(
            1,
            '0x0000000000000000000000000000000000000000',
            'Hello from Aztec'
        );
        
        console.log('📤 Publishing message...');
        console.log('Intent:', intent);
        
        const tx = await accountContract.methods.publish_message_in_private(
            new Fr(intent.targetChain),
            Fr.fromString(intent.targetAddress),
            intent.messageHash
        ).send();
        
        console.log('⏳ Waiting for transaction...');
        const receipt = await tx.wait();
        
        console.log('✅ Message published!');
        console.log('Transaction hash:', receipt.txHash.toString());
    } catch (error : any) {
        console.error('❌ Failed:', error);
        if (error.message) {
            console.error('Error message:', error.message);
        }
    }
}

testPublishMessage().catch(console.error);