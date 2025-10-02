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

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ensureAccount(pxe: any, fee: any, secretKey: Fr, priv: GrumpkinScalar, salt: Fr) {
  const acctMgr = await getSchnorrAccount(pxe, secretKey, priv, salt);
  try {
    await acctMgr.register();
  } catch {
    await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
    await acctMgr.register();
  }
  const wallet = await acctMgr.getWallet();
  return { wallet };
}

function upsertEnv(vars: Record<string, string>) {
  const envFile = path.resolve(process.cwd(), ".env");
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/) : [];
  const map: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) map[m[1]] = i;
  }
  for (const [k, v] of Object.entries(vars)) {
    if (map[k] !== undefined) lines[map[k]] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(envFile, lines.join("\n"));
}

async function main() {
  const logger = createLogger("deploy-private-multisig");
  logger.info("Setting up PXE connection...");
  const pxe = await setupPXE();

  logger.info("Getting sponsored FPC instance...");
  const sponsoredFPC = await getSponsoredFPCInstance();
  try {
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  } catch {}

  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const initialSignerPrivKey = toScalar(process.env.PRIV1!);
  const initialSignerPubX = toFr(process.env.PUB1_X!);
  const initialSignerPubY = toFr(process.env.PUB1_Y!);

  const thresholdStr = process.env.THRESHOLD ?? "1";
  if (!/^\d+$/.test(thresholdStr) || BigInt(thresholdStr) <= 0n) {
    throw new Error("THRESHOLD must be a positive integer");
  }
  const initialThreshold = Fr.fromString(thresholdStr);

  logger.info("Ensuring deployer Schnorr account (register or deploy if needed)...");
  const { wallet: deployerWallet } = await ensureAccount(pxe, fee, secretKey, initialSignerPrivKey, salt);
  const deployerAddress = deployerWallet.getAddress();

  logger.info(`Deployer account: ${deployerAddress.toString()}`);
  logger.info(`Initial threshold: ${initialThreshold.toString()}`);

  logger.info("Deploying PrivateMultisig contract...");
  const tx = PrivateMultisigContract.deploy(
    deployerWallet,
    deployerAddress,
    initialSignerPubX,
    initialSignerPubY,
    initialThreshold
  ).send({ from: deployerAddress, fee });

  logger.info("Waiting for deployment confirmation...");
  const receipt = await tx.wait({ timeout: 180000 });
  const multisigAddress = receipt.contract.address as AztecAddress;
  logger.info(`PrivateMultisig deployed at: ${multisigAddress.toString()}`);

  logger.info("Waiting PXE to index notes...");
  await sleep(20000);

  const multisig = await PrivateMultisigContract.at(multisigAddress, deployerWallet);

  // simulate() now requires options: provide { from }
  const isSigner: boolean = await multisig
    .withWallet(deployerWallet)
    .methods.is_signer(deployerAddress)
    .simulate({ from: deployerAddress });

  if (!isSigner) {
    throw new Error("Post-deploy verify failed: deployer is not recognized as an initial signer");
  }

  const onchainThreshold: Fr = await multisig
    .withWallet(deployerWallet)
    .methods.get_threshold()
    .simulate({ from: deployerAddress });

  if (onchainThreshold.toString() !== initialThreshold.toString()) {
    throw new Error(
      `Post-deploy verify failed: threshold mismatch. On-chain=${onchainThreshold.toString()} Expected=${initialThreshold.toString()}`
    );
  }

  upsertEnv({
    PRIVATE_MULTISIG_ADDRESS: multisigAddress.toString(),
    DEPLOYER_ADDRESS: deployerAddress.toString(),
    DEPLOY_TX_HASH: receipt.txHash.toString(),
    DEPLOY_TIMESTAMP: new Date().toISOString(),
  });

  logger.info("=".repeat(80));
  logger.info("DEPLOYMENT SUCCESS");
  logger.info(`  Multisig: ${multisigAddress.toString()}`);
  logger.info(`  Deployer: ${deployerAddress.toString()}`);
  logger.info(`  Tx Hash: ${receipt.txHash}`);
  logger.info("Verification:");
  logger.info(`  is_signer(deployer) = ${isSigner}`);
  logger.info(`  get_threshold() = ${onchainThreshold.toString()}`);
  logger.info("=".repeat(80));
}

main().catch((e) => {
  console.error("\n=== DEPLOYMENT FAILED ===");
  if (e instanceof Error) {
    console.error("Message:", e.message);
    console.error("Stack:", e.stack);
  } else {
    console.error("Error:", e);
  }
  process.exit(1);
});
