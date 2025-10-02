import "dotenv/config";
import { AztecAddress, Fr, createLogger } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Schnorr } from "@aztec/foundation/crypto";
import { poseidon2Hash } from "@aztec/foundation/crypto";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());

async function generateSchnorrSignature(messageHash: Fr, privateKey: GrumpkinScalar): Promise<number[]> {
  const schnorr = new Schnorr();
  const message = messageHash.toBuffer();
  const signature = await schnorr.constructSignature(message, privateKey);
  return Array.from(signature.toBuffer());
}

async function getOrDeployAccount(pxe: any, privKeyEnv: string, fee: any) {
  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const priv = toScalar(process.env[privKeyEnv]!);
  const acctMgr = await getSchnorrAccount(pxe, secretKey, priv, salt);
  try {
    await acctMgr.register();
  } catch {
    await (await acctMgr.deploy({ fee })).wait({ timeout: 180 });
    await acctMgr.register();
  }
  const wallet = await acctMgr.getWallet();
  return { wallet, privateKey: priv };
}

async function computeManagementIntentHash(
  operation_type: number,
  target_address: AztecAddress,
  pubkey_x: Fr,
  pubkey_y: Fr,
  new_threshold: number,
  nonce: number,
  deadline: bigint
): Promise<Fr> {
  return await poseidon2Hash([
    new Fr(BigInt(operation_type)),
    target_address.toField(),
    pubkey_x,
    pubkey_y,
    new Fr(BigInt(new_threshold)),
    new Fr(BigInt(nonce)),
    new Fr(deadline)
  ]);
}

async function computeTransactionIntentHash(
  to: AztecAddress,
  amount: bigint,
  function_selector: Fr,
  data_hash: Fr,
  nonce: number,
  deadline: bigint
): Promise<Fr> {
  return await poseidon2Hash([
    to.toField(),
    new Fr(amount),
    function_selector,
    data_hash,
    new Fr(BigInt(nonce)),
    new Fr(deadline)
  ]);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const logger = createLogger("test-multisig");
  const pxe = await setupPXE();
  const sponsoredFPC = await getSponsoredFPCInstance();
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
  const contractAddress = AztecAddress.fromString(process.env.PRIVATE_MULTISIG_ADDRESS!);

  logger.info("Setting up 3 accounts");
  const { wallet: wallet1, privateKey: priv1 } = await getOrDeployAccount(pxe, "PRIV1", fee);
  const { wallet: wallet2, privateKey: priv2 } = await getOrDeployAccount(pxe, "PRIV2", fee);
  const { wallet: wallet3, privateKey: priv3 } = await getOrDeployAccount(pxe, "PRIV3", fee);

  const addr1 = wallet1.getAddress();
  const addr2 = wallet2.getAddress();
  const addr3 = wallet3.getAddress();

  const pub1X = toFr(process.env.PUB1_X!);
  const pub1Y = toFr(process.env.PUB1_Y!);
  const pub2X = toFr(process.env.PUB2_X!);
  const pub2Y = toFr(process.env.PUB2_Y!);
  const pub3X = toFr(process.env.PUB3_X!);
  const pub3Y = toFr(process.env.PUB3_Y!);

  const contract = await PrivateMultisigContract.at(contractAddress, wallet1);

  await sleep(45000);

  let nonce = 1000;
  const deadline = BigInt(Date.now() + 2 * 60 * 60 * 1000);

  const addSigner2Hash = await computeManagementIntentHash(1, addr2, pub2X, pub2Y, 0, nonce, deadline);
  const addSigner2Sig = await generateSchnorrSignature(addSigner2Hash, priv1);
  await contract.withWallet(wallet1).methods
    .add_signer(addr2, pub2X, pub2Y, addSigner2Sig, nonce++, pub1X, pub1Y, deadline)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });
  await sleep(20000);
  await contract.withWallet(wallet1).methods
    .execute_add_signer(addSigner2Hash, addr2, pub2X, pub2Y, [addr1, ...Array(19).fill(AztecAddress.ZERO)], 1)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });

  await sleep(20000);

  const addSigner3Hash = await computeManagementIntentHash(1, addr3, pub3X, pub3Y, 0, nonce, deadline);
  const addSigner3Sig = await generateSchnorrSignature(addSigner3Hash, priv1);
  await contract.withWallet(wallet1).methods
    .add_signer(addr3, pub3X, pub3Y, addSigner3Sig, nonce++, pub1X, pub1Y, deadline)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });
  await sleep(20000);
  await contract.withWallet(wallet1).methods
    .execute_add_signer(addSigner3Hash, addr3, pub3X, pub3Y, [addr1, ...Array(19).fill(AztecAddress.ZERO)], 1)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });

  await sleep(20000);

  const changeThresholdHash = await computeManagementIntentHash(3, AztecAddress.ZERO, new Fr(0), new Fr(0), 2, nonce, deadline);
  const changeThresholdSig = await generateSchnorrSignature(changeThresholdHash, priv1);
  await contract.withWallet(wallet1).methods
    .change_threshold(new Fr(2), changeThresholdSig, nonce++, pub1X, pub1Y, deadline)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });
  await sleep(20000);
  await contract.withWallet(wallet1).methods
    .execute_change_threshold(changeThresholdHash, new Fr(2), [addr1, ...Array(19).fill(AztecAddress.ZERO)], 1)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });

  await sleep(25000);

  const txIntentHash = await computeTransactionIntentHash(
    addr3,
    1000000n,
    new Fr(0x1234n),
    new Fr(0x5678n),
    nonce,
    deadline
  );
  const proposeSig = await generateSchnorrSignature(txIntentHash, priv1);
  await contract.withWallet(wallet1).methods
    .propose_transaction(addr3, 1000000n, new Fr(0x1234n), new Fr(0x5678n), deadline, proposeSig, nonce++, pub1X, pub1Y)
    .send({ from: addr1, fee })
    .wait({ timeout: 180 });

  await sleep(25000);

  const approveSig2 = await generateSchnorrSignature(txIntentHash, priv2);
  await contract.withWallet(wallet2).methods
    .approve_transaction(txIntentHash, approveSig2, nonce++, pub2X, pub2Y)
    .send({ from: addr2, fee })
    .wait({ timeout: 180 });

  await sleep(2000);

  console.log("=".repeat(80));
  console.log("ALL TESTS PASSED");
  console.log("=".repeat(80));
  console.log(`Intent hash: ${txIntentHash.toString()}`);
  console.log("Approved by: Signer 1, Signer 2 (2/3)");
  console.log("=".repeat(80));
}

main().catch((e) => {
  console.error("Test failed:", e?.message || e);
  process.exit(1);
});
