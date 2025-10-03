import "dotenv/config";
import { Fr, createLogger } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) =>
  GrumpkinScalar.fromString(BigInt(hex).toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const logger = createLogger("deploy-accounts");

  try {
    logger.info("=".repeat(80));
    logger.info("DEPLOYING TEST ACCOUNTS TO AZTEC TESTNET");
    logger.info("=".repeat(80) + "\n");

    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    });
    const fee = {
      paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
    };

    const accounts = [
      { key: process.env.PRIV_DEPLOYER!, name: "Deployer" },
      { key: process.env.PRIV1!, name: "Signer 1" },
      { key: process.env.PRIV2!, name: "Signer 2" },
      { key: process.env.PRIV3!, name: "Signer 3" },
    ];

    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i];
      logger.info(`[${i + 1}/${accounts.length}] Processing ${acc.name}...`);

      const privKey = toScalar(acc.key);
      const acctMgr = await getSchnorrAccount(
        pxe,
        toFr(process.env.SECRET_KEY!),
        privKey,
        toFr(process.env.SALT!)
      );

      const existing = await pxe.getContractInstance(acctMgr.getAddress());
      if (!existing) {
        logger.info(`  Deploying ${acc.name} to blockchain...`);
        await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
        logger.info(`  ✓ Deployed: ${acctMgr.getAddress()}`);
        logger.info(`  Waiting 20s for sync...`);
        await sleep(20000);
      } else {
        logger.info(`  ✓ Already exists: ${acctMgr.getAddress()}`);
      }

      try {
        await acctMgr.register();
        logger.info(`  ✓ Registered to PXE\n`);
      } catch {
        logger.info(`  ✓ Already registered\n`);
      }
    }

    logger.info("=".repeat(80));
    logger.info("ALL ACCOUNTS DEPLOYED ✅");
    logger.info("=".repeat(80));
  } catch (error) {
    logger.error("\n❌ ACCOUNT DEPLOYMENT FAILED");
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