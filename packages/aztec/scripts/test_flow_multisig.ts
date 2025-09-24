import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { MultiSchnorrAccountContract } from "../src/artifacts/MultiSchnorrAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import fs from "fs";
import path from "path";

interface CrossChainConfig {
  DEPLOYED_ADDRESS: string;
  PRIV1: string;
  PRIV2: string;
  PRIV3: string;
  SECRET_KEY: string;
  SALT: string;
  ARBITRUM_CHAIN_ID: string;
  PORTAL_ADDRESS: string;
  WORMHOLE_EMITTER: string;
  THRESHOLD: string;
}

function loadConfig(): CrossChainConfig {
  const envPath = path.resolve(process.cwd(), ".env.crosschain");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env.crosschain file not found. Run deploy script first.");
  }
  
  const envContent = fs.readFileSync(envPath, "utf8");
  const config: any = {};
  
  envContent.split("\n").forEach(line => {
    if (line.includes("=") && !line.startsWith("#") && line.trim()) {
      const [key, value] = line.split("=");
      config[key.trim()] = value.trim();
    }
  });
  
  // Validate required fields
  const required = ['DEPLOYED_ADDRESS', 'PRIV1', 'SECRET_KEY', 'SALT', 'THRESHOLD'];
  for (const field of required) {
    if (!config[field]) {
      throw new Error(`Missing required config: ${field}`);
    }
  }
  
  return config as CrossChainConfig;
}

async function testBasicMultisig() {
  const logger = createLogger("test-basic-multisig");
  logger.info("Starting basic multisig function tests on Aztec...");

  // Step 1: Load configuration
  logger.info("Step 1: Loading configuration...");
  const config = loadConfig();
  logger.info(`Contract Address: ${config.DEPLOYED_ADDRESS}`);
  logger.info(`Threshold: ${config.THRESHOLD}`);

  // Step 2: Setup PXE connection
  logger.info("Step 2: Setting up PXE connection...");
  const pxe = await setupPXE();
  const nodeInfo = await pxe.getNodeInfo();
  logger.info(`Connected to Aztec node version: ${nodeInfo.nodeVersion}`);

  // Step 3: Setup wallet and contract instance
  logger.info("Step 3: Setting up wallet and contract...");
  const secretKey = Fr.fromString(config.SECRET_KEY);
  const salt = Fr.fromString(config.SALT);
  const priv1 = GrumpkinScalar.fromString(config.PRIV1);
  
  const signerAccount = await getSchnorrAccount(pxe, secretKey, priv1, salt);
  const wallet = await signerAccount.getWallet();
  const signerAddress = wallet.getAddress();
  
  logger.info(`Signer address: ${signerAddress.toString()}`);

  const contractAddress = AztecAddress.fromString(config.DEPLOYED_ADDRESS);
  const multisig = await MultiSchnorrAccountContract.at(contractAddress, wallet);
  
  // Step 4: Test view functions
  logger.info("Step 4: Testing view functions...");
  
  try {
    // Test threshold
    const threshold = await multisig.methods
      .get_threshold()
      .simulate({ from: signerAddress });
    logger.info(`✅ Threshold: ${threshold}`);
    
    if (threshold.toString() !== config.THRESHOLD) {
      logger.warn(`⚠️  Threshold mismatch: expected ${config.THRESHOLD}, got ${threshold}`);
    }

    // Test public keys
    logger.info("Testing public key retrieval...");
    for (let i = 1; i <= 3; i++) {
      const [pk_x, pk_y] = await multisig.methods
        .get_pk(i)
        .simulate({ from: signerAddress });
      
      logger.info(`✅ Signer ${i} public key:`);
      logger.info(`   X: ${pk_x.toString()}`);
      logger.info(`   Y: ${pk_y.toString()}`);
    }

    // Test cross-chain specific functions
    logger.info("Testing cross-chain view functions...");
    
    const crossChainNonce = await multisig.methods
      .get_cross_chain_nonce()
      .simulate({ from: signerAddress });
    logger.info(`✅ Cross-chain nonce: ${crossChainNonce}`);

    const portalAddress = await multisig.methods
      .get_portal_address()
      .simulate({ from: signerAddress });
    logger.info(`✅ Portal address: ${portalAddress.toString()}`);

    const wormholeEmitter = await multisig.methods
      .get_wormhole_emitter()
      .simulate({ from: signerAddress });
    logger.info(`✅ Wormhole emitter: ${wormholeEmitter.toString()}`);

  } catch (error) {
    logger.error("❌ View function test failed:", error);
    throw error;
  }

  // Step 5: Test approval functions (simulate only)
  logger.info("Step 5: Testing approval functions (simulation)...");
  
  try {
    // Test mock hash for approval simulation
    const mockTxHash = Fr.fromString("0x1234567890123456789012345678901234567890123456789012345678901234");
    
    // Test getting approval count for non-existent transaction
    const approvalCount = await multisig.methods
      .get_cross_chain_approval_count(mockTxHash)
      .simulate({ from: signerAddress });
    logger.info(`✅ Approval count for mock tx: ${approvalCount}`);

    // Test checking if signer has approved
    const hasApproved = await multisig.methods
      .has_approved_cross_chain(mockTxHash, 1)
      .simulate({ from: signerAddress });
    logger.info(`✅ Has signer 1 approved mock tx: ${hasApproved}`);

    // Test execution status
    const isExecuted = await multisig.methods
      .is_cross_chain_executed(mockTxHash)
      .simulate({ from: signerAddress });
    logger.info(`✅ Is mock tx executed: ${isExecuted}`);

  } catch (error) {
    logger.error("❌ Approval function test failed:", error);
    throw error;
  }

  // Step 6: Contract state summary
  logger.info("Step 6: Contract state summary...");
  
  const summary = {
    contractAddress: config.DEPLOYED_ADDRESS,
    threshold: await multisig.methods.get_threshold().simulate({ from: signerAddress }),
    crossChainNonce: await multisig.methods.get_cross_chain_nonce().simulate({ from: signerAddress }),
    portalAddress: (await multisig.methods.get_portal_address().simulate({ from: signerAddress })).toString(),
    wormholeEmitter: (await multisig.methods.get_wormhole_emitter().simulate({ from: signerAddress })).toString(),
  };
  
  logger.info("📊 Contract State Summary:");
  logger.info(`   Contract: ${summary.contractAddress}`);
  logger.info(`   Threshold: ${summary.threshold}`);
  logger.info(`   Cross-chain nonce: ${summary.crossChainNonce}`);
  logger.info(`   Portal: ${summary.portalAddress}`);
  logger.info(`   Wormhole: ${summary.wormholeEmitter}`);

  logger.info("✅ All basic multisig tests passed!");

  return {
    success: true,
    summary
  };
}

// Export for use in other scripts
export { testBasicMultisig, loadConfig };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testBasicMultisig()
    .then(() => {
      console.log("🎉 Basic multisig test completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Basic multisig test failed:", error);
      process.exit(1);
    });
}