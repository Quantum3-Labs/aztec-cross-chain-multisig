import "dotenv/config";
import fs from "fs";
import path from "path";
import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const logger = createLogger("deploy-multisig");
  
  try {
    logger.info("Starting PrivateMultisig deployment...\n");
    
    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

    const secretKey = toFr(process.env.SECRET_KEY!);
    const salt = toFr(process.env.SALT!);
    const deployerPrivKey = toScalar(process.env.PRIV1!);
    const initialSignerPubX = toFr(process.env.PUB1_X!);
    const initialSignerPubY = toFr(process.env.PUB1_Y!);
    const initialThreshold = Fr.fromString(process.env.THRESHOLD ?? "1");

    const deployerAcctMgr = await getSchnorrAccount(pxe, secretKey, deployerPrivKey, salt);
    const deployerAddress = deployerAcctMgr.getAddress();
    
    const existingAccount = await pxe.getContractInstance(deployerAddress);
    if (!existingAccount) {
      logger.info("Deploying account...");
      await (await deployerAcctMgr.deploy({ fee })).wait({ timeout: 180000 });
      logger.info("Waiting for account sync (60s)...");
      await sleep(60000);
    }
    
    try { await deployerAcctMgr.register(); } catch {}
    const deployerWallet = await deployerAcctMgr.getWallet();
    
    logger.info("Deploying PrivateMultisig...");
    const contract = await PrivateMultisigContract.deploy(
      deployerWallet, deployerAddress, initialSignerPubX, initialSignerPubY, initialThreshold
    ).send({ from: deployerAddress, fee }).deployed({ timeout: 180000 });
    
    logger.info("Waiting for contract sync (90s)...");
    await sleep(90000);
    
    const multisigAddress = contract.address;
    
    const envFile = path.resolve(process.cwd(), ".env");
    const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/) : [];
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
    
    logger.info(`\n✅ DEPLOYED: ${multisigAddress.toString()}`);
  } catch (error) {
    logger.error("DEPLOYMENT FAILED");
    throw error;
  }
}

main().catch(e => { console.error(e); process.exit(1); });