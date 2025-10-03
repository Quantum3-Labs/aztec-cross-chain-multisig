import "dotenv/config";
import fs from "fs";
import path from "path";
import { Fr, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar, Point } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) =>
  GrumpkinScalar.fromString(BigInt(hex).toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function derivePublicKey(privateKey: GrumpkinScalar): Promise<Point> {
  const grumpkin = new Grumpkin();
  return grumpkin.mul(grumpkin.generator(), privateKey);
}

async function main() {
  const logger = createLogger("deploy-multisig");

  try {
    logger.info("=".repeat(80));
    logger.info("DEPLOYING PRIVATEMULTISIG TO AZTEC");
    logger.info("=".repeat(80) + "\n");

    logger.info("Connecting to Aztec...");
    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    });
    const fee = {
      paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
    };
    logger.info("✓ Connected\n");

    logger.info("Setting up deployer account...");
    const secretKey = toFr(process.env.SECRET_KEY!);
    const salt = toFr(process.env.SALT!);
    const deployerPrivKey = toScalar(process.env.PRIV_DEPLOYER!);

    const deployerAcctMgr = await getSchnorrAccount(
      pxe,
      secretKey,
      deployerPrivKey,
      salt
    );
    const deployerAddress = deployerAcctMgr.getAddress();
    logger.info(`Deployer: ${deployerAddress.toString()}`);

    const existingAccount = await pxe.getContractInstance(deployerAddress);
    if (!existingAccount) {
      logger.info("Deploying deployer account...");
      await (await deployerAcctMgr.deploy({ fee })).wait({ timeout: 180000 });
      logger.info("✓ Account deployed");
    } else {
      logger.info("✓ Deployer account exists");
    }

    try {
      await deployerAcctMgr.register();
      logger.info("✓ Registered with PXE");
    } catch {
      logger.info("✓ Already registered");
    }

    const deployerWallet = await deployerAcctMgr.getWallet();
    logger.info("✓ Deployer ready\n");

    logger.info("=".repeat(80));
    logger.info("PREPARING INITIAL SIGNER (SIGNER 1)");
    logger.info("=".repeat(80));

    const signer1PrivKey = toScalar(process.env.PRIV1!);
    const signer1PubKey = await derivePublicKey(signer1PrivKey);
    const signer1AcctMgr = await getSchnorrAccount(
      pxe,
      secretKey,
      signer1PrivKey,
      salt
    );
    const signer1Address = signer1AcctMgr.getAddress();

    const existingSigner1 = await pxe.getContractInstance(signer1Address);
    if (!existingSigner1) {
      logger.error("❌ Signer 1 not deployed!");
      logger.error("Please run: yarn deploy-accounts");
      throw new Error("Signer 1 must be deployed first");
    }

    try {
      await signer1AcctMgr.register();
      logger.info("✓ Signer 1 registered with PXE");
    } catch {
      logger.info("✓ Signer 1 already registered");
    }

    logger.info(`Signer 1 address: ${signer1Address.toString()}`);
    logger.info(`Signer 1 pubkey X: ${signer1PubKey.x.toString()}`);
    logger.info(`Signer 1 pubkey Y: ${signer1PubKey.y.toString()}`);
    logger.info(`Initial threshold: 1\n`);

    logger.info("=".repeat(80));
    logger.info("DEPLOYING PRIVATEMULTISIG CONTRACT");
    logger.info("=".repeat(80));

    logger.info("Deploying contract...");
    const deployTx = PrivateMultisigContract.deploy(
      deployerWallet,
      signer1Address,
      signer1PubKey.x,
      signer1PubKey.y,
      Fr.fromString("1")
    ).send({ from: deployerAddress, fee });

    const contract = await deployTx.deployed({ timeout: 180000 });
    const multisigAddress = contract.address;

    logger.info("✓ Contract deployed");
    logger.info("Waiting for deployment to finalize (5s)...");
    await sleep(5000);

    logger.info("=".repeat(80));
    logger.info("INITIALIZING PUBLIC STATE");
    logger.info("=".repeat(80));

    logger.info("Calling initialize_public_state...");
    await contract.methods
      .initialize_public_state(Fr.fromString("1"), Fr.fromString("1"))
      .send({ from: deployerAddress, fee })
      .wait({ timeout: 180000 });

    logger.info("Calling _initialize_signer_status...");
    await contract.methods
      ._initialize_signer_status(signer1Address)
      .send({ from: deployerAddress, fee })
      .wait({ timeout: 180000 });

    logger.info("✓ Public state initialized");
    logger.info("Waiting for sync (5s)...");
    await sleep(5000);

    logger.info("=".repeat(80));
    logger.info("VERIFYING DEPLOYMENT");
    logger.info("=".repeat(80));

    const threshold = await contract.methods
      .get_threshold()
      .simulate({ from: deployerAddress });
    const signerCount = await contract.methods
      .get_signer_count()
      .simulate({ from: deployerAddress });
    const isSignerActive = await contract.methods
      .is_signer_public(signer1Address)
      .simulate({ from: deployerAddress });

    logger.info(`Threshold: ${threshold}`);
    logger.info(`Signer count: ${signerCount}`);
    logger.info(`Initial signer active: ${isSignerActive}`);

    if (threshold.toString() === "0" || signerCount.toString() === "0") {
      logger.error("❌ Public state not initialized!");
      throw new Error("Public state initialization failed");
    }

    logger.info("✓ Public state verified");
    logger.info("✓ Contract ready\n");

    logger.info("=".repeat(80));
    logger.info("UPDATING .ENV");
    logger.info("=".repeat(80));

    const envFile = path.resolve(process.cwd(), ".env");
    const lines = fs.existsSync(envFile)
      ? fs.readFileSync(envFile, "utf8").split(/\r?\n/)
      : [];

    const map: Record<string, number> = {};
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m) map[m[1]] = i;
    }

    const set = (k: string, v: string) => {
      if (map[k] !== undefined) lines[map[k]] = `${k}=${v}`;
      else lines.push(`${k}=${v}`);
    };

    set("PRIVATE_MULTISIG_ADDRESS", multisigAddress.toString());
    set("DEPLOYER_ADDRESS", deployerAddress.toString());
    set("DEPLOY_TIMESTAMP", new Date().toISOString());

    fs.writeFileSync(envFile, lines.join("\n"));
    logger.info("✓ .env updated\n");

    logger.info("=".repeat(80));
    logger.info("DEPLOYMENT SUCCESSFUL ✅");
    logger.info("=".repeat(80));
    logger.info(`Contract: ${multisigAddress.toString()}`);
    logger.info(`Deployer: ${deployerAddress.toString()}`);
    logger.info(`Initial signer: ${signer1Address.toString()}`);
    logger.info(`Threshold: ${threshold}`);
    logger.info(`Signer count: ${signerCount}`);
    logger.info(`Timestamp: ${new Date().toISOString()}\n`);
    logger.info("Ready to test: yarn test-multisig");
    logger.info("=".repeat(80));
  } catch (error) {
    logger.error("\n❌ DEPLOYMENT FAILED");
    if (error instanceof Error) {
      logger.error(`Error: ${error.message}`);
    }
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});