import { Fr, GrumpkinScalar } from "@aztec/aztec.js/fields";
import { toHex0x } from "../../cli/utils";
import { Grumpkin } from "@aztec/foundation/crypto";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { setupSponsoredFPC } from "../../cli/sponsored_fpc";
import { TestWallet } from "@aztec/test-wallet/server";
export async function createSigner(wallet: TestWallet) {
  const fee = await setupSponsoredFPC();

  let secretKey = Fr.random();
  let signingKey = GrumpkinScalar.random();
  let salt = Fr.random();
  let account = await wallet.createSchnorrAccount(secretKey, salt, signingKey);
  const grumpkin = new Grumpkin();
  const generator = grumpkin.generator();
  const publicKey = await grumpkin.mul(generator, signingKey);

  const tx = await (await account.getDeployMethod())
    .send({ from: AztecAddress.ZERO, fee: fee })
    .wait();

  await wallet.registerSender(account.address);

  // print out the accounts in wallet
  const accounts = await wallet.getAccounts();
  console.log("accounts:", accounts);

  return {
    address: (await account.getAccount()).getAddress().toString(),
    privateKey: toHex0x(signingKey),
    publicKeyX: toHex0x(publicKey.x),
    publicKeyY: toHex0x(publicKey.y),
    createdAt: new Date().toISOString(),
    secretKey: secretKey,
    saltKey: salt,
    wallet: account,
  };
}
