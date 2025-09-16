import { setupPXE } from "../src/utils/setup_pxe.js";
import { getAccountFromEnv } from "../src/utils/create_account_from_env.js";
import { TokenContract } from "@aztec/noir-contracts.js/Token";
import { createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

// mint_to_private or mint_to_public from token contract not yet run with SchnorrAccount on testnet (error Array must contain max 100 elements (0))

async function main() {
  const logger = createLogger("aztec:mint-token");
  const pxe = await setupPXE();
  const account = await getAccountFromEnv(pxe);
  const wallet = await account.getWallet();
  logger.info(`👛 Using wallet: ${wallet.getAddress()}`);

  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const sponsoredPaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  logger.info("🚀 Deploying ERC20 token...");
  const token = await TokenContract.deploy(wallet, wallet.getAddress(), "DemoToken", "DTK", 18)
    .send({ fee: { paymentMethod: sponsoredPaymentMethod } })
    .deployed();
  logger.info(`✅ Token deployed at: ${token.address.toString()}`);

  logger.info("🪙 Minting 100 DTK to PUBLIC balance...");
  await token.methods
    .mint_to_public(wallet.getAddress(), 100n)
    .send({ fee: { paymentMethod: sponsoredPaymentMethod } })
    .wait();
  logger.info("✅ Mint complete");

  const balance = await token.methods.balance_of_public(wallet.getAddress()).simulate();
  logger.info(`📊 Public balance of ${wallet.getAddress()}: ${balance.toString()} DTK`);
}

main().catch((err) => {
  console.error("❌ Error in mint_token script:", err);
  process.exit(1);
});
