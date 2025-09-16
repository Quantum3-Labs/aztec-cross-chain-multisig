import "dotenv/config";
import { AccountManager, Fr, createLogger } from "@aztec/aztec.js";
import { MyCustomAccountContract } from "../src/accounts/MyCustomAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";

const logger = createLogger("aztec:deploy-account");
logger.info("Connecting to PXE...");
if (!process.env.SALT || !process.env.SECRET) {
  throw new Error("Missing required environment variables: SALT and SECRET");
}

const SALT = Fr.fromString(process.env.SALT);
async function deployAccount() {
  console.log("🚀 Setting up PXE...");
  const pxe = await setupPXE();

  const encryptionSecretKey = Fr.random();

  console.log("📝 Creating account...");
  const accountContract = new MyCustomAccountContract();

  const account = await AccountManager.create(
    pxe,
    encryptionSecretKey,
    accountContract,
    SALT
  );

  console.log("🔑 Account address:", account.getAddress().toString());

  if (await account.isDeployable()) {
    console.log("💰 Account needs deployment but requires funds first.");
    console.log("⚠️  Please fund this address with Fee Juice tokens first!");
    console.log("Address:", account.getAddress().toString());
  } else {
    console.log("📋 Registering account...");
    await account.register();
    console.log("✅ Account registered successfully!");
  }

  const wallet = await account.getWallet();
  console.log("💼 Wallet ready at:", wallet.getAddress().toString());

  return { wallet, account };
}

deployAccount().catch(console.error);
