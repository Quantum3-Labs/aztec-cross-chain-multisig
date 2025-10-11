import "dotenv/config";
import { Fr, AztecAddress, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";
import { poseidon2Hash } from "@aztec/foundation/crypto";

const log = createLogger("multisig-crosschain-test");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());

async function schnorrSig(messageHash: Fr, privateKey: GrumpkinScalar): Promise<number[]> {
  const { Schnorr } = await import("@aztec/circuits.js/barretenberg");
  const { GrumpkinScalar: CircuitsGrumpkinScalar } = await import("@aztec/circuits.js");
  const schnorr = new Schnorr();
  const msgBytes = new Uint8Array(32);
  const h = messageHash.toBigInt();
  for (let i = 0; i < 32; i++) msgBytes[31 - i] = Number((h >> BigInt(i * 8)) & BigInt(0xff));
  const sk = CircuitsGrumpkinScalar.fromBuffer(Buffer.from(toScalar(privateKey.toString()).toBuffer()));
  const sig = await schnorr.constructSignature(Buffer.from(msgBytes), sk);
  return Array.from(sig.toBuffer());
}

function toBytes32Address(addr: string) {
  const a = addr.toLowerCase();
  if (!a.startsWith("0x") || a.length !== 42) throw new Error("invalid evm address");
  return "0x" + "0".repeat(24) + a.slice(2);
}

function emsg(e: any) {
  return e?.originalMessage || e?.cause?.message || e?.message || String(e);
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  log.info(`STEP ${name} - START`);
  try {
    const r = await fn();
    log.info(`STEP ${name} - PASS`);
    return r;
  } catch (e: any) {
    const msg = e?.cause?.message || e?.message || String(e);
    log.error(`STEP ${name} - FAIL`);
    log.error(msg);
    throw e;
  }
}

async function main() {
  await step("PXE_START", async () => {
    const pxe = await setupPXE();
    const sponsoredFPC = await getSponsoredFPCInstance();
    await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
    const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
    log.info(`PXE OK | SponsoredFPC=${sponsoredFPC.address.toString()}`);
  });

  const pxe = await setupPXE();
  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const secret = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);

  const privDeployer = toScalar(process.env.PRIV_DEPLOYER!);
  const priv1 = toScalar(process.env.PRIV1!);
  const priv2 = toScalar(process.env.PRIV2!);
  const priv3 = toScalar(process.env.PRIV3!);

  const acc0 = await getSchnorrAccount(pxe, secret, privDeployer, salt);
  const acc1 = await getSchnorrAccount(pxe, secret, priv1, salt);
  const acc2 = await getSchnorrAccount(pxe, secret, priv2, salt);
  const acc3 = await getSchnorrAccount(pxe, secret, priv3, salt);
  await Promise.all([acc0.register(), acc1.register(), acc2.register(), acc3.register()]);

  const w0 = await acc0.getWallet();
  const w1 = await acc1.getWallet();
  const w2 = await acc2.getWallet();
  const w3 = await acc3.getWallet();
  const a0 = await w0.getAddress();
  const a1 = await w1.getAddress();
  const a2 = await w2.getAddress();
  const a3 = await w3.getAddress();

  await step("ACCOUNTS_INIT", async () => {
    log.info("===========================================================================");
    log.info("ACCOUNTS");
    log.info("---------------------------------------------------------------------------");
    log.info(`Deployer: ${a0.toString()}`);
    log.info(`Signer1 : ${a1.toString()}`);
    log.info(`Signer2 : ${a2.toString()}`);
    log.info(`Signer3 : ${a3.toString()}`);
    log.info("===========================================================================");
  });

  const multisigAddress = AztecAddress.fromString(process.env.PRIVATE_MULTISIG_ADDRESS!);
  const c0 = await PrivateMultisigContract.at(multisigAddress, w0);
  const c1 = await PrivateMultisigContract.at(multisigAddress, w1);
  const c2 = await PrivateMultisigContract.at(multisigAddress, w2);
  const c3 = await PrivateMultisigContract.at(multisigAddress, w3);
  const inst = await pxe.getContractInstance(multisigAddress);
  if (!inst) throw new Error("PXE has no instance for PrivateMultisig");
  await pxe.registerContract({ instance: inst, artifact: PrivateMultisigContract.artifact });

  await step("CONTRACT_BIND", async () => {
    const thr = await c1.methods.get_threshold().simulate({ from: a1 });
    const cnt = await c1.methods.get_signer_count().simulate({ from: a1 });
    const nonce = await c1.methods.get_cross_chain_nonce().simulate({ from: a1 });

    const whChainIdArb = Fr.fromString(process.env.WH_CHAIN_ID_ARB || "10003");
    const arbVault32 = Fr.fromString(BigInt(toBytes32Address(process.env.ARBITRUM_INTENT_VAULT!)).toString());
    const recipient32 = Fr.fromString(BigInt(toBytes32Address(process.env.DONATION_RECEIVER!)).toString());

    const s0Public = await c1.methods.is_signer_public(a0).simulate({ from: a1 });
    const s1Public = await c1.methods.is_signer_public(a1).simulate({ from: a1 });
    const s2Public = await c1.methods.is_signer_public(a2).simulate({ from: a1 });
    const s3Public = await c1.methods.is_signer_public(a3).simulate({ from: a1 });

    log.info("===========================================================================");
    log.info("CONTRACT INFO");
    log.info("---------------------------------------------------------------------------");
    log.info(`Address           : ${multisigAddress.toString()}`);
    log.info(`Threshold         : ${thr.toString()}`);
    log.info(`SignerCount       : ${cnt.toString()}`);
    log.info(`CrossChainNonce   : ${nonce.toString()}`);
    log.info(`WormholeCore(AZ)  : ${process.env.WORMHOLE_ADDRESS}`);
    log.info(`WormholeChainId   : ${Fr.fromString(process.env.WH_CHAIN_ID_ARB || "10003").toString()} (ARB)`);
    log.info(`ArbitrumVault(32) : ${AztecAddress.fromField(arbVault32).toString()}`);
    log.info(`Recipient(32)     : ${AztecAddress.fromField(recipient32).toString()}`);
    log.info("---------------------------------------------------------------------------");
    log.info("SIGNERS (Init snapshot)");
    log.info(`DEP ${a0.toString()} | active=${s0Public} | pk=(${process.env.PUB_DEPLOYER_X}, ${process.env.PUB_DEPLOYER_Y})`);
    log.info(`S1  ${a1.toString()} | active=${s1Public} | pk=(${process.env.PUB1_X}, ${process.env.PUB1_Y})`);
    log.info(`S2  ${a2.toString()} | active=${s2Public} | pk=(${process.env.PUB2_X}, ${process.env.PUB2_Y})`);
    log.info(`S3  ${a3.toString()} | active=${s3Public} | pk=(${process.env.PUB3_X}, ${process.env.PUB3_Y})`);
    log.info("===========================================================================");
  });

  const RUN_NONCE_BASE = Number(BigInt.asUintN(32, BigInt(Date.now())));
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  await step("ADD_SIGNER_2", async () => {
    const already = await c1.methods.is_signer_public(a2).simulate({ from: a1 });
    if (already) {
      log.info("Signer 2 already exists. SKIP.");
      return;
    }

    const pub2x = Fr.fromString(process.env.PUB2_X!);
    const pub2y = Fr.fromString(process.env.PUB2_Y!);
    const nonceAdd2 = RUN_NONCE_BASE + 1;
    const add2Hash = await poseidon2Hash([
      Fr.fromString("1"),
      a2.toField(),
      pub2x,
      pub2y,
      Fr.ZERO,
      Fr.fromString(nonceAdd2.toString()),
      Fr.fromString(deadline.toString()),
    ]);

    const sig1 = await schnorrSig(add2Hash, priv1);
    const sig3 = await schnorrSig(add2Hash, priv3);

    const t1 = await c1.methods
      .approve_action(add2Hash, sig1, nonceAdd2, Fr.fromString(process.env.PUB1_X!), Fr.fromString(process.env.PUB1_Y!))
      .send({ from: a1, fee });
    await t1.wait({ timeout: 240_000 });

    const t2 = await c3.methods
      .approve_action(add2Hash, sig3, nonceAdd2 + 1, Fr.fromString(process.env.PUB3_X!), Fr.fromString(process.env.PUB3_Y!))
      .send({ from: a3, fee });
    await t2.wait({ timeout: 240_000 });

    const t3 = await c1.methods.execute_add_signer(add2Hash, a2, pub2x, pub2y).send({ from: a1, fee });
    await t3.wait({ timeout: 240_000 });

    const active = await c1.methods.is_signer_public(a2).simulate({ from: a1 });
    log.info(`Signer 2 active=${active}`);
  });

  await step("ADD_SIGNER_3", async () => {
    const already = await c1.methods.is_signer_public(a3).simulate({ from: a1 });
    if (already) {
      log.info("Signer 3 already exists. SKIP.");
      return;
    }

    const pub3x = Fr.fromString(process.env.PUB3_X!);
    const pub3y = Fr.fromString(process.env.PUB3_Y!);
    const nonceAdd3 = RUN_NONCE_BASE + 2;
    const add3Hash = await poseidon2Hash([
      Fr.fromString("1"),
      a3.toField(),
      pub3x,
      pub3y,
      Fr.ZERO,
      Fr.fromString(nonceAdd3.toString()),
      Fr.fromString(deadline.toString()),
    ]);

    const sig1 = await schnorrSig(add3Hash, priv1);
    const sig3 = await schnorrSig(add3Hash, priv3);

    const t1 = await c1.methods
      .approve_action(add3Hash, sig1, nonceAdd3, Fr.fromString(process.env.PUB1_X!), Fr.fromString(process.env.PUB1_Y!))
      .send({ from: a1, fee });
    await t1.wait({ timeout: 240_000 });

    const t2 = await c3.methods
      .approve_action(add3Hash, sig3, nonceAdd3 + 1, Fr.fromString(process.env.PUB3_X!), Fr.fromString(process.env.PUB3_Y!))
      .send({ from: a3, fee });
    await t2.wait({ timeout: 240_000 });

    const t3 = await c1.methods.execute_add_signer(add3Hash, a3, pub3x, pub3y).send({ from: a1, fee });
    await t3.wait({ timeout: 240_000 });

    const active = await c1.methods.is_signer_public(a3).simulate({ from: a1 });
    log.info(`Signer 3 active=${active}`);
  });

  await step("CHANGE_THRESHOLD_TO_2", async () => {
    const curThr = await c1.methods.get_threshold().simulate({ from: a1 });
    if (curThr.toString() === "2") {
      log.info("Threshold already 2. SKIP.");
      return;
    }

    const newThr = Fr.fromString("2");
    const pub1x = Fr.fromString(process.env.PUB1_X!);
    const pub1y = Fr.fromString(process.env.PUB1_Y!);
    const pub2x = Fr.fromString(process.env.PUB2_X!);
    const pub2y = Fr.fromString(process.env.PUB2_Y!);

    const nonceThr1 = RUN_NONCE_BASE + 3;
    const thrHash = await poseidon2Hash([
      Fr.fromString("3"),
      Fr.ZERO,
      Fr.ZERO,
      Fr.ZERO,
      newThr,
      Fr.fromString(nonceThr1.toString()),
      Fr.fromString(deadline.toString()),
    ]);
    const sigThr1 = await schnorrSig(thrHash, priv1);
    const sigThr2 = await schnorrSig(thrHash, priv2);

    const t1 = await c1.methods
      .approve_action(thrHash, sigThr1, nonceThr1, pub1x, pub1y)
      .send({ from: a1, fee });
    await t1.wait({ timeout: 240_000 });

    const t2 = await c2.methods
      .approve_action(thrHash, sigThr2, nonceThr1 + 1, pub2x, pub2y)
      .send({ from: a2, fee });
    await t2.wait({ timeout: 240_000 });

    const t3 = await c1.methods.execute_change_threshold(thrHash, newThr).send({ from: a1, fee });
    await t3.wait({ timeout: 240_000 });
  });

  await step("REMOVE_SIGNER_2", async () => {
    const stillSigner = await c1.methods.is_signer_public(a2).simulate({ from: a1 });
    if (!stillSigner) {
      log.info("Signer 2 already removed. SKIP.");
      return;
    }

    const pub1x = Fr.fromString(process.env.PUB1_X!);
    const pub1y = Fr.fromString(process.env.PUB1_Y!);
    const pub3x = Fr.fromString(process.env.PUB3_X!);
    const pub3y = Fr.fromString(process.env.PUB3_Y!);

    const nonceRm = RUN_NONCE_BASE + 4;
    const rmHash = await poseidon2Hash([
      Fr.fromString("2"),
      a2.toField(),
      Fr.ZERO,
      Fr.ZERO,
      Fr.ZERO,
      Fr.fromString(nonceRm.toString()),
      Fr.fromString(deadline.toString()),
    ]);
    const sigRm1 = await schnorrSig(rmHash, priv1);
    const sigRm3 = await schnorrSig(rmHash, priv3);

    const t1 = await c1.methods
      .approve_action(rmHash, sigRm1, nonceRm, pub1x, pub1y)
      .send({ from: a1, fee });
    await t1.wait({ timeout: 240_000 });

    const t2 = await c3.methods
      .approve_action(rmHash, sigRm3, nonceRm + 1, pub3x, pub3y)
      .send({ from: a3, fee });
    await t2.wait({ timeout: 240_000 });

    const t3 = await c1.methods.execute_remove_signer(rmHash, a2).send({ from: a1, fee });
    await t3.wait({ timeout: 240_000 });
  });

  await step("CROSS_CHAIN_INTENT", async () => {
    const whChainIdArb = Fr.fromString(process.env.WH_CHAIN_ID_ARB || "10003");
    const arbVault32 = Fr.fromString(BigInt(toBytes32Address(process.env.ARBITRUM_INTENT_VAULT!)).toString());
    const recipient32 = Fr.fromString(BigInt(toBytes32Address(process.env.DONATION_RECEIVER!)).toString());
    const intentType = Fr.fromString("1");
    const amount = Fr.fromString((10n ** 18n).toString());

    const nonceX = RUN_NONCE_BASE + 5;
    const xHash = await poseidon2Hash([
      Fr.fromString("6"),
      whChainIdArb,
      AztecAddress.fromField(arbVault32).toField(),
      intentType,
      amount,
      AztecAddress.fromField(recipient32).toField(),
      Fr.fromString(nonceX.toString()),
      Fr.fromString(deadline.toString()),
    ]);

    const sigX1 = await schnorrSig(xHash, priv1);
    const sigX3 = await schnorrSig(xHash, priv3);

    const t1 = await c1.methods
      .propose_cross_chain_intent(
        whChainIdArb,
        AztecAddress.fromField(arbVault32),
        intentType,
        amount,
        AztecAddress.fromField(recipient32),
        sigX1,
        nonceX,
        Fr.fromString(process.env.PUB1_X!),
        Fr.fromString(process.env.PUB1_Y!),
        BigInt(deadline)
      )
      .send({ from: a1, fee });
    await t1.wait({ timeout: 240_000 });

    const t2 = await c3.methods
      .approve_action(
        xHash,
        sigX3,
        nonceX + 1,
        Fr.fromString(process.env.PUB3_X!),
        Fr.fromString(process.env.PUB3_Y!)
      )
      .send({ from: a3, fee });
    await t2.wait({ timeout: 240_000 });

    const providedNonce = Number(await c1.methods.get_cross_chain_nonce().simulate({ from: a1 }));
    const t3 = await c1.methods
      .execute_cross_chain_intent(
        providedNonce,
        xHash,
        Fr.fromString(process.env.WH_CHAIN_ID_ARB || "10003"),
        AztecAddress.fromField(arbVault32),
        intentType,
        amount,
        AztecAddress.fromField(recipient32)
      )
      .send({ from: a1, fee });
    await t3.wait({ timeout: 300_000 });
  });

  const thrNow = await c1.methods.get_threshold().simulate({ from: a1 });
  const scNow = await c1.methods.get_signer_count().simulate({ from: a1 });
  const nonceNow = await c1.methods.get_cross_chain_nonce().simulate({ from: a1 });

  log.info("===========================================================================");
  log.info("FINAL STATE");
  log.info("---------------------------------------------------------------------------");
  log.info(`Threshold=${thrNow.toString()}  SignerCount=${scNow.toString()}  CrossChainNonce=${nonceNow.toString()}`);
  log.info("===========================================================================");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
