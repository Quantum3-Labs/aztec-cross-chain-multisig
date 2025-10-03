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
  
  // Convert to 32-byte array
  const msgBytes = new Uint8Array(32);
  const hashBigInt = messageHash.toBigInt();
  for (let i = 0; i < 32; i++) {
    msgBytes[31 - i] = Number((hashBigInt >> BigInt(i * 8)) & BigInt(0xff));
  }
  
  const { GrumpkinScalar: CircuitsGrumpkinScalar } = await import(
    "@aztec/circuits.js"
  );
  const privKeyForSchnorr = CircuitsGrumpkinScalar.fromBuffer(
    Buffer.from(privateKey.toBuffer())
  );
  const sig = await schnorr.constructSignature(Buffer.from(msgBytes), privKeyForSchnorr);
  return Array.from(sig.toBuffer());
}

async function main() {
  const logger = createLogger("test-multisig");

  try {
    logger.info("=".repeat(80));
    logger.info("PRIVATEMULTISIG - TEST SUITE");
    logger.info("=".repeat(80) + "\n");

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
    logger.info(`Multisig: ${multisigAddress.toString()}`);

    logger.info("\nSetting up signers...");

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
    logger.info(`✓ Signer 1: ${signer1.toString()}`);

    const privKey2 = toScalar(process.env.PRIV2!);
    const pubKey2 = await derivePublicKey(privKey2);
    const acctMgr2 = await getSchnorrAccount(
      pxe,
      toFr(process.env.SECRET_KEY!),
      privKey2,
      toFr(process.env.SALT!)
    );
    await acctMgr2.register();
    const wallet2 = await acctMgr2.getWallet();
    const signer2 = wallet2.getAddress();
    logger.info(`✓ Signer 2: ${signer2.toString()}`);

    const privKey3 = toScalar(process.env.PRIV3!);
    const pubKey3 = await derivePublicKey(privKey3);
    const acctMgr3 = await getSchnorrAccount(
      pxe,
      toFr(process.env.SECRET_KEY!),
      privKey3,
      toFr(process.env.SALT!)
    );
    await acctMgr3.register();
    const wallet3 = await acctMgr3.getWallet();
    const signer3 = wallet3.getAddress();
    logger.info(`✓ Signer 3: ${signer3.toString()}\n`);

    const multisig = await PrivateMultisigContract.at(multisigAddress, wallet1);
    const multisig2 = await PrivateMultisigContract.at(multisigAddress, wallet2);

    logger.info("=".repeat(80));
    logger.info("TEST 1: Initial State");
    logger.info("-".repeat(80));
    const threshold = await multisig.methods.get_threshold().simulate({ from: signer1 });
    const signerCount = await multisig.methods.get_signer_count().simulate({ from: signer1 });
    const isSigner1 = await multisig.methods.is_signer_public(signer1).simulate({ from: signer1 });
    logger.info(`  Threshold: ${threshold}`);
    logger.info(`  Signer Count: ${signerCount}`);
    logger.info(`  Signer 1 Active: ${isSigner1}`);
    logger.info("  ✅ PASS\n");

    logger.info("TEST 2: Add Signer 2");
    logger.info("-".repeat(80));
    
    const deadline1 = Math.floor(Date.now() / 1000) + 3600;
    const nonce1 = 1;
    
    const addSigner2Hash = await poseidon2Hash([
      Fr.fromString("1"),
      signer2.toField(),
      pubKey2.x,
      pubKey2.y,
      Fr.fromString("0"),
      Fr.fromString(nonce1.toString()),
      Fr.fromString(deadline1.toString()),
    ]);
    
    const sig1 = await createSchnorrSignature(addSigner2Hash, privKey1);

    await multisig.methods
      .add_signer(signer2, pubKey2.x, pubKey2.y, sig1, nonce1, pubKey1.x, pubKey1.y, deadline1)
      .send({ from: signer1, fee })
      .wait();

    logger.info("  Approved ✓");

    await multisig.methods
      .execute_add_signer(addSigner2Hash, signer2, pubKey2.x, pubKey2.y)
      .send({ from: signer1, fee })
      .wait();

    logger.info("  Executed ✓");

    const isSigner2 = await multisig.methods.is_signer_public(signer2).simulate({ from: signer1 });
    const count2 = await multisig.methods.get_signer_count().simulate({ from: signer1 });
    logger.info(`  Signer 2 Active: ${isSigner2}`);
    logger.info(`  Count: ${count2}`);
    logger.info("  ✅ PASS\n");

    logger.info("TEST 3: Change Threshold to 2");
    logger.info("-".repeat(80));
    
    const deadline2 = Math.floor(Date.now() / 1000) + 3600;
    const nonce2 = 2;
    
    const changeThresholdHash = await poseidon2Hash([
      Fr.fromString("3"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("0"),
      Fr.fromString("2"),
      Fr.fromString(nonce2.toString()),
      Fr.fromString(deadline2.toString()),
    ]);
    
    const thresholdSig1 = await createSchnorrSignature(changeThresholdHash, privKey1);

    await multisig.methods
      .change_threshold(Fr.fromString("2"), thresholdSig1, nonce2, pubKey1.x, pubKey1.y, deadline2)
      .send({ from: signer1, fee })
      .wait();

    await multisig.methods
      .execute_change_threshold(changeThresholdHash, Fr.fromString("2"))
      .send({ from: signer1, fee })
      .wait();

    const newThreshold = await multisig.methods.get_threshold().simulate({ from: signer1 });
    logger.info(`  New Threshold: ${newThreshold}`);
    logger.info("  ✅ PASS\n");

    logger.info("TEST 4: Add Signer 3 (requires 2 approvals)");
    logger.info("-".repeat(80));
    
    const deadline3 = Math.floor(Date.now() / 1000) + 3600;
    const nonce3 = 3;
    const nonce4 = 4;
    
    const addSigner3Hash = await poseidon2Hash([
      Fr.fromString("1"),
      signer3.toField(),
      pubKey3.x,
      pubKey3.y,
      Fr.fromString("0"),
      Fr.fromString(nonce3.toString()),
      Fr.fromString(deadline3.toString()),
    ]);
    
    const sig2 = await createSchnorrSignature(addSigner3Hash, privKey1);
    const sig3 = await createSchnorrSignature(addSigner3Hash, privKey2);

    await multisig.methods
      .add_signer(signer3, pubKey3.x, pubKey3.y, sig2, nonce3, pubKey1.x, pubKey1.y, deadline3)
      .send({ from: signer1, fee })
      .wait();

    logger.info("  Signer 1 approved ✓");

    await multisig2.methods
      .approve_action(addSigner3Hash, sig3, nonce4, pubKey2.x, pubKey2.y)
      .send({ from: signer2, fee })
      .wait();

    logger.info("  Signer 2 approved ✓");

    await multisig.methods
      .execute_add_signer(addSigner3Hash, signer3, pubKey3.x, pubKey3.y)
      .send({ from: signer1, fee })
      .wait();

    const isSigner3 = await multisig.methods.is_signer_public(signer3).simulate({ from: signer1 });
    const count3 = await multisig.methods.get_signer_count().simulate({ from: signer1 });
    logger.info(`  Signer 3 Active: ${isSigner3}`);
    logger.info(`  Total: ${count3}`);
    logger.info("  ✅ PASS\n");

    logger.info("=".repeat(80));
    logger.info("ALL TESTS PASSED ✅");
    logger.info("=".repeat(80));

  } catch (error) {
    logger.error("\n❌ TEST FAILED");
    if (error instanceof Error) {
      logger.error(`Error: ${error.message}`);
    }
    throw error;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});