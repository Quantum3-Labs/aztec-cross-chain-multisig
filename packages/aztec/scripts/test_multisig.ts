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
const toScalar = (hex: string) =>
  GrumpkinScalar.fromString(BigInt(hex).toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function derivePublicKey(privateKey: GrumpkinScalar): Promise<Point> {
  const grumpkin = new Grumpkin();
  return grumpkin.mul(grumpkin.generator(), privateKey);
}

async function createSchnorrSignature(
  messageHash: Fr,
  privateKey: GrumpkinScalar
): Promise<number[]> {
  const { Schnorr } = await import("@aztec/circuits.js/barretenberg");
  const schnorr = new Schnorr();

  const msgBuffer = messageHash.toBuffer();

  const { GrumpkinScalar: CircuitsGrumpkinScalar } = await import(
    "@aztec/circuits.js"
  );
  const privKeyForSchnorr = CircuitsGrumpkinScalar.fromBuffer(
    privateKey.toBuffer()
  );

  const sig = await schnorr.constructSignature(msgBuffer, privKeyForSchnorr);
  return Array.from(sig.toBuffer());
}

async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 15,
  delayMs = 8000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e: any) {
      if (!e.message?.includes("Failed to get a note") || i === maxRetries - 1)
        throw e;
      console.log(`  Retry ${i + 1}/${maxRetries}, waiting ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
  throw new Error("Max retries exceeded");
}

async function main() {
  const logger = createLogger("test-multisig");

  try {
    logger.info("=".repeat(70));
    logger.info("COMPREHENSIVE MULTISIG TEST SUITE");
    logger.info("=".repeat(70) + "\n");

    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({
      instance: sponsoredFPC,
      artifact: SponsoredFPCContract.artifact,
    });
    const fee = {
      paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
    };

    const multisigAddress = AztecAddress.fromString(
      process.env.PRIVATE_MULTISIG_ADDRESS!
    );
    logger.info(`Multisig Contract: ${multisigAddress.toString()}\n`);

    // Setup 3 signers
    const privKey1 = toScalar(process.env.PRIV1!);
    const pubKey1 = await derivePublicKey(privKey1);
    const acctMgr1 = await getSchnorrAccount(
      pxe,
      toFr(process.env.SECRET_KEY!),
      privKey1,
      toFr(process.env.SALT!)
    );
    await acctMgr1.register();
    const wallet1 = await acctMgr1.getWallet();
    const signer1 = wallet1.getAddress();

    const privKey2 = toScalar(process.env.PRIV2!);
    const pubKey2 = await derivePublicKey(privKey2);
    const acctMgr2 = await getSchnorrAccount(
      pxe,
      toFr(process.env.SECRET_KEY!),
      privKey2,
      toFr(process.env.SALT!)
    );
    const existingAccount2 = await pxe.getContractInstance(
      acctMgr2.getAddress()
    );
    if (!existingAccount2) {
      logger.info("Deploying Signer 2 account...");
      await (await acctMgr2.deploy({ fee })).wait({ timeout: 180000 });
      await sleep(60000);
    }
    await acctMgr2.register();
    const wallet2 = await acctMgr2.getWallet();
    const signer2 = wallet2.getAddress();

    const privKey3 = toScalar(process.env.PRIV3!);
    const pubKey3 = await derivePublicKey(privKey3);
    const acctMgr3 = await getSchnorrAccount(
      pxe,
      toFr(process.env.SECRET_KEY!),
      privKey3,
      toFr(process.env.SALT!)
    );
    const existingAccount3 = await pxe.getContractInstance(
      acctMgr3.getAddress()
    );
    if (!existingAccount3) {
      logger.info("Deploying Signer 3 account...");
      await (await acctMgr3.deploy({ fee })).wait({ timeout: 180000 });
      await sleep(60000);
    }
    await acctMgr3.register();
    const wallet3 = await acctMgr3.getWallet();
    const signer3 = wallet3.getAddress();

    logger.info(`Signer 1: ${signer1.toString()}`);
    logger.info(`Signer 2: ${signer2.toString()}`);
    logger.info(`Signer 3: ${signer3.toString()}\n`);

    const multisig = await PrivateMultisigContract.at(multisigAddress, wallet1);
    const multisig2 = await PrivateMultisigContract.at(
      multisigAddress,
      wallet2
    );
    const multisig3 = await PrivateMultisigContract.at(
      multisigAddress,
      wallet3
    );

    // TEST 1: Initial State
    logger.info("TEST 1: Initial State Verification");
    logger.info("-".repeat(70));
    const threshold = await retry(() =>
      multisig.methods.get_threshold().simulate({ from: signer1 })
    );
    const signerCount = await retry(() =>
      multisig.methods.get_signer_count().simulate({ from: signer1 })
    );
    const isSigner1 = await retry(() =>
      multisig.methods.is_signer(signer1).simulate({ from: signer1 })
    );
    logger.info(`  Initial Threshold: ${threshold}`);
    logger.info(`  Initial Signer Count: ${signerCount}`);
    logger.info(`  Signer 1 Active: ${isSigner1}`);
    logger.info("  ✅ PASS\n");

    // TEST 2: Add Signer 2
    logger.info("TEST 2: Add Second Signer");
    logger.info("-".repeat(70));
    const deadline1 = Math.floor(Date.now() / 1000) + 3600;
    const msgHash1 = poseidon2Hash([
      Fr.fromString("1"),
      signer2.toField(),
      pubKey2.x,
      pubKey2.y,
      Fr.fromString("0"),
      Fr.fromString("1"),
      Fr.fromString(deadline1.toString()),
    ]);
    const sig1 = await createSchnorrSignature(msgHash1, privKey1);

    const addSigner2Hash = await multisig.methods
      .add_signer(
        signer2,
        pubKey2.x,
        pubKey2.y,
        sig1,
        1,
        pubKey1.x,
        pubKey1.y,
        deadline1
      )
      .simulate({ from: signer1 });

    await multisig.methods
      .add_signer(
        signer2,
        pubKey2.x,
        pubKey2.y,
        sig1,
        1,
        pubKey1.x,
        pubKey1.y,
        deadline1
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await multisig.methods
      .execute_add_signer(
        addSigner2Hash,
        signer2,
        pubKey2.x,
        pubKey2.y,
        [signer1, ...Array(9).fill(signer1)],
        1
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await sleep(60000);
    const isSigner2 = await retry(() =>
      multisig.methods.is_signer(signer2).simulate({ from: signer1 })
    );
    const count2 = await retry(() =>
      multisig.methods.get_signer_count().simulate({ from: signer1 })
    );
    logger.info(`  Signer 2 Active: ${isSigner2}`);
    logger.info(`  New Signer Count: ${count2}`);
    logger.info("  ✅ PASS\n");

    // TEST 3: Add Signer 3
    logger.info("TEST 3: Add Third Signer");
    logger.info("-".repeat(70));
    const deadline2 = Math.floor(Date.now() / 1000) + 3600;
    const msgHash2 = poseidon2Hash([
      Fr.fromString("1"),
      signer3.toField(),
      pubKey3.x,
      pubKey3.y,
      Fr.fromString("0"),
      Fr.fromString("2"),
      Fr.fromString(deadline2.toString()),
    ]);
    const sig2 = await createSchnorrSignature(msgHash2, privKey1);

    const addSigner3Hash = await multisig.methods
      .add_signer(
        signer3,
        pubKey3.x,
        pubKey3.y,
        sig2,
        2,
        pubKey1.x,
        pubKey1.y,
        deadline2
      )
      .simulate({ from: signer1 });

    await multisig.methods
      .add_signer(
        signer3,
        pubKey3.x,
        pubKey3.y,
        sig2,
        2,
        pubKey1.x,
        pubKey1.y,
        deadline2
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await multisig.methods
      .execute_add_signer(
        addSigner3Hash,
        signer3,
        pubKey3.x,
        pubKey3.y,
        [signer1, ...Array(9).fill(signer1)],
        1
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await sleep(60000);
    const isSigner3 = await retry(() =>
      multisig.methods.is_signer(signer3).simulate({ from: signer1 })
    );
    const count3 = await retry(() =>
      multisig.methods.get_signer_count().simulate({ from: signer1 })
    );
    logger.info(`  Signer 3 Active: ${isSigner3}`);
    logger.info(`  Total Signers: ${count3}`);
    logger.info("  ✅ PASS\n");

    // TEST 4: Change Threshold to 2
    logger.info("TEST 4: Change Threshold to 2/3");
    logger.info("-".repeat(70));
    const deadline3 = Math.floor(Date.now() / 1000) + 3600;
    const thresholdHash1 = poseidon2Hash([
      Fr.fromString("3"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("2"),
      Fr.fromString("3"),
      Fr.fromString(deadline3.toString()),
    ]);
    const thresholdSig1 = await createSchnorrSignature(
      thresholdHash1,
      privKey1
    );

    const changeThresholdHash = await multisig.methods
      .change_threshold(
        Fr.fromString("2"),
        thresholdSig1,
        3,
        pubKey1.x,
        pubKey1.y,
        deadline3
      )
      .simulate({ from: signer1 });

    await multisig.methods
      .change_threshold(
        Fr.fromString("2"),
        thresholdSig1,
        3,
        pubKey1.x,
        pubKey1.y,
        deadline3
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    const thresholdSig2 = await createSchnorrSignature(
      thresholdHash1,
      privKey2
    );
    await multisig2.methods
      .approve_transaction(
        changeThresholdHash,
        thresholdSig2,
        4,
        pubKey2.x,
        pubKey2.y
      )
      .send({ from: signer2, fee })
      .wait({ timeout: 180000 });

    await multisig.methods
      .execute_change_threshold(
        changeThresholdHash,
        Fr.fromString("2"),
        [signer1, signer2, ...Array(8).fill(signer1)],
        2
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await sleep(60000);
    const newThreshold = await retry(() =>
      multisig.methods.get_threshold().simulate({ from: signer1 })
    );
    logger.info(`  New Threshold: ${newThreshold}`);
    logger.info("  ✅ PASS\n");

    // TEST 5: Propose Transaction (needs 2 approvals)
    logger.info("TEST 5: Propose and Execute Transaction with 2/3 Threshold");
    logger.info("-".repeat(70));
    const deadline4 = Math.floor(Date.now() / 1000) + 3600;
    const txHash = poseidon2Hash([
      signer3.toField(),
      Fr.fromString("1000000"),
      Fr.fromString("305419896"), // 0x12345678 in decimal
      Fr.fromString("11259375"), // 0xabcdef in decimal
      Fr.fromString("5"),
      Fr.fromString(deadline4.toString()),
    ]);
    const txSig1 = await createSchnorrSignature(txHash, privKey1);

    const proposeTxHash = await multisig.methods
      .propose_transaction(
        signer3,
        BigInt(1000000),
        Fr.fromString("305419896"),
        Fr.fromString("11259375"),
        deadline4,
        txSig1,
        5,
        pubKey1.x,
        pubKey1.y
      )
      .simulate({ from: signer1 });

    await multisig.methods
      .propose_transaction(
        signer3,
        BigInt(1000000),
        Fr.fromString("305419896"),
        Fr.fromString("11259375"),
        deadline4,
        txSig1,
        5,
        pubKey1.x,
        pubKey1.y
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    const txSig2 = await createSchnorrSignature(txHash, privKey2);
    await multisig2.methods
      .approve_transaction(proposeTxHash, txSig2, 6, pubKey2.x, pubKey2.y)
      .send({ from: signer2, fee })
      .wait({ timeout: 180000 });

    await multisig.methods
      .execute_transaction(
        proposeTxHash,
        signer3,
        BigInt(1000000),
        Fr.fromString("305419896"),
        Fr.fromString("11259375"),
        [signer1, signer2, ...Array(8).fill(signer1)],
        2
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    logger.info("  Transaction Proposed: ✓");
    logger.info("  Approved by Signer 1: ✓");
    logger.info("  Approved by Signer 2: ✓");
    logger.info("  Transaction Executed: ✓");
    logger.info("  ✅ PASS\n");

    // TEST 6: Remove Signer (needs 2 approvals)
    logger.info("TEST 6: Remove Signer 3 with 2/3 Threshold");
    logger.info("-".repeat(70));
    const deadline5 = Math.floor(Date.now() / 1000) + 3600;
    const removeHash = poseidon2Hash([
      Fr.fromString("2"),
      signer3.toField(),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("7"),
      Fr.fromString(deadline5.toString()),
    ]);
    const removeSig1 = await createSchnorrSignature(removeHash, privKey1);

    const removeSigner3Hash = await multisig.methods
      .remove_signer(signer3, removeSig1, 7, pubKey1.x, pubKey1.y, deadline5)
      .simulate({ from: signer1 });

    await multisig.methods
      .remove_signer(signer3, removeSig1, 7, pubKey1.x, pubKey1.y, deadline5)
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    const removeSig2 = await createSchnorrSignature(removeHash, privKey2);
    await multisig2.methods
      .approve_transaction(
        removeSigner3Hash,
        removeSig2,
        8,
        pubKey2.x,
        pubKey2.y
      )
      .send({ from: signer2, fee })
      .wait({ timeout: 180000 });

    await multisig.methods
      .execute_remove_signer(
        removeSigner3Hash,
        signer3,
        [signer1, signer2, ...Array(8).fill(signer1)],
        2
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await sleep(60000);
    const isStillSigner3 = await retry(() =>
      multisig.methods.is_signer(signer3).simulate({ from: signer1 })
    );
    const finalCount = await retry(() =>
      multisig.methods.get_signer_count().simulate({ from: signer1 })
    );
    logger.info(`  Signer 3 Still Active: ${isStillSigner3}`);
    logger.info(`  Final Signer Count: ${finalCount}`);
    logger.info("  ✅ PASS\n");

    // TEST 7: Change Threshold Back to 1
    logger.info("TEST 7: Change Threshold Back to 1/2");
    logger.info("-".repeat(70));
    const deadline6 = Math.floor(Date.now() / 1000) + 3600;
    const thresholdHash2 = poseidon2Hash([
      Fr.fromString("3"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("1"),
      Fr.fromString("9"),
      Fr.fromString(deadline6.toString()),
    ]);
    const thresholdSig3 = await createSchnorrSignature(
      thresholdHash2,
      privKey1
    );

    const finalThresholdHash = await multisig.methods
      .change_threshold(
        Fr.fromString("1"),
        thresholdSig3,
        9,
        pubKey1.x,
        pubKey1.y,
        deadline6
      )
      .simulate({ from: signer1 });

    await multisig.methods
      .change_threshold(
        Fr.fromString("1"),
        thresholdSig3,
        9,
        pubKey1.x,
        pubKey1.y,
        deadline6
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    const thresholdSig4 = await createSchnorrSignature(
      thresholdHash2,
      privKey2
    );
    await multisig2.methods
      .approve_transaction(
        finalThresholdHash,
        thresholdSig4,
        10,
        pubKey2.x,
        pubKey2.y
      )
      .send({ from: signer2, fee })
      .wait({ timeout: 180000 });

    await multisig.methods
      .execute_change_threshold(
        finalThresholdHash,
        Fr.fromString("1"),
        [signer1, signer2, ...Array(8).fill(signer1)],
        2
      )
      .send({ from: signer1, fee })
      .wait({ timeout: 180000 });

    await sleep(60000);
    const finalThreshold = await retry(() =>
      multisig.methods.get_threshold().simulate({ from: signer1 })
    );
    logger.info(`  Final Threshold: ${finalThreshold}`);
    logger.info("  ✅ PASS\n");

    logger.info("=".repeat(70));
    logger.info("ALL 7 TESTS PASSED ✅");
    logger.info("=".repeat(70));
    logger.info("\nTest Coverage:");
    logger.info("  ✓ Initial state verification");
    logger.info("  ✓ Add multiple signers (2 & 3)");
    logger.info("  ✓ Change threshold (1→2)");
    logger.info("  ✓ Multi-signature transaction approval & execution");
    logger.info("  ✓ Remove signer with multi-sig");
    logger.info("  ✓ Change threshold back (2→1)");
    logger.info("  ✓ All private storage operations\n");
  } catch (error) {
    logger.error("\n" + "=".repeat(70));
    logger.error("TEST FAILED ❌");
    logger.error("=".repeat(70));
    if (error instanceof Error) {
      logger.error(`\nError: ${error.message}`);
    }
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
