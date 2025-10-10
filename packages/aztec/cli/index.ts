#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { AztecAddress, Fr } from "@aztec/aztec.js";
import { GrumpkinScalar, Point } from "@aztec/foundation/fields";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { Schnorr, Grumpkin } from "@aztec/foundation/crypto";
import { poseidon2Hash } from "@aztec/foundation/crypto";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";

const toAddress = (hex: string) => AztecAddress.fromString(hex);
const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());

// Convert Ethereum address (20 bytes) to AztecAddress (32 bytes)
function ethToAztecAddress(ethAddress: string): AztecAddress {
  const clean = ethAddress.toLowerCase().replace('0x', '');
  const padded = '0x' + clean.padStart(64, '0');
  return AztecAddress.fromString(padded);
}

async function getWallet(signerNum: number) {
  const pxe = await setupPXE();
  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const privKeyEnv = signerNum === 0 ? "PRIV_DEPLOYER" : `PRIV${signerNum}`;
  const signerPrivKey = toScalar(process.env[privKeyEnv]!);
  const accountMgr = await getSchnorrAccount(pxe, secretKey, signerPrivKey, salt);
  return accountMgr.getWallet();
}

async function derivePublicKey(privateKey: GrumpkinScalar): Promise<Point> {
  const grumpkin = new Grumpkin();
  return grumpkin.mul(grumpkin.generator(), privateKey);
}

async function signMessage(messageHash: Fr, privateKey: GrumpkinScalar): Promise<number[]> {
  const schnorr = new Schnorr();
  const messageBytes = messageHash.toBuffer();
  const signature = await schnorr.constructSignature(messageBytes, privateKey);
  return Array.from(signature.toBuffer());
}

const program = new Command();
program.name("multisig").description("Aztec Cross-Chain Multisig CLI").version("1.0.0");

// ============================================================================
// INFO
// ============================================================================
program.command("info").description("Show wallet info").action(async () => {
  const spinner = ora("Loading info...").start();
  try {
    spinner.text = "Connecting to PXE...";
    const pxe = await setupPXE();
    const contractAddress = toAddress(process.env.PRIVATE_MULTISIG_ADDRESS!);
    
    spinner.text = "Checking contract...";
    const contractInstance = await pxe.getContractInstance(contractAddress);
    if (!contractInstance) {
      spinner.fail("Contract not found");
      console.error(chalk.red("\n❌ Contract not found\n"));
      process.exit(1);
    }
    
    spinner.text = "Loading wallet...";
    const wallet = await getWallet(1);
    const contract = await PrivateMultisigContract.at(contractAddress, wallet);
    
    spinner.text = "Reading state...";
    const threshold = await contract.methods.get_threshold().simulate({ from: wallet.getAddress() });
    const signerCount = await contract.methods.get_signer_count().simulate({ from: wallet.getAddress() });
    const crossChainNonce = await contract.methods.get_cross_chain_nonce().simulate({ from: wallet.getAddress() });
    
    const signer1Active = await contract.methods.is_signer(toAddress(process.env.SIGNER1_ADDRESS!)).simulate({ from: wallet.getAddress() });
    const signer2Active = await contract.methods.is_signer(toAddress(process.env.SIGNER2_ADDRESS!)).simulate({ from: wallet.getAddress() });
    const signer3Active = await contract.methods.is_signer(toAddress(process.env.SIGNER3_ADDRESS!)).simulate({ from: wallet.getAddress() });
    
    const registeredAccounts = await pxe.getRegisteredAccounts();
    spinner.succeed("Info loaded");
    
    console.log("\n" + chalk.cyan("═".repeat(70)));
    console.log(chalk.cyan.bold("           MULTISIG WALLET INFO"));
    console.log(chalk.cyan("═".repeat(70)));
    console.log(`${chalk.white("Contract:")}         ${chalk.yellow(contractAddress)}`);
    console.log(`${chalk.white("Threshold:")}        ${chalk.yellow(threshold)}`);
    console.log(`${chalk.white("Signer Count:")}     ${chalk.yellow(signerCount)}`);
    console.log(`${chalk.white("Cross-chain Nonce:")} ${chalk.yellow(crossChainNonce)}`);
    
    console.log(chalk.cyan("\n" + "─".repeat(70)));
    console.log(chalk.cyan.bold("Signer Status:"));
    console.log(chalk.cyan("─".repeat(70)));
    console.log(`Signer 1: ${signer1Active ? chalk.green("✓ ACTIVE") : chalk.red("✗ INACTIVE")}`);
    console.log(`         ${chalk.gray(process.env.SIGNER1_ADDRESS!)}`);
    console.log(`Signer 2: ${signer2Active ? chalk.green("✓ ACTIVE") : chalk.red("✗ INACTIVE")}`);
    console.log(`         ${chalk.gray(process.env.SIGNER2_ADDRESS!)}`);
    console.log(`Signer 3: ${signer3Active ? chalk.green("✓ ACTIVE") : chalk.red("✗ INACTIVE")}`);
    console.log(`         ${chalk.gray(process.env.SIGNER3_ADDRESS!)}`);
    
    console.log(chalk.cyan("\n" + "─".repeat(70)));
    console.log(chalk.cyan.bold("Registered Accounts in PXE:"));
    console.log(chalk.cyan("─".repeat(70)));
    
    let foundCount = 0;
    registeredAccounts.forEach((acc) => {
      const addr = acc.address.toString();
      if (addr === process.env.DEPLOYER_ADDRESS) {
        console.log(`${chalk.green("✓")} Deployer: ${chalk.gray(addr)}`);
        foundCount++;
      } else if (addr === process.env.SIGNER1_ADDRESS) {
        console.log(`${chalk.green("✓")} Signer 1: ${chalk.gray(addr)}`);
        foundCount++;
      } else if (addr === process.env.SIGNER2_ADDRESS) {
        console.log(`${chalk.green("✓")} Signer 2: ${chalk.gray(addr)}`);
        foundCount++;
      } else if (addr === process.env.SIGNER3_ADDRESS) {
        console.log(`${chalk.green("✓")} Signer 3: ${chalk.gray(addr)}`);
        foundCount++;
      }
    });
    
    console.log(chalk.cyan("═".repeat(70)));
    console.log(chalk.green(`\n✅ Contract accessible`));
    console.log(chalk.white(`   ${foundCount}/4 accounts in PXE`));
    console.log(chalk.cyan(`\n🔗 https://aztec-testnet.subscan.io/address/${contractAddress}\n`));
  } catch (error: any) {
    spinner.fail("Failed");
    console.error(chalk.red("\n❌ " + error.message + "\n"));
    process.exit(1);
  }
});

