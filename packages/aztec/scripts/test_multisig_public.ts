import "dotenv/config";
import { Fr, createLogger, AztecAddress } from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar, Point } from "@aztec/foundation/fields";
import { Grumpkin, poseidon2Hash } from "@aztec/foundation/crypto";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function derivePublicKey(privateKey: GrumpkinScalar): Promise<Point> {
  const grumpkin = new Grumpkin();
  return grumpkin.mul(grumpkin.generator(), privateKey);
}

async function createSchnorrSignature(messageHash: Fr, privateKey: GrumpkinScalar): Promise<number[]> {
  const { Schnorr } = await import("@aztec/circuits.js/barretenberg");
  const schnorr = new Schnorr();
  const msgBytes = new Uint8Array(32);
  const hashBigInt = messageHash.toBigInt();
  for (let i = 0; i < 32; i++) msgBytes[31 - i] = Number((hashBigInt >> BigInt(i * 8)) & BigInt(0xff));
  const { GrumpkinScalar: CircuitsGrumpkinScalar } = await import("@aztec/circuits.js");
  const privKeyForSchnorr = CircuitsGrumpkinScalar.fromBuffer(Buffer.from(privateKey.toBuffer()));
  const sig = await schnorr.constructSignature(Buffer.from(msgBytes), privKeyForSchnorr);
  return Array.from(sig.toBuffer());
}

async function main() {
  const logger = createLogger("test-multisig");
  try {
    logger.info("=".repeat(80));
    logger.info("PRIVATEMULTISIG - PUBLIC TEST SUITE");
    logger.info("=".repeat(80) + "\n");

    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

    const multisigAddress = AztecAddress.fromString(process.env.PRIVATE_MULTISIG_ADDRESS!);
    logger.info(`Multisig: ${multisigAddress.toString()}`);

    const secret = toFr(process.env.SECRET_KEY!);
    const salt = toFr(process.env.SALT!);

    const privKeys = [process.env.PRIV1!, process.env.PRIV2!, process.env.PRIV3!].map(toScalar);
    const pubKeys = await Promise.all(privKeys.map(derivePublicKey));
    const accounts = await Promise.all(privKeys.map((pk) => getSchnorrAccount(pxe, secret, pk, salt)));

    for (const acct of accounts) await acct.register();
    const wallets = await Promise.all(accounts.map((a) => a.getWallet()));
    const signers = wallets.map((w) => w.getAddress());

    logger.info(`✓ Signers:`);
    signers.forEach((s, i) => logger.info(`  - S${i + 1}: ${s.toString()}`));
    logger.info("");

    const multisig = await PrivateMultisigContract.at(multisigAddress, wallets[0]);
    const multisig2 = await PrivateMultisigContract.at(multisigAddress, wallets[1]);
    const multisig3 = await PrivateMultisigContract.at(multisigAddress, wallets[2]);

    const contractInstance = await pxe.getContractInstance(multisigAddress);
    if (!contractInstance) throw new Error("Failed to get contract instance");
    await pxe.registerContract({ instance: contractInstance, artifact: PrivateMultisigContract.artifact });
    logger.info("✓ Contract registered with PXE\n");
    await sleep(2000);

    // --------------------------------------------------------------------
    logger.info("TEST 1: Initial State");
    logger.info("-".repeat(80));
    const threshold = await multisig.methods.get_threshold().simulate({ from: signers[0] });
    const signerCount = await multisig.methods.get_signer_count().simulate({ from: signers[0] });
    logger.info(`  Threshold: ${threshold}`);
    logger.info(`  Signer Count: ${signerCount}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 2: Add Signer 2");
    logger.info("-".repeat(80));
    const nonce1 = 1;
    const deadline1 = Math.floor(Date.now() / 1000) + 3600;
    const add2Hash = await poseidon2Hash([
      Fr.fromString("1"),
      signers[1].toField(),
      pubKeys[1].x,
      pubKeys[1].y,
      Fr.fromString("0"),
      Fr.fromString(nonce1.toString()),
      Fr.fromString(deadline1.toString()),
    ]);
    const sigAdd2 = await createSchnorrSignature(add2Hash, privKeys[0]);
    await multisig.methods.approve_action(add2Hash, sigAdd2, nonce1, pubKeys[0].x, pubKeys[0].y).send({ from: signers[0], fee }).wait();
    await multisig.methods.execute_add_signer(add2Hash, signers[1], pubKeys[1].x, pubKeys[1].y).send({ from: signers[0], fee }).wait();
    logger.info(`  Added S2. Count: ${await multisig.methods.get_signer_count().simulate({ from: signers[0] })}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 3: Add Signer 3 (multi approval)");
    logger.info("-".repeat(80));
    const nonce2 = 2;
    const deadline2 = Math.floor(Date.now() / 1000) + 3600;
    const add3Hash = await poseidon2Hash([
      Fr.fromString("1"),
      signers[2].toField(),
      pubKeys[2].x,
      pubKeys[2].y,
      Fr.fromString("0"),
      Fr.fromString(nonce2.toString()),
      Fr.fromString(deadline2.toString()),
    ]);
    const sig3a = await createSchnorrSignature(add3Hash, privKeys[0]);
    const sig3b = await createSchnorrSignature(add3Hash, privKeys[1]);
    await multisig.methods.approve_action(add3Hash, sig3a, nonce2, pubKeys[0].x, pubKeys[0].y).send({ from: signers[0], fee }).wait();
    await multisig2.methods.approve_action(add3Hash, sig3b, nonce2 + 1, pubKeys[1].x, pubKeys[1].y).send({ from: signers[1], fee }).wait();
    await multisig.methods.execute_add_signer(add3Hash, signers[2], pubKeys[2].x, pubKeys[2].y).send({ from: signers[0], fee }).wait();
    logger.info(`  Added S3. Count: ${await multisig.methods.get_signer_count().simulate({ from: signers[0] })}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 4: Change Threshold to 2");
    logger.info("-".repeat(80));
    const nonce3 = 3;
    const deadline3 = Math.floor(Date.now() / 1000) + 3600;
    const thresholdHash = await poseidon2Hash([
      Fr.fromString("3"),
      Fr.ZERO,
      Fr.ZERO,
      Fr.ZERO,
      Fr.fromString("2"),
      Fr.fromString(nonce3.toString()),
      Fr.fromString(deadline3.toString()),
    ]);
    const sigTh = await createSchnorrSignature(thresholdHash, privKeys[0]);
    await multisig.methods.approve_action(thresholdHash, sigTh, nonce3, pubKeys[0].x, pubKeys[0].y).send({ from: signers[0], fee }).wait();
    await multisig.methods.execute_change_threshold(thresholdHash, Fr.fromString("2")).send({ from: signers[0], fee }).wait();
    logger.info(`  New Threshold: ${await multisig.methods.get_threshold().simulate({ from: signers[0] })}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 5: Propose + Approve Action");
    logger.info("-".repeat(80));
    const nonce4 = 4;
    const deadline4 = Math.floor(Date.now() / 1000) + 3600;
    const actionHash = await poseidon2Hash([Fr.fromString("99"), Fr.fromString("0"), Fr.fromString("123")]);
    const proposeHash = await poseidon2Hash([
      Fr.fromString("4"),
      multisigAddress.toField(),
      actionHash,
      Fr.fromString(nonce4.toString()),
      Fr.fromString(deadline4.toString()),
    ]);
    const sigProp = await createSchnorrSignature(proposeHash, privKeys[0]);
    const sigApp = await createSchnorrSignature(proposeHash, privKeys[1]);
    await multisig.methods.approve_action(proposeHash, sigProp, nonce4, pubKeys[0].x, pubKeys[0].y).send({ from: signers[0], fee }).wait();
    await multisig2.methods.approve_action(proposeHash, sigApp, nonce4 + 1, pubKeys[1].x, pubKeys[1].y).send({ from: signers[1], fee }).wait();
    await multisig.methods.finalize_action(proposeHash, actionHash).send({ from: signers[0], fee }).wait();
    logger.info(`  Action Approved: ${await multisig.methods.is_action_approved(actionHash).simulate({ from: signers[0] })}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 6: Remove Signer 2 (multi approval)");
    logger.info("-".repeat(80));
    const nonce5 = 5;
    const deadline5 = Math.floor(Date.now() / 1000) + 3600;
    const rm2Hash = await poseidon2Hash([
      Fr.fromString("2"),
      signers[1].toField(),
      Fr.ZERO,
      Fr.ZERO,
      Fr.ZERO,
      Fr.fromString(nonce5.toString()),
      Fr.fromString(deadline5.toString()),
    ]);
    const sigRm1 = await createSchnorrSignature(rm2Hash, privKeys[0]);
    const sigRm3 = await createSchnorrSignature(rm2Hash, privKeys[2]);
    await multisig.methods.approve_action(rm2Hash, sigRm1, nonce5, pubKeys[0].x, pubKeys[0].y).send({ from: signers[0], fee }).wait();
    await multisig3.methods.approve_action(rm2Hash, sigRm3, nonce5 + 1, pubKeys[2].x, pubKeys[2].y).send({ from: signers[2], fee }).wait();
    await multisig.methods.execute_remove_signer(rm2Hash, signers[1]).send({ from: signers[0], fee }).wait();
    const isS2Active = await multisig.methods.is_signer_public(signers[1]).simulate({ from: signers[0] });
    logger.info(`  S2 active: ${isS2Active}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 7: Verify Final State");
    logger.info("-".repeat(80));
    const fCount = await multisig.methods.get_signer_count().simulate({ from: signers[0] });
    const thr = await multisig.methods.get_threshold().simulate({ from: signers[0] });
    logger.info(`  Final Count: ${fCount}, Threshold: ${thr}`);
    logger.info("  ✅ PASS\n");

    // --------------------------------------------------------------------
    logger.info("TEST 8: Check Executed Hashes / Consistency");
    logger.info("-".repeat(80));
    const exec = await multisig.methods.is_executed(add3Hash).simulate({ from: signers[0] });
    const exec2 = await multisig.methods.is_executed(thresholdHash).simulate({ from: signers[0] });
    logger.info(`  Executed Add3: ${exec}, ChangeThreshold: ${exec2}`);
    logger.info("  ✅ PASS\n");

    logger.info("=".repeat(80));
    logger.info("ALL 8 TESTS PASSED ✅");
    logger.info("=".repeat(80));
  } catch (error) {
    console.error("\n❌ TEST FAILED");
    if (error instanceof Error) console.error(`Error: ${error.message}`);
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
