import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { MultiSchnorrAccountContract } from "../src/artifacts/MultiSchnorrAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import fs from "fs";
import path from "path";

async function main() {
  const logger = createLogger("multisig-account");
  const pxe = await setupPXE();

  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });
  const fee = {
    paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
  };

  const grumpkin = new Grumpkin();

  const priv1 = GrumpkinScalar.random();
  const priv2 = GrumpkinScalar.random();
  const priv3 = GrumpkinScalar.random();

  const pub1 = await grumpkin.mul(grumpkin.generator(), priv1);
  const pub2 = await grumpkin.mul(grumpkin.generator(), priv2);
  const pub3 = await grumpkin.mul(grumpkin.generator(), priv3);

  const secretKey = Fr.random();
  const salt = Fr.random();

  logger.info(`Priv1: ${priv1.toString()}`);
  logger.info(`Priv2: ${priv2.toString()}`);
  logger.info(`Priv3: ${priv3.toString()}`);
  logger.info(`Salt: ${salt.toString()}`);

  const acctMgr = await getSchnorrAccount(pxe, secretKey, priv1, salt);
  await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
  const ownerWallet = await acctMgr.getWallet();
  const owner: AztecAddress = ownerWallet.getAddress();

  logger.info(`Base SchnorrAccount deployed: ${owner.toString()}`);

  const deployMethod = MultiSchnorrAccountContract.deploy(
    ownerWallet,
    pub1.x, pub1.y,
    pub2.x, pub2.y,
    pub3.x, pub3.y,
    2
  );

  const sent = deployMethod.send({ from: owner, fee });
  const receipt = await sent.wait({ timeout: 180000 });

  const deployedAddress = receipt.contract.address as AztecAddress;
  const multisig = await MultiSchnorrAccountContract.at(
    deployedAddress,
    ownerWallet
  );

  logger.info(`MultiSchnorrAccount deployed: ${deployedAddress.toString()}`);
  logger.info(`TxHash: ${receipt.txHash}`);

  const envFile = path.resolve(process.cwd(), ".env.multisig");
  const envData = [
    `DEPLOYED_ADDRESS=${deployedAddress.toString()}`,
    `PRIV1=${priv1.toString()}`,
    `PRIV2=${priv2.toString()}`,
    `PRIV3=${priv3.toString()}`,
    `SECRET_KEY=${secretKey.toString()}`,
    `SALT=${salt.toString()}`
  ].join("\n");
  fs.writeFileSync(envFile, envData);

  logger.info(`Keys saved to ${envFile}`);

  return multisig;
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
