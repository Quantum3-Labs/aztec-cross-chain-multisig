import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { MultiSchnorrAccountContract } from "../src/artifacts/MultiSchnorrAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.multisig" });

async function main() {
  const logger = createLogger("multisig-test");
  const pxe = await setupPXE();

  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const deployedAddress = AztecAddress.fromString(process.env.DEPLOYED_ADDRESS!);
  const secretKey = Fr.fromString(process.env.SECRET_KEY!);
  const salt = Fr.fromString(process.env.SALT!);
  const priv1 = GrumpkinScalar.fromString(process.env.PRIV1!);
  const priv2 = GrumpkinScalar.fromString(process.env.PRIV2!);

  const acctMgr1 = await getSchnorrAccount(pxe, secretKey, priv1, salt);
  const wallet1 = await acctMgr1.getWallet();

  const acctMgr2 = await getSchnorrAccount(pxe, secretKey, priv2, salt);
  const wallet2 = await acctMgr2.getWallet();

  const multisig = await MultiSchnorrAccountContract.at(deployedAddress, wallet1);

  logger.info(`Loaded multisig at ${deployedAddress.toString()}`);

  const threshold = await multisig.methods.get_threshold().simulate({ from: wallet1.getAddress(), fee });
  logger.info(`Threshold: ${threshold}`);

  const innerHash = Fr.random();

  const tx1 = multisig.methods.approve_public_authwit(innerHash).send({ from: wallet1.getAddress(), fee });
  await (await tx1).wait({ timeout: 120000 });

  const tx2 = multisig.methods.approve_public_authwit(innerHash).send({ from: wallet2.getAddress(), fee });
  await (await tx2).wait({ timeout: 120000 });

  const resultSim = await multisig.methods.verify_public_authwit(innerHash).simulate({ from: wallet1.getAddress(), fee });
  logger.info(`verify_public_authwit(simulate): ${resultSim.toString()}`);

  const txVerify = multisig.methods.verify_public_authwit(innerHash).send({ from: wallet1.getAddress(), fee });
  const receiptVerify = await (await txVerify).wait({ timeout: 120000 });
  logger.info(`verify_public_authwit(send) txHash: ${receiptVerify.txHash}`);

  const resultAfter = await multisig.methods.verify_public_authwit(innerHash).simulate({ from: wallet1.getAddress(), fee });
  logger.info(`verify_public_authwit(after consume simulate): ${resultAfter.toString()}`);
}

main().catch((err) => {
  console.error("Multisig test flow failed:", err);
  process.exit(1);
});
