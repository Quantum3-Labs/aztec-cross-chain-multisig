// scripts/deploy_multisig.ts
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
    logger.info("🚀 DEPLOYING PrivateMultisig (Aztec v2.0.2) WITH WORMHOLE");
    logger.info("===============================================================================");

    // PXE
    const pxe = await setupPXE();
    await waitForPXE(pxe);
    logger.info("✓ Connected to PXE");

    // Sponsored FPC
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
    logger.info("✓ Registered SponsoredFPC");

    // Keys
    const secretKey = toFr(process.env.SECRET_KEY!);
    const salt = toFr(process.env.SALT!);
    const deployerPrivKey = toScalar(process.env.PRIV_DEPLOYER!);
    const signer1PrivKey = toScalar(process.env.PRIV1!);

    // Deployer account
    const deployerAcctMgr = await getSchnorrAccount(pxe, secretKey, deployerPrivKey, salt);
    await deployerAcctMgr.register();
    const deployerWallet = await deployerAcctMgr.getWallet();
    const deployerAddress = deployerAcctMgr.getAddress();
    logger.info(`✓ Deployer ready: ${deployerAddress.toString()}`);

    // Initial signer account + pubkey
    const signer1AcctMgr = await getSchnorrAccount(pxe, secretKey, signer1PrivKey, salt);
    await signer1AcctMgr.register();
    const signer1Wallet = await signer1AcctMgr.getWallet();
    const signer1Address = signer1AcctMgr.getAddress();
    const signer1Pub = await derivePublicKey(signer1PrivKey);
    const signer1PubX = Fr.fromString(signer1Pub.x.toString());
    const signer1PubY = Fr.fromString(signer1Pub.y.toString());
    logger.info(`✓ Initial signer: ${signer1Address.toString()}`);
    logger.info(`  PubKey X: ${signer1PubX.toString()}`);
    logger.info(`  PubKey Y: ${signer1PubY.toString()}`);

    // Wormhole address on Aztec
    const wormholeAddress = AztecAddress.fromString(process.env.WORMHOLE_ADDRESS!);
    logger.info(`✓ Wormhole core: ${wormholeAddress.toString()}`);

    const initialThreshold = Fr.fromString("1");

    // Deploy with private constructor
    logger.info("\n📦 Deploying PrivateMultisig (private constructor)...");
    const deployTx = PrivateMultisigContract.deploy(
      deployerWallet,
      signer1Address,
      signer1PubX,
      signer1PubY,
      initialThreshold
    ).send({ from: deployerAddress, fee });

    logger.info("⏳ Waiting for deployment transaction...");
    const receipt = await deployTx.wait({ timeout: 300_000 });
    logger.info(`✓ Tx mined: ${receipt.txHash}`);

    const contract = await deployTx.deployed({ timeout: 180_000 });
    const multisigAddress = contract.address;
    logger.info(`✅ Contract deployed at ${multisigAddress.toString()}`);

    // Register with PXE
    logger.info("\n⏳ Waiting for PXE instance...");
    const multisigInstance = await waitInstance(pxe, multisigAddress, "PrivateMultisig");
    await pxe.registerContract({ instance: multisigInstance, artifact: PrivateMultisigContract.artifact });
    logger.info("✓ Multisig registered with PXE");

    // Verify public state (constructor enqueues initialization)
    logger.info("\n🔍 Verifying public state...");
    await sleep(4000);
    const withDeployer = contract.withWallet(deployerWallet);
    let thresholdVal = await withDeployer.methods.get_threshold().simulate({ from: deployerAddress });
    let signerCountVal = await withDeployer.methods.get_signer_count().simulate({ from: deployerAddress });

    if (thresholdVal.toString() === "0" || signerCountVal.toString() === "0") {
      logger.info("Public state not initialized yet. Initializing now...");
      await withDeployer.methods
        .initialize_public_state(initialThreshold, Fr.fromString("1"))
        .send({ from: deployerAddress, fee })
        .wait({ timeout: 300_000 });
      await withDeployer.methods
        ._initialize_signer_status(signer1Address)
        .send({ from: deployerAddress, fee })
        .wait({ timeout: 300_000 });

      thresholdVal = await withDeployer.methods.get_threshold().simulate({ from: deployerAddress });
      signerCountVal = await withDeployer.methods.get_signer_count().simulate({ from: deployerAddress });
    }

    logger.info(`  Threshold: ${thresholdVal.toString()}`);
    logger.info(`  Signer Count: ${signerCountVal.toString()}`);

    // (Optional) prove who is signer for sanity
    const isDeployerSigner = await withDeployer.methods.is_signer_public(deployerAddress).simulate({ from: deployerAddress });
    const isSigner1Signer = await withDeployer.methods.is_signer_public(signer1Address).simulate({ from: deployerAddress });
    logger.info(`  isDeployerSigner=${isDeployerSigner}, isSigner1Signer=${isSigner1Signer}`);

    // Set Wormhole address: MUST be called by a signer (signer1)
    logger.info("\n🔧 Setting Wormhole address on contract (by signer1)...");
    await contract
      .withWallet(signer1Wallet)
      .methods
      .set_wormhole_address(wormholeAddress)
      .send({ from: signer1Address, fee })
      .wait({ timeout: 300_000 });
    logger.info("✓ Wormhole address set");

    // Read nonce
    const nonceVal = await withDeployer.methods.get_cross_chain_nonce().simulate({ from: deployerAddress });
    logger.info(`  Cross-chain nonce: ${nonceVal.toString()}`);

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
    logger.info(`Initial Signer:  ${signer1Address.toString()}`);
    logger.info(`Initial Threshold: ${initialThreshold.toString()}`);
    logger.info(`Wormhole Address: ${wormholeAddress.toString()}`);
    logger.info("===============================================================================");
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
