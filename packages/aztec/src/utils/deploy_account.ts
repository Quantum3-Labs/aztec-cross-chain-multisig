import { createLogger, Fr, PXE, Logger } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { getSponsoredFPCInstance } from "./sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

export async function deploySchnorrAccount(pxe: PXE) {
  const logger: Logger = createLogger("aztec:aztec-starter");

  logger.info("👤 Starting Schnorr account setup...");

  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });
  logger.info(`✅ Sponsored FPC registered at ${sponsoredFPC.address}`);

  // Generate account keys
  const secretKey = Fr.random();
  const salt = Fr.random();
  logger.info("Save the following SECRET and SALT in .env for future use");
  logger.info(`🔑 Secret: ${secretKey.toString()}`);
  logger.info(`🧂 Salt:   ${salt.toString()}`);

  // Create Schnorr account
  const schnorrAccount = await getSchnorrAccount(
    pxe,
    secretKey,
    deriveSigningKey(secretKey),
    salt
  );
  const accountAddress = schnorrAccount.getAddress();
  logger.info(`📍 Account address: ${accountAddress}`);

  // Register account (không deploy)
  await schnorrAccount.register();
  logger.info("✅ Account registered with PXE");

  // Get wallet
  const wallet = await schnorrAccount.getWallet();
  logger.info(`👛 Wallet instance ready for ${wallet.getAddress()}`);

  return schnorrAccount;
}
