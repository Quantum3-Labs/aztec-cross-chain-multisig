import { AztecAddress, Fr, createLogger, EthAddress } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { MultiSchnorrAccountContract } from "../src/artifacts/MultiSchnorrAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import fs from "fs";
import path from "path";
import { Buffer } from "buffer";

// Cross-chain configuration
const CROSS_CHAIN_CONFIG = {
  // Arbitrum testnet chain ID
  ARBITRUM_CHAIN_ID: 421614,
  
  // Placeholder addresses - replace with actual deployed contracts
  PORTAL_ADDRESS: "0x1234567890123456789012345678901234567890",
  WORMHOLE_EMITTER: "0x0E082F06FF657D94310cB8cE8B0D9a04541d8052", // Arbitrum Wormhole Core
  
  // Multisig threshold (2-of-3)
  THRESHOLD: 2,
};

async function main() {
  const logger = createLogger("crosschain-multisig");
  const pxe = await setupPXE();

  // Setup sponsored fee payment
  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });
  const fee = {
    paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
  };

  logger.info("🚀 Starting Cross-Chain MultisigAccount deployment...");

  // Generate multisig keys
  const grumpkin = new Grumpkin();

  const priv1 = GrumpkinScalar.random();
  const priv2 = GrumpkinScalar.random();
  const priv3 = GrumpkinScalar.random();

  const pub1 = await grumpkin.mul(grumpkin.generator(), priv1);
  const pub2 = await grumpkin.mul(grumpkin.generator(), priv2);
  const pub3 = await grumpkin.mul(grumpkin.generator(), priv3);

  logger.info("🔑 Generated multisig keys:");
  logger.info(`  Priv1: ${priv1.toString()}`);
  logger.info(`  Priv2: ${priv2.toString()}`);
  logger.info(`  Priv3: ${priv3.toString()}`);
  logger.info(`  Pub1: (${pub1.x.toString()}, ${pub1.y.toString()})`);
  logger.info(`  Pub2: (${pub2.x.toString()}, ${pub2.y.toString()})`);
  logger.info(`  Pub3: (${pub3.x.toString()}, ${pub3.y.toString()})`);

  // Deploy base account for deployment
  const secretKey = Fr.random();
  const salt = Fr.random();

  logger.info("📦 Deploying base SchnorrAccount...");
  const acctMgr = await getSchnorrAccount(pxe, secretKey, priv1, salt);
  await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
  const ownerWallet = await acctMgr.getWallet();
  const owner: AztecAddress = ownerWallet.getAddress();

  logger.info(`✅ Base SchnorrAccount deployed: ${owner.toString()}`);

  // Prepare cross-chain addresses
  const portalAddress = new EthAddress(Buffer.from(CROSS_CHAIN_CONFIG.PORTAL_ADDRESS.slice(2), 'hex'));
  const wormholeEmitter = new EthAddress(Buffer.from(CROSS_CHAIN_CONFIG.WORMHOLE_EMITTER.slice(2), 'hex'));

  logger.info("🌉 Cross-chain configuration:");
  logger.info(`  Target Chain ID: ${CROSS_CHAIN_CONFIG.ARBITRUM_CHAIN_ID}`);
  logger.info(`  Portal Address: ${portalAddress.toString()}`);
  logger.info(`  Wormhole Emitter: ${wormholeEmitter.toString()}`);
  logger.info(`  Threshold: ${CROSS_CHAIN_CONFIG.THRESHOLD}-of-3`);

  // Deploy cross-chain multisig contract
  logger.info("🔨 Deploying Cross-Chain MultiSchnorrAccount...");
  const deployMethod = MultiSchnorrAccountContract.deploy(
    ownerWallet,
    pub1.x, pub1.y,
    pub2.x, pub2.y,
    pub3.x, pub3.y,
    CROSS_CHAIN_CONFIG.THRESHOLD,
    portalAddress,
    wormholeEmitter
  );

  const sent = deployMethod.send({ from: owner, fee });
  const receipt = await sent.wait({ timeout: 180000 });

  const deployedAddress = receipt.contract.address as AztecAddress;
  const multisig = await MultiSchnorrAccountContract.at(
    deployedAddress,
    ownerWallet
  );

  logger.info("🎉 Deployment successful!");
  logger.info(`📍 MultiSchnorrAccount address: ${deployedAddress.toString()}`);
  logger.info(`📝 Transaction hash: ${receipt.txHash}`);

  // Verify deployment by calling view functions
  logger.info("🔍 Verifying deployment...");
  try {
    const threshold = await multisig.methods.get_threshold().simulate({ from: owner });
    const [pk1_x, pk1_y] = await multisig.methods.get_pk(1).simulate({ from: owner });
    const [pk2_x, pk2_y] = await multisig.methods.get_pk(2).simulate({ from: owner });
    const [pk3_x, pk3_y] = await multisig.methods.get_pk(3).simulate({ from: owner });
    const nonce = await multisig.methods.get_cross_chain_nonce().simulate({ from: owner });
    const portal = await multisig.methods.get_portal_address().simulate({ from: owner });
    const wormhole = await multisig.methods.get_wormhole_emitter().simulate({ from: owner });

    logger.info("✅ Contract verification:");
    logger.info(`  Threshold: ${threshold}`);
    logger.info(`  Signer 1: (${pk1_x.toString()}, ${pk1_y.toString()})`);
    logger.info(`  Signer 2: (${pk2_x.toString()}, ${pk2_y.toString()})`);
    logger.info(`  Signer 3: (${pk3_x.toString()}, ${pk3_y.toString()})`);
    logger.info(`  Cross-chain nonce: ${nonce}`);
    logger.info(`  Portal: ${portal.toString()}`);
    logger.info(`  Wormhole emitter: ${wormhole.toString()}`);
    
    // Verify keys match (compare string representations)
    const keysMatch = 
      pk1_x.toString() === pub1.x.toString() && pk1_y.toString() === pub1.y.toString() &&
      pk2_x.toString() === pub2.x.toString() && pk2_y.toString() === pub2.y.toString() &&
      pk3_x.toString() === pub3.x.toString() && pk3_y.toString() === pub3.y.toString();
    
    if (keysMatch) {
      logger.info("✅ Public keys verification passed");
    } else {
      logger.warn("⚠️ Public keys mismatch detected");
    }
  } catch (error) {
    logger.error("❌ Contract verification failed:", error);
  }

  // Save deployment configuration
  const envFile = path.resolve(process.cwd(), ".env.crosschain");
  const envData = [
    `# Cross-Chain MultiSchnorrAccount Deployment`,
    `DEPLOYED_ADDRESS=${deployedAddress.toString()}`,
    `BASE_ACCOUNT=${owner.toString()}`,
    ``,
    `# Multisig Keys`,
    `PRIV1=${priv1.toString()}`,
    `PRIV2=${priv2.toString()}`,
    `PRIV3=${priv3.toString()}`,
    ``,
    `# Account Setup`,
    `SECRET_KEY=${secretKey.toString()}`,
    `SALT=${salt.toString()}`,
    ``,
    `# Cross-Chain Config`,
    `ARBITRUM_CHAIN_ID=${CROSS_CHAIN_CONFIG.ARBITRUM_CHAIN_ID}`,
    `PORTAL_ADDRESS=${CROSS_CHAIN_CONFIG.PORTAL_ADDRESS}`,
    `WORMHOLE_EMITTER=${CROSS_CHAIN_CONFIG.WORMHOLE_EMITTER}`,
    `THRESHOLD=${CROSS_CHAIN_CONFIG.THRESHOLD}`,
    ``,
    `# Transaction Details`,
    `DEPLOY_TX_HASH=${receipt.txHash}`,
    `DEPLOY_TIMESTAMP=${new Date().toISOString()}`,
  ].join("\n");

  fs.writeFileSync(envFile, envData);
  logger.info(`💾 Configuration saved to ${envFile}`);

  // Print deployment summary
  logger.info("\n📊 DEPLOYMENT SUMMARY");
  logger.info("=" .repeat(50));
  logger.info(`Contract Address: ${deployedAddress.toString()}`);
  logger.info(`Base Account: ${owner.toString()}`);
  logger.info(`Network: Aztec Testnet`);
  logger.info(`Threshold: ${CROSS_CHAIN_CONFIG.THRESHOLD}-of-3 multisig`);
  logger.info(`Cross-chain target: Arbitrum (${CROSS_CHAIN_CONFIG.ARBITRUM_CHAIN_ID})`);
  logger.info(`Portal: ${portalAddress.toString()}`);
  logger.info(`Wormhole: ${wormholeEmitter.toString()}`);
  logger.info(`Deploy TX: ${receipt.txHash}`);
  logger.info("=" .repeat(50));

  logger.info("\n📖 Next Steps:");
  logger.info("1. Deploy corresponding Arbitrum contract");
  logger.info("2. Configure Portal bridge connection");
  logger.info("3. Test cross-chain message flow");
  logger.info("4. Setup monitoring for cross-chain transactions");

  return multisig;
}

main().catch((err) => {
  console.error("❌ Deployment failed:", err);
  process.exit(1);
});