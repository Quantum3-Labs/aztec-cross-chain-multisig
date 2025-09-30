import "dotenv/config";
import fs from "fs";
import path from "path";
import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());
const maybeFr = (k: string) => (process.env[k] ? toFr(process.env[k] as string) : undefined);

async function main() {
  const logger = createLogger("deploy-private-multisig");
  const pxe = await setupPXE();
  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const priv = toScalar(process.env.PRIV1!);

  const grumpkin = new Grumpkin();
  const pub = await grumpkin.mul(grumpkin.generator(), priv);
  const pubX = maybeFr("PUB1_X") ?? pub.x;
  const pubY = maybeFr("PUB1_Y") ?? pub.y;

  const threshold = Number(process.env.THRESHOLD ?? "1");

  logger.info("Deploying and registering owner account...");
  const acctMgr = await getSchnorrAccount(pxe, secretKey, priv, salt);
  
  // Deploy account contract
  await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
  
  // Register account with PXE - THIS IS CRITICAL
  await acctMgr.register();
  
  const ownerWallet = await acctMgr.getWallet();
  const owner: AztecAddress = ownerWallet.getAddress();
  
  logger.info(`Owner account deployed: ${owner.toString()}`);

  logger.info("Deploying multisig contract...");
  const tx = PrivateMultisigContract.deploy(ownerWallet, owner, pubX, pubY, threshold).send({ from: owner, fee });
  const receipt = await tx.wait({ timeout: 180000 });
  const deployed = receipt.contract.address as AztecAddress;

  const envFile = process.env.ENV_PATH || path.resolve(process.cwd(), ".env");
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
  set("PRIVATE_MULTISIG_ADDRESS", deployed.toString());
  set("DEPLOY_TX_HASH", receipt.txHash.toString());
  set("DEPLOY_TIMESTAMP", new Date().toISOString());
  fs.writeFileSync(envFile, lines.join("\n"));

  logger.info(`DEPLOYED_ADDRESS=${deployed.toString()}`);
  logger.info(`DEPLOY_TX_HASH=${receipt.txHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});