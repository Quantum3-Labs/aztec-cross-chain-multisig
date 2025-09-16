// scripts/deploy_custom_account_publish_message_in_private.ts
import { createLogger, Fr, AccountManager } from "@aztec/aztec.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import * as dotenv from "dotenv";
import { CustomAccount } from "../src/accounts/CustomAccount.js";

dotenv.config();

async function main() {
  const logger = createLogger("aztec:deploy:day3");

  const pxe = await setupPXE();
  const nodeInfo = await pxe.getNodeInfo();
  logger.info(`Connected to chain: ${nodeInfo.l1ChainId}`);

  const secretKey = Fr.fromString(process.env.SECRET as string);
  const salt = Fr.fromString(process.env.SALT as string);

  const account = await AccountManager.create(pxe, secretKey, new CustomAccount(), salt);
  const wallet = await account.getWallet();

  logger.info(`
========================================
DAY3 CUSTOM ACCOUNT DEPLOYED
Supports: publish_message_in_private
========================================
Address: ${wallet.getAddress().toString()}
Chain: ${nodeInfo.l1ChainId}
========================================
  `);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
