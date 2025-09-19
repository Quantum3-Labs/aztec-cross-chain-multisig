import "dotenv/config";
import { AccountManager, Fr, createLogger } from "@aztec/aztec.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { MyCustomAccountContract } from "../src/accounts/MyCustomAccount.js";

const logger = createLogger("aztec:deploy-account");

if (!process.env.SALT || !process.env.SECRET) {
  throw new Error("Missing SALT or SECRET in .env");
}

const SALT = Fr.fromString(process.env.SALT);

async function deployAccount() {
  logger.info("🚀 Setting up PXE...");
  const pxe = await setupPXE();
  const secretKeyHex = process.env.SECRET!;

  const accountContract = new MyCustomAccountContract(secretKeyHex);
  const account = await AccountManager.create(
    pxe,
    Fr.fromString(secretKeyHex),
    accountContract,
    SALT
  );

  console.log("🔑 Account address:", account.getAddress().toString());

  if (await account.isDeployable()) {
    console.log("📦 Deploying account contract...");
    await (await account.deploy()).wait();
    console.log("✅ Account deployed successfully!");
  } else {
    console.log("📋 Registering account...");
    await account.register();
    console.log("✅ Account registered successfully!");
  }

  const wallet = await account.getWallet();
  console.log("💼 Wallet ready at:", wallet.getAddress().toString());

  const contracts = await pxe.getContracts();
  console.log("📋 Contracts in PXE:");
  contracts.forEach(c => {
    console.log(` - ${c.toString()}`);
  });

  return { wallet, account };
}

deployAccount().catch(console.error);