// ============================================================================
// ADD SIGNER - FIXED: Proper retry with note sync
// ============================================================================
program.command("add-signer")
  .description("Add new signer")
  .requiredOption("--new-signer <num>", "New signer number (2 or 3)")
  .option("--proposer <num>", "Proposer (default: 1)", "1")
  .action(async (opts) => {
    const spinner = ora("Preparing...").start();
    try {
      const proposerNum = parseInt(opts.proposer);
      const newSignerNum = parseInt(opts.newSigner);
      
      if (![2, 3].includes(newSignerNum)) {
        spinner.fail("Invalid signer");
        console.error(chalk.red("\n❌ New signer must be 2 or 3\n"));
        process.exit(1);
      }
      
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("ADD NEW SIGNER"));
      console.log(chalk.cyan("═".repeat(70)));
      
      spinner.text = "Loading wallet...";
      const proposerWallet = await getWallet(proposerNum);
      const proposerAddress = proposerWallet.getAddress();
      const proposerPrivKeyEnv = proposerNum === 0 ? "PRIV_DEPLOYER" : `PRIV${proposerNum}`;
      const proposerPrivKey = toScalar(process.env[proposerPrivKeyEnv]!);
      const proposerPub = await derivePublicKey(proposerPrivKey);
      const proposerPubX = toFr(proposerPub.x.toString());
      const proposerPubY = toFr(proposerPub.y.toString());
      
      const proposerLabel = proposerNum === 0 ? "Deployer" : `Signer ${proposerNum}`;
      console.log(`${chalk.white("Proposer:")}    ${chalk.yellow(proposerLabel)}`);
      console.log(`               ${chalk.gray(proposerAddress)}`);
      
      const newSignerAddress = toAddress(process.env[`SIGNER${newSignerNum}_ADDRESS`]!);
      const newSignerPubX = toFr(process.env[`PUB${newSignerNum}_X`]!);
      const newSignerPubY = toFr(process.env[`PUB${newSignerNum}_Y`]!);
      
      console.log(`${chalk.white("New Signer:")}  ${chalk.yellow(`Signer ${newSignerNum}`)}`);
      console.log(`               ${chalk.gray(newSignerAddress)}`);
      
      const nonce = 0;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);
      
      spinner.text = "Computing hash...";
      const messageHash = await poseidon2Hash([
        Fr.fromString("1"),
        newSignerAddress.toField(),
        newSignerPubX,
        newSignerPubY,
        Fr.fromString("0"),
        Fr.fromString(nonce.toString()),
        Fr.fromString(deadline.toString())
      ]);
      
      console.log(`${chalk.white("Message Hash:")} ${chalk.gray(messageHash.toString())}`);
      
      spinner.text = "Signing...";
      const signature = await signMessage(messageHash, proposerPrivKey);
      
      spinner.text = "Sending transaction...";
      const contractAddress = toAddress(process.env.PRIVATE_MULTISIG_ADDRESS!);
      const contract = await PrivateMultisigContract.at(contractAddress, proposerWallet);
      
      const { getSponsoredFPCInstance } = await import("../src/utils/sponsored_fpc.js");
      const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee/testing");
      const sponsoredFPC = await getSponsoredFPCInstance();
      const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
      
      const tx = await contract.methods
        .add_signer(
          newSignerAddress,
          newSignerPubX,
          newSignerPubY,
          signature,
          nonce,
          proposerPubX,
          proposerPubY,
          deadline
        )
        .send({ from: proposerAddress, fee })
        .wait({ timeout: 300_000 });
      
      spinner.succeed("Proposed!");
      console.log(chalk.green("\n✅ add_signer() proposal success!"));
      console.log(chalk.white(`   TX: ${tx.txHash}`));
      console.log(chalk.white(`   Message Hash: ${messageHash.toString()}`));
      
      spinner.text = "Checking threshold...";
      const threshold = await contract.methods.get_threshold().simulate({ from: proposerAddress });
      
      if (threshold.toString() === "1") {
        console.log(chalk.cyan("\n💡 Threshold=1, waiting for note sync (30s)..."));
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        spinner.start("Executing add signer...");
        const executeTx = await contract.methods
          .execute_add_signer(
            messageHash,
            newSignerAddress,
            newSignerPubX,
            newSignerPubY
          )
          .send({ from: proposerAddress, fee })
          .wait({ timeout: 300_000 });
        
        spinner.succeed("Done!");
        console.log(chalk.green("\n✅ Signer added successfully!"));
        console.log(chalk.white(`   TX: ${executeTx.txHash}`));
        console.log(chalk.cyan("\n💡 Verify: npx tsx cli/index.ts info"));
      } else {
        console.log(chalk.cyan("\n💡 Threshold > 1, need more approvals"));
      }
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

// ============================================================================
// PROPOSE CROSS-CHAIN
// ============================================================================
program.command("propose-cross-chain")
  .description("Propose cross-chain intent")
  .option("--proposer <num>", "Proposer (default: 1)", "1")
  .option("--amount <amount>", "Amount in wei", "1000000")
  .option("--recipient <address>", "Arbitrum recipient")
  .action(async (opts) => {
    const spinner = ora("Preparing...").start();
    try {
      const proposerNum = parseInt(opts.proposer);
      const amount = opts.amount;
      const recipient = opts.recipient || process.env.ARBITRUM_INTENT_VAULT!;
      
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("PROPOSE CROSS-CHAIN INTENT"));
      console.log(chalk.cyan("═".repeat(70)));
      
      spinner.text = "Loading wallet...";
      const proposerWallet = await getWallet(proposerNum);
      const proposerAddress = proposerWallet.getAddress();
      const proposerPrivKeyEnv = proposerNum === 0 ? "PRIV_DEPLOYER" : `PRIV${proposerNum}`;
      const proposerPrivKey = toScalar(process.env[proposerPrivKeyEnv]!);
      const proposerPub = await derivePublicKey(proposerPrivKey);
      const proposerPubX = toFr(proposerPub.x.toString());
      const proposerPubY = toFr(proposerPub.y.toString());
      
      console.log(`${chalk.white("Proposer:")}         ${chalk.yellow(`Signer ${proposerNum}`)}`);
      console.log(`${chalk.white("Target:")}           ${chalk.yellow("Arbitrum Sepolia")}`);
      console.log(`${chalk.white("Recipient:")}        ${chalk.yellow(recipient)}`);
      console.log(`${chalk.white("Amount:")}           ${chalk.yellow(amount + " wei")}`);
      
      const targetChain = Fr.fromString("421614");
      const targetContract = ethToAztecAddress(recipient);
      const intentType = Fr.fromString("1");
      const amountFr = Fr.fromString(amount);
      const recipientAddr = ethToAztecAddress(recipient);
      
      const nonce = 0;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);
      
      spinner.text = "Computing hash...";
      const messageHash = await poseidon2Hash([
        Fr.fromString("6"),
        targetChain,
        targetContract.toField(),
        intentType,
        amountFr,
        recipientAddr.toField(),
        Fr.fromString(nonce.toString()),
        Fr.fromString(deadline.toString())
      ]);
      
      console.log(`${chalk.white("Message Hash:")}     ${chalk.gray(messageHash.toString())}`);
      
      spinner.text = "Signing...";
      const signature = await signMessage(messageHash, proposerPrivKey);
      
      spinner.text = "Sending transaction...";
      const contractAddress = toAddress(process.env.PRIVATE_MULTISIG_ADDRESS!);
      const contract = await PrivateMultisigContract.at(contractAddress, proposerWallet);
      
      const { getSponsoredFPCInstance } = await import("../src/utils/sponsored_fpc.js");
      const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee/testing");
      const sponsoredFPC = await getSponsoredFPCInstance();
      const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
      
      const tx = await contract.methods
        .propose_cross_chain_intent(
          targetChain,
          targetContract,
          intentType,
          amountFr,
          recipientAddr,
          signature,
          nonce,
          proposerPubX,
          proposerPubY,
          deadline
        )
        .send({ from: proposerAddress, fee })
        .wait({ timeout: 300_000 });
      
      spinner.succeed("Proposed!");
      console.log(chalk.green("\n✅ Cross-chain intent proposed!"));
      console.log(chalk.white(`   TX: ${tx.txHash}`));
      console.log(chalk.white(`   Message Hash: ${messageHash.toString()}`));
      console.log(chalk.cyan("\n💡 Execute with:"));
      console.log(chalk.white(`   npx tsx cli/index.ts execute-cross-chain --message-hash ${messageHash.toString()}`));
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

// ============================================================================
// EXECUTE CROSS-CHAIN - FIXED: Remove nonce param (not in contract signature)
// ============================================================================
program.command("execute-cross-chain")
  .description("Execute cross-chain intent")
  .requiredOption("--message-hash <hash>", "Message hash")
  .option("--executor <num>", "Executor (default: 1)", "1")
  .option("--amount <amount>", "Amount", "1000000")
  .option("--recipient <address>", "Recipient")
  .action(async (opts) => {
    const spinner = ora("Executing...").start();
    try {
      const executorNum = parseInt(opts.executor);
      const messageHash = toFr(opts.messageHash);
      const amount = opts.amount;
      const recipient = opts.recipient || process.env.ARBITRUM_INTENT_VAULT!;
      
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("EXECUTE CROSS-CHAIN"));
      console.log(chalk.cyan("═".repeat(70)));
      
      spinner.text = "Loading wallet...";
      const executorWallet = await getWallet(executorNum);
      const executorAddress = executorWallet.getAddress();
      
      console.log(`${chalk.white("Executor:")}     ${chalk.yellow(`Signer ${executorNum}`)}`);
      console.log(`${chalk.white("Message Hash:")} ${chalk.yellow(messageHash.toString())}`);
      
      spinner.text = "Loading contract...";
      const contractAddress = toAddress(process.env.PRIVATE_MULTISIG_ADDRESS!);
      const contract = await PrivateMultisigContract.at(contractAddress, executorWallet);
      
      const targetChain = Fr.fromString("421614");
      const targetContract = ethToAztecAddress(recipient);
      const intentType = Fr.fromString("1");
      const amountFr = Fr.fromString(amount);
      const recipientAddr = ethToAztecAddress(recipient);
      
      spinner.text = "Publishing to Wormhole...";
      const { getSponsoredFPCInstance } = await import("../src/utils/sponsored_fpc.js");
      const { SponsoredFeePaymentMethod } = await import("@aztec/aztec.js/fee/testing");
      const sponsoredFPC = await getSponsoredFPCInstance();
      const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };
      
      // Retry mechanism for note sync
      let lastError: any;
      const maxAttempts = 5;
      
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            console.log(chalk.yellow(`\n⏳ Retry ${attempt}/${maxAttempts} - waiting for note sync (30s)...`));
            await new Promise(resolve => setTimeout(resolve, 30000));
          } else {
            spinner.text = "Waiting for note sync (30s)...";
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
          
          spinner.start(`Publishing to Wormhole (attempt ${attempt}/${maxAttempts})...`);
          
          // CRITICAL: Contract signature is (message_hash, target_chain, target_contract, intent_type, amount, recipient)
          // NO nonce parameter!
          const tx = await contract.methods
            .execute_cross_chain_intent(
              messageHash,
              targetChain,
              targetContract,
              intentType,
              amountFr,
              recipientAddr
            )
            .send({ from: executorAddress, fee })
            .wait({ timeout: 300_000 });
          
          spinner.succeed("Executed!");
          console.log(chalk.green("\n✅ Wormhole message published!"));
          console.log(chalk.white(`   TX: ${tx.txHash}`));
          console.log(chalk.cyan(`\n🔗 https://aztec-testnet.subscan.io/tx/${tx.txHash}`));
          console.log(chalk.cyan("═".repeat(70)) + "\n");
          return;
          
        } catch (error: any) {
          lastError = error;
          
          if (error.message && error.message.includes("Failed to get a note")) {
            if (attempt < maxAttempts) {
              spinner.warn(chalk.yellow(`Attempt ${attempt} failed - note not synced yet`));
              continue;
            }
          }
          
          throw error;
        }
      }
      
      throw lastError;
      
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message));
      
      if (error.message && error.message.includes("Failed to get a note")) {
        console.log(chalk.yellow("\n💡 Troubleshooting:"));
        console.log(chalk.white("   1. Wait 2-3 minutes for PXE to sync notes"));
        console.log(chalk.white("   2. Verify wormhole configured: npx tsx cli/index.ts info"));
        console.log(chalk.white("   3. Retry this command"));
      }
      console.log();
      process.exit(1);
    }
  });

program.parse();