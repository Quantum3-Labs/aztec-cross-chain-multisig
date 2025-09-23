import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { CustomAccountContract } from "../src/artifacts/CustomAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

async function main() {
  const logger = createLogger("custom-account");
  const pxe = await setupPXE();

  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const encryptionSecretKey = Fr.random();
  const signingPrivateKey = GrumpkinScalar.random();
  const salt = Fr.random();

  logger.info(`SecretKey: ${encryptionSecretKey.toString()}`);
  logger.info(`SigningKey: ${signingPrivateKey.toString()}`);
  logger.info(`Salt: ${salt.toString()}`);

  const acctMgr = await getSchnorrAccount(pxe, encryptionSecretKey, signingPrivateKey, salt);
  await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
  const ownerWallet = await acctMgr.getWallet();
  const owner: AztecAddress = ownerWallet.getAddress();

  logger.info(`Owner: ${owner.toString()}`);

  const deployMethod = CustomAccountContract.deploy(ownerWallet, owner);
  const sent = deployMethod.send({ from: owner, fee });
  const receipt = await sent.wait({ timeout: 180000 });

  const deployedAddress = receipt.contract.address as AztecAddress;
  const custom = await CustomAccountContract.at(deployedAddress, ownerWallet);

  logger.info(`CustomAccount deployed: ${deployedAddress.toString()}`);
  logger.info(`TxHash: ${receipt.txHash}`);

  return custom;
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
