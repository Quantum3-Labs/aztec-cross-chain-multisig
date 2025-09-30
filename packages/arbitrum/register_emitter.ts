import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

async function registerEmitter() {
  const requiredEnvVars = [
    'PRIVATE_KEY',
    'ARBITRUM_RPC',
    'ARBITRUM_VAULT_ADDRESS',
    'AZTEC_CHAIN_ID',
    'AZTEC_ACCOUNT_ADDRESS'
  ];

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }

  const provider = new ethers.providers.JsonRpcProvider(process.env.ARBITRUM_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  console.log('Using wallet:', wallet.address);
  const abi = [
    'function registerEmitter(uint16 chainId_, bytes32 emitterAddress_) external'
  ];
  
  const vault = new ethers.Contract(
    process.env.ARBITRUM_VAULT_ADDRESS!,
    abi,
    wallet
  );
  
  const aztecChainId = parseInt(process.env.AZTEC_CHAIN_ID!);
  const aztecAccount = process.env.AZTEC_ACCOUNT_ADDRESS!;
  
  console.log('Registering Aztec emitter...');
  console.log('Chain ID:', aztecChainId);
  console.log('Emitter:', aztecAccount);
  
  const tx = await vault.registerEmitter(aztecChainId, aztecAccount);
  console.log('Transaction hash:', tx.hash);
  
  const receipt = await tx.wait();
  console.log('Confirmed in block:', receipt.blockNumber);
  console.log('✅ Emitter registered successfully!');
}

registerEmitter().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});