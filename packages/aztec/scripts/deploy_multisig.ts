import "dotenv/config";
import fs from "fs";
import path from "path";
import { Fr, AztecAddress, createLogger, waitForPXE } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar, Point } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function derivePublicKey(privateKey: GrumpkinScalar): Promise<Point> {
  const grumpkin = new Grumpkin();
  return grumpkin.mul(grumpkin.generator(), privateKey);
}

function pointToFr(p: Point): { x: Fr; y: Fr } {
  return { x: Fr.fromString(p.x.toString()), y: Fr.fromString(p.y.toString()) };
}

async function waitInstance(pxe: any, addr: AztecAddress, label: string) {
  let inst = await pxe.getContractInstance(addr);
  for (let i = 0; i < 20 && !inst; i++) {
    await sleep(1000);
    inst = await pxe.getContractInstance(addr);
  }
  if (!inst) throw new Error(`PXE did not expose instance for ${label} @ ${addr.toString()}`);
  return inst;
}

async function main() {
  const logger = createLogger("deploy:PrivateMultisig");

  try {
    logger.info("===============================================================================");
    logger.info("🚀 DEPLOYING HYBRID MULTISIG CONTRACT (Aztec v2.0.2)");
    logger.info("===============================================================================");

    const pxe = await setupPXE();
    await waitForPXE(pxe);
    logger.info("✓ Connected to PXE");

    // Sponsored FPC (fee sponsor)
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
    logger.info("✓ Registered SponsoredFPC");

    // Deployer account
    const secretKey = toFr(process.env.SECRET_KEY!);
    const salt = toFr(process.env.SALT!);
    const deployerPrivKey = toScalar(process.env.PRIV_DEPLOYER!);

    logger.info("📝 Setting up deployer account...");
    const deployerAcctMgr = await getSchnorrAccount(pxe, secretKey, deployerPrivKey, salt);
    await deployerAcctMgr.register();
    const deployerWallet = await deployerAcctMgr.getWallet();
    const deployerAddress = deployerAcctMgr.getAddress();
    logger.info(`✓ Deployer ready: ${deployerAddress.toString()}`);

    // Initial signer account
    const signer1PrivKey = toScalar(process.env.PRIV1!);
    const signer1PubPoint = await derivePublicKey(signer1PrivKey);
    const signer1Pub = pointToFr(signer1PubPoint);

    logger.info("📝 Setting up initial signer account...");
    const signer1AcctMgr = await getSchnorrAccount(pxe, secretKey, signer1PrivKey, salt);
    await signer1AcctMgr.register();
    const signer1Wallet = await signer1AcctMgr.getWallet();
    const signer1Address = signer1AcctMgr.getAddress();
    logger.info(`✓ Initial Signer ready: ${signer1Address.toString()}`);
    logger.info(`  Public Key X: ${signer1Pub.x.toString()}`);
    logger.info(`  Public Key Y: ${signer1Pub.y.toString()}`);

    // Wormhole address
    const wormholeAddress = AztecAddress.fromString(process.env.WORMHOLE_ADDRESS!);
    logger.info(`✓ Wormhole: ${wormholeAddress.toString()}`);

    const initialThreshold = Fr.fromString("1");
    logger.info(`✓ Initial Threshold: ${initialThreshold.toString()}`);

    // ========================================================================
    // STEP 1: Deploy contract (constructor enqueues initialize_public)
    // ========================================================================
    logger.info("\n📦 Deploying PrivateMultisig...");
    logger.info("This may take several minutes for proof generation...");
    
    const deployTx = PrivateMultisigContract.deploy(
      deployerWallet,
      signer1Address,
      signer1Pub.x,
      signer1Pub.y,
      initialThreshold,
      wormholeAddress
    ).send({ from: deployerAddress, fee });

    logger.info("⏳ Waiting for deployment transaction...");
    const receipt = await deployTx.wait({ timeout: 300_000 });
    logger.info(`✓ Tx mined: ${receipt.txHash}`);

    const contract = await deployTx.deployed({ timeout: 180_000 });
    const multisigAddress = contract.address;
    logger.info(`✅ Contract deployed at ${multisigAddress.toString()}`);

    // Wait PXE instance & register artifact
    logger.info("\n⏳ Waiting for multisig instance in PXE...");
    const multisigInstance = await waitInstance(pxe, multisigAddress, "PrivateMultisig");
    await pxe.registerContract({ instance: multisigInstance, artifact: PrivateMultisigContract.artifact });
    logger.info("✓ Multisig registered with PXE");

    // ========================================================================
    // STEP 2: MANUALLY call initialize_public (enqueued call didn't execute)
    // ========================================================================
    logger.info("\n📦 Manually initializing public state...");
    
    try {
      const initTx = await contract.withWallet(deployerWallet).methods
        .initialize_public(signer1Address, initialThreshold)
        .send({ from: deployerAddress, fee })
        .wait({ timeout: 300_000 });
      
      logger.info(`✓ Public state initialized: ${initTx.txHash}`);
    } catch (err: any) {
      if (err.message && err.message.includes("Already initialized")) {
        logger.info("✓ Public state already initialized by constructor");
      } else {
        throw err;
      }
    }

    // ========================================================================
    // STEP 3: Verify state
    // ========================================================================
    logger.info("\n🔍 Verifying contract state...");
    logger.info("⏳ Waiting for state sync (30s)...");
    await sleep(30_000);
    
    try {
      const withDeployer = contract.withWallet(deployerWallet);

      const thresholdVal = await withDeployer.methods.get_threshold().simulate({ from: deployerAddress });
      const signerCountVal = await withDeployer.methods.get_signer_count().simulate({ from: deployerAddress });
      const isSignerVal = await withDeployer.methods.is_signer(signer1Address).simulate({ from: deployerAddress });
      const nonceVal = await withDeployer.methods.get_cross_chain_nonce().simulate({ from: deployerAddress });

      logger.info(`  Threshold: ${thresholdVal.toString()}`);
      logger.info(`  Signer Count: ${signerCountVal.toString()}`);
      logger.info(`  Signer1 active: ${isSignerVal.toString()}`);
      logger.info(`  Cross-chain nonce: ${nonceVal.toString()}`);

      if (thresholdVal.toString() === "1" && signerCountVal.toString() === "1" && isSignerVal) {
        logger.info("✅ Public state initialized correctly!");
      } else {
        logger.warn("⚠️  Public state values unexpected - wait another minute and verify with: npm run info");
      }
    } catch (err: any) {
      logger.warn("⚠️  Could not verify state immediately (this is normal)");
      logger.warn(`   Error: ${err.message}`);
      logger.warn("   Wait 1-2 minutes and verify with: npm run info");
    }

    // Update .env
    logger.info("\n💾 Updating .env file...");
    const envFile = path.resolve(process.cwd(), ".env");
    const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/) : [];
    const idx: Record<string, number> = {};
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) idx[m[1]] = i;
    }
    const set = (k: string, v: string) => {
      if (idx[k] !== undefined) lines[idx[k]] = `${k}=${v}`;
      else lines.push(`${k}=${v}`);
    };
    set("PRIVATE_MULTISIG_ADDRESS", multisigAddress.toString());
    set("DEPLOYER_ADDRESS", deployerAddress.toString());
    set("SIGNER1_ADDRESS", signer1Address.toString());
    set("DEPLOY_TIMESTAMP", new Date().toISOString());
    fs.writeFileSync(envFile, lines.join("\n"));
    logger.info("✓ .env updated");

    logger.info("\n===============================================================================");
    logger.info("✅ DEPLOYMENT COMPLETE");
    logger.info("===============================================================================");
    logger.info(`Contract Address: ${multisigAddress.toString()}`);
    logger.info(`Deployer Address: ${deployerAddress.toString()}`);
    logger.info(`Initial Signer: ${signer1Address.toString()}`);
    logger.info(`Initial Threshold: ${initialThreshold.toString()}`);
    logger.info(`Wormhole Address: ${wormholeAddress.toString()}`);
    logger.info("===============================================================================");
    
    logger.info("\n📝 Next steps:");
    logger.info("1. Wait 1-2 minutes for PXE to fully sync notes");
    logger.info("2. Verify state: npm run info");
    logger.info("3. Add signer: npx tsx cli/index.ts add-signer --new-signer 2");
    logger.info("\n⚠️  NOTE: If 'npm run info' shows incorrect values, wait another minute and retry.");

  } catch (err) {
    console.error("\n❌ DEPLOYMENT FAILED");
    console.error("===============================================================================");
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`);
      if (err.stack) {
        console.error("\nStack trace:");
        console.error(err.stack);
      }
    } else {
      console.error(err);
    }
    console.error("===============================================================================");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ UNHANDLED ERROR");
  console.error("===============================================================================");
  console.error(err);
  console.error("===============================================================================");
  process.exit(1);
});