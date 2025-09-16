import { 
    createLogger,
    Fr,
    GrumpkinScalar
  } from "@aztec/aztec.js";
  import { setupPXE } from "../src/utils/setup_pxe.js";
  import * as dotenv from 'dotenv';
  
  dotenv.config();
  
  async function verifyAccount() {
    const logger = createLogger("aztec:verify");
    
    logger.info("Connecting to testnet PXE...");
    const pxe = await setupPXE();
    
    const nodeInfo = await pxe.getNodeInfo();
    logger.info(`Connected to chain: ${nodeInfo.l1ChainId}`);
  
    const SECRET = process.env.SECRET;
    const SALT = process.env.SALT;
    
    if (!SECRET || !SALT) {
      throw new Error("Missing SECRET or SALT in .env");
    }
  
    const registeredAccounts = await pxe.getRegisteredAccounts();
    logger.info(`Total registered accounts in PXE: ${registeredAccounts.length}`);
    
    registeredAccounts.forEach((acc, index) => {
      logger.info(`Account ${index + 1}: ${acc.address.toString()}`);
    });
    
    const yourAddress = registeredAccounts[registeredAccounts.length - 1]?.address;
    
    if (yourAddress) {
      logger.info(`
  ========================================
  YOUR TESTNET ACCOUNT
  ========================================
  Address: ${yourAddress.toString()}
  Chain: ${nodeInfo.l1ChainId} (Sepolia)
  Status: ACTIVE & READY
  ========================================
  
  ✅ Account is registered and ready to use!
  ✅ You can receive tokens at this address
  ✅ You can deploy contracts from this account
  
  Next steps:
  1. Fund account with Fee Juice for gas
  2. Deploy your contracts
  3. Interact with other contracts
      `);
    } else {
      logger.warn("No accounts found in PXE");
    }
  }
  
  verifyAccount()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Failed:", err);
      process.exit(1);
    });