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
    logger.info("DEPLOYING PRIVATEMULTISIG (PRIVATE CONSTRUCTOR)");
    logger.info("=".repeat(80));

    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    });
    const fee = {
      paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
    };

    // ==== SETUP DEPLOYER ====
    const secretKey = toFr(process.env.SECRET_KEY!);
    const salt = toFr(process.env.SALT!);
    const deployerPrivKey = toScalar(process.env.PRIV_DEPLOYER!);

    const deployerAcctMgr = await getSchnorrAccount(
      pxe,
      secretKey,
      deployerPrivKey,
      salt
    );
    await deployerAcctMgr.register();
    const deployerWallet = await deployerAcctMgr.getWallet();
    const deployerAddress = deployerAcctMgr.getAddress();

    // ==== SETUP INITIAL SIGNER ====
    const signer1PrivKey = toScalar(process.env.PRIV1!);
    const signer1PubKey = await derivePublicKey(signer1PrivKey);
    const signer1AcctMgr = await getSchnorrAccount(
      pxe,
      secretKey,
      signer1PrivKey,
      salt
    );
    await signer1AcctMgr.register();
    const signer1Address = signer1AcctMgr.getAddress();

    logger.info(`✓ Deployer: ${deployerAddress}`);
    logger.info(`✓ Signer1: ${signer1Address}`);

    // ==== DEPLOY CONTRACT (NO CONSTRUCTOR PARAMS) ====
    logger.info("Deploying contract...");
    const deployTx = PrivateMultisigContract.deploy(deployerWallet).send({
      from: deployerAddress,
      fee,
    });
    const contract = await deployTx.deployed({ timeout: 180000 });
    const multisigAddress = contract.address;
    logger.info(`✓ Contract deployed at ${multisigAddress}`);

    await sleep(5000);

    // ==== REGISTER CONTRACT WITH PXE ====
    let multisigInstance = await pxe.getContractInstance(multisigAddress);
    for (let i = 0; i < 15 && !multisigInstance; i++) {
      await sleep(1000);
      multisigInstance = await pxe.getContractInstance(multisigAddress);
    }
    if (!multisigInstance)
      throw new Error("Failed to get contract instance for PXE registration");

    await pxe.registerContract({
      instance: multisigInstance,
      artifact: PrivateMultisigContract.artifact,
    });

    logger.info("✓ Contract registered with PXE");
    await sleep(5000);

    // ==== INITIALIZE PUBLIC STATE ====
    logger.info("Initializing public state...");
    await contract.methods
      .initialize_public_state(Fr.fromString("1"), Fr.fromString("1"))
      .send({ from: deployerAddress, fee })
      .wait({ timeout: 180000 });

    await contract.methods
      ._initialize_signer_status(signer1Address)
      .send({ from: deployerAddress, fee })
      .wait({ timeout: 180000 });

    logger.info("✓ Initialization complete");

    // ==== VERIFY ====
    const threshold = await contract.methods
      .get_threshold()
      .simulate({ from: deployerAddress });
    const signerCount = await contract.methods
      .get_signer_count()
      .simulate({ from: deployerAddress });
    const isSigner = await contract.methods
      .is_signer_public(signer1Address)
      .simulate({ from: deployerAddress });

    logger.info(`Threshold: ${threshold}`);
    logger.info(`Signer Count: ${signerCount}`);
    logger.info(`Signer1 active: ${isSigner}`);

    // ==== UPDATE .ENV ====
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

    logger.info("✓ Deployment complete ✅");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
