import "dotenv/config";
import { 
  AztecAddress, 
  Fr, 
  createLogger, 
  TxStatus,
} from "@aztec/aztec.js";
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

async function generateSchnorrSignature(
  messageHash: Fr,
  privateKey: GrumpkinScalar
): Promise<number[]> {
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
    const wallet = await acctMgr.getWallet();
    return { wallet, privateKey: priv };
  } catch (e) {
    await (await acctMgr.deploy({ fee })).wait({ timeout: 180 });
    await acctMgr.register();
    const wallet = await acctMgr.getWallet();
    return { wallet, privateKey: priv };
  }
}

async function computeTransactionIntentHash(
  to: AztecAddress,
  amount: bigint,
  function_selector: Fr,
  data_hash: Fr,
  nonce: number,
  deadline: bigint
): Promise<Fr> {
  const fields = [
    to.toField(),
    new Fr(amount),
    function_selector,
    data_hash,
    new Fr(BigInt(nonce)),
    new Fr(deadline)
  ];
  
  return await poseidon2Hash(fields);
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
  const fields = [
    new Fr(BigInt(operation_type)),
    target_address.toField(),
    pubkey_x,
    pubkey_y,
    new Fr(BigInt(new_threshold)),
    new Fr(BigInt(nonce)),
    new Fr(deadline)
  ];
  
  return await poseidon2Hash(fields);
}

async function main() {
  const logger = createLogger("test-multisig-flow");
  
  logger.info("=== SETUP ===");
  const pxe = await setupPXE();
  const sponsoredFPC = await getSponsoredFPCInstance();
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const contractAddress = AztecAddress.fromString(process.env.PRIVATE_MULTISIG_ADDRESS!);
  
  logger.info("Setting up accounts...");
  const { wallet: wallet1, privateKey: priv1 } = await getOrDeployAccount(pxe, "PRIV1", fee);
  const { wallet: wallet2, privateKey: priv2 } = await getOrDeployAccount(pxe, "PRIV2", fee);
  const { wallet: wallet3, privateKey: priv3 } = await getOrDeployAccount(pxe, "PRIV3", fee);
  logger.info("✓ All accounts ready");

  const contract = await PrivateMultisigContract.at(contractAddress, wallet1);
  
  const addr1 = wallet1.getAddress();
  const addr2 = wallet2.getAddress();
  const addr3 = wallet3.getAddress();

  const pub1X = toFr(process.env.PUB1_X!);
  const pub1Y = toFr(process.env.PUB1_Y!);
  const pub2X = toFr(process.env.PUB2_X!);
  const pub2Y = toFr(process.env.PUB2_Y!);
  const pub3X = toFr(process.env.PUB3_X!);
  const pub3Y = toFr(process.env.PUB3_Y!);

  logger.info(`Contract: ${contractAddress.toString()}`);
  logger.info(`Signer 1: ${addr1.toString()}`);
  logger.info(`Signer 2: ${addr2.toString()}`);
  logger.info(`Signer 3: ${addr3.toString()}`);

  logger.info("\n=== INITIAL CONFIG ===");
  const config = await contract.methods.get_multisig_config().simulate({ from: addr1 });
  logger.info(`Threshold: ${config[0]}`);
  logger.info(`Signer Count: ${config[1]}`);
  logger.info(`TX Nonce: ${config[2]}`);

  const signer1Info = await contract.methods.get_signer_info(addr1).simulate({ from: addr1 });
  const signer1Nonce = Number(signer1Info[3]);
  logger.info(`Signer 1 nonce: ${signer1Nonce}`);

  logger.info("\n=== TEST 1: ADD SIGNER 2 ===");
  const deadline1 = BigInt(Date.now() + 3600000);
  const addSigner2Hash = await computeManagementIntentHash(
    1, addr2, pub2X, pub2Y, 0, signer1Nonce + 1000, deadline1
  );
  
  const addSigner2Sig = await generateSchnorrSignature(addSigner2Hash, priv1);
  
  const addSigner2TxSent = contract.withWallet(wallet1).methods
    .add_signer(addr2, pub2X, pub2Y, addSigner2Sig, signer1Nonce, pub1X, pub1Y, deadline1)
    .send({ from: addr1, fee });

  const addSigner2Tx = await addSigner2TxSent.wait({ timeout: 120 });
  
  logger.info(`✓ Add signer 2: ${addSigner2Tx.txHash.toString()}`);
  logger.info(`  Status: ${addSigner2Tx.status === TxStatus.SUCCESS ? 'SUCCESS' : 'FAILED'}`);

  if (addSigner2Tx.status !== TxStatus.SUCCESS) {
    logger.error("Transaction failed");
    process.exit(1);
  }

  await new Promise(resolve => setTimeout(resolve, 5000));

  const signer2Info = await contract.methods.get_signer_info(addr2).simulate({ from: addr1 });
  logger.info(`  Signer 2 authorized: ${signer2Info[0]}`);

  logger.info("\n=== TEST 2: CHANGE THRESHOLD TO 2 ===");
  const signer1InfoUpdated = await contract.methods.get_signer_info(addr1).simulate({ from: addr1 });
  const signer1NonceUpdated = Number(signer1InfoUpdated[3]);

  const deadline2 = BigInt(Date.now() + 3600000);
  const changeThresholdHash = await computeManagementIntentHash(
    3, AztecAddress.ZERO, new Fr(0), new Fr(0), 2, signer1NonceUpdated + 1000, deadline2
  );

  const changeThresholdSig = await generateSchnorrSignature(changeThresholdHash, priv1);

  const changeThresholdTxSent = contract.withWallet(wallet1).methods
    .change_threshold(2, changeThresholdSig, signer1NonceUpdated, pub1X, pub1Y, deadline2)
    .send({ from: addr1, fee });

  const changeThresholdTx = await changeThresholdTxSent.wait({ timeout: 120 });
  logger.info(`✓ Change threshold: ${changeThresholdTx.txHash.toString()}`);

  await new Promise(resolve => setTimeout(resolve, 5000));

  const configAfterThreshold = await contract.methods.get_multisig_config().simulate({ from: addr1 });
  logger.info(`  New threshold: ${configAfterThreshold[0]}`);

  logger.info("\n=== TEST 3: PROPOSE TRANSACTION ===");
  const signer1InfoAfterThreshold = await contract.methods.get_signer_info(addr1).simulate({ from: addr1 });
  const signer1NonceAfterThreshold = Number(signer1InfoAfterThreshold[3]);

  const amount = 1000000n;
  const function_selector = new Fr(0x1234n);
  const data_hash = new Fr(0x5678n);
  const txNonce = signer1NonceAfterThreshold + 1000;
  const deadline3 = BigInt(Date.now() + 3600000);

  const txIntentHash = await computeTransactionIntentHash(
    addr3, amount, function_selector, data_hash, txNonce, deadline3
  );
  
  const proposeSig = await generateSchnorrSignature(txIntentHash, priv1);

  const proposeTxSent = contract.withWallet(wallet1).methods
    .propose_transaction(addr3, amount, function_selector, data_hash, deadline3, 
                        proposeSig, signer1NonceAfterThreshold, pub1X, pub1Y)
    .send({ from: addr1, fee });

  const proposeTx = await proposeTxSent.wait({ timeout: 120 });
  logger.info(`✓ Propose TX: ${proposeTx.txHash.toString()}`);

  await new Promise(resolve => setTimeout(resolve, 5000));

  const approvalCount1 = await contract.methods.get_approval_count(txIntentHash).simulate({ from: addr1 });
  logger.info(`  Approvals: ${approvalCount1}`);

  logger.info("\n=== TEST 4: APPROVE TRANSACTION ===");
  const approveSig = await generateSchnorrSignature(txIntentHash, priv2);
  
  const signer2InfoForApprove = await contract.methods.get_signer_info(addr2).simulate({ from: addr1 });
  const signer2Nonce = Number(signer2InfoForApprove[3]);

  const approveTxSent = contract.withWallet(wallet2).methods
    .approve_transaction(txIntentHash, approveSig, signer2Nonce, pub2X, pub2Y)
    .send({ from: addr2, fee });

  const approveTx = await approveTxSent.wait({ timeout: 120 });
  logger.info(`✓ Approve TX: ${approveTx.txHash.toString()}`);

  await new Promise(resolve => setTimeout(resolve, 5000));

  const approvalCount2 = await contract.methods.get_approval_count(txIntentHash).simulate({ from: addr1 });
  const isExecuted = await contract.methods.is_message_executed(txIntentHash).simulate({ from: addr1 });
  logger.info(`  Approvals: ${approvalCount2}`);
  logger.info(`  Executed: ${isExecuted}`);

  logger.info("\n=== TEST 5: ADD SIGNER 3 ===");
  const signer1InfoForSigner3 = await contract.methods.get_signer_info(addr1).simulate({ from: addr1 });
  const signer1NonceForSigner3 = Number(signer1InfoForSigner3[3]);
  
  const deadline4 = BigInt(Date.now() + 3600000);
  const addSigner3Hash = await computeManagementIntentHash(
    1, addr3, pub3X, pub3Y, 0, signer1NonceForSigner3 + 1000, deadline4
  );

  const addSigner3Sig1 = await generateSchnorrSignature(addSigner3Hash, priv1);

  const addSigner3TxSent = contract.withWallet(wallet1).methods
    .add_signer(addr3, pub3X, pub3Y, addSigner3Sig1, signer1NonceForSigner3, pub1X, pub1Y, deadline4)
    .send({ from: addr1, fee });

  await addSigner3TxSent.wait({ timeout: 120 });
  logger.info(`✓ Proposed add signer 3`);

  await new Promise(resolve => setTimeout(resolve, 5000));

  const addSigner3Sig2 = await generateSchnorrSignature(addSigner3Hash, priv2);
  const signer2NonceForSigner3 = Number((await contract.methods.get_signer_info(addr2).simulate({ from: addr1 }))[3]);

  const approveSigner3TxSent = contract.withWallet(wallet2).methods
    .approve_management_operation(addSigner3Hash, addSigner3Sig2, signer2NonceForSigner3, pub2X, pub2Y)
    .send({ from: addr2, fee });

  await approveSigner3TxSent.wait({ timeout: 120 });
  logger.info(`✓ Signer 3 approved`);

  await new Promise(resolve => setTimeout(resolve, 5000));

  const signer3Info = await contract.methods.get_signer_info(addr3).simulate({ from: addr1 });
  logger.info(`  Signer 3 authorized: ${signer3Info[0]}`);

  logger.info("\n=== FINAL STATE ===");
  const finalConfig = await contract.methods.get_multisig_config().simulate({ from: addr1 });
  logger.info(`Threshold: ${finalConfig[0]}`);
  logger.info(`Signer Count: ${finalConfig[1]}`);
  logger.info(`TX Nonce: ${finalConfig[2]}`);
  logger.info(`\n✅ All tests completed!`);
}

main().catch((e) => {
  console.error("\n❌ Test failed:");
  console.error(e);
  process.exit(1);
});