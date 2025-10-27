import { Grumpkin, GrumpkinScalar, PXE } from "@aztec/aztec.js";
import { setupSponsoredFPC } from "../../cli/sponsored_fpc";
import { toFr, toHex0x } from "../../cli/utils";
import { SALT, SECRET_KEY } from "../../cli/constants";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { randomBytes, randomInt } from "crypto";

export async function createSigner(pxe: PXE) {
  const privateKey = GrumpkinScalar.random();
  const grumpkin = new Grumpkin();
  const generator = grumpkin.generator();
  const publicKey = await grumpkin.mul(generator, privateKey);
  const secretKey = toFr(randomInt(0, 2 ** 8 - 1).toString());
  const saltKey = toFr(randomInt(0, 2 ** 8 - 1).toString());
  const newAccount = await getSchnorrAccount(
    pxe,
    secretKey,
    privateKey,
    saltKey
  );
  const fee = await setupSponsoredFPC();

  await newAccount
    .deploy({
      fee: fee,
    })
    .wait({
      timeout: 300_000,
    });
  const newWallet = await newAccount.getWallet();
  const newAccountAddress = newWallet.getAddress();
  // register into pxe
  await newAccount.register();

  return {
    address: newAccountAddress.toString(),
    privateKey: toHex0x(privateKey),
    publicKeyX: toHex0x(publicKey.x),
    publicKeyY: toHex0x(publicKey.y),
    createdAt: new Date().toISOString(),
    secretKey: secretKey,
    saltKey: saltKey,
    wallet: newWallet,
  };
}
