#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import {
  createSigner,
  listSigners,
  listMultisigs,
  setCurrentSigner,
  setCurrentMultisig,
  getCurrentSigner,
  getCurrentMultisig,
  getGlobalState,
  Signer,
  saveMultisig,
} from "./src/signer-manager";
import { createMultisig } from "./src/create_multisig";
import { listArbitrumProxies } from "./src/arbitrum-deployer";
import {
  ethToAztecAddress,
  getOrCreateSignerAccount,
  getSharedStateAccount,
  toAddress,
  toFr,
  toScalar,
  registerSignersInWallet,
} from "./utils";
import { NODE_URL, SALT, SECRET_KEY, WORMHOLE_ADDRESS } from "./constants";
import { setupPXE } from "./setup_pxe";
import { setupPXEForSigner } from "./src/pxe-manager";
import { setupSponsoredFPC } from "./sponsored_fpc";
import { MultisigAccountContract } from "../aztec-contracts/src/artifacts/MultisigAccount";
import {
  proposeAddSigner,
  proposeCrossChainIntent,
  signProposal,
  getProposalStatus,
  listPendingProposals,
  cleanupExecutedProposal,
  AddSignerData,
  RemoveSignerData,
  ChangeThresholdData,
  CrossChainIntentData,
} from "./src/proposal-manager";
import { Fr } from "@aztec/foundation/fields";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Contract } from "@aztec/aztec.js/contracts";
import { loadContractArtifact } from "@aztec/stdlib/abi";

import WormholeJson from './wormhole/wormhole_contracts-Wormhole.json' with { type: 'json' };

const WormholeContractArtifact = loadContractArtifact(WormholeJson);

const program = new Command();

function requireSignerInMultisig(currentSigner: Signer, currentMultisig: any) {
  if (!currentMultisig.signers.includes(currentSigner.name)) {
    const available = currentMultisig.signers.length
      ? currentMultisig.signers.join(", ")
      : "(no signers registered)";
    throw new Error(
      `Current signer "${currentSigner.name}" is not a signer of multisig "${currentMultisig.name}". Switch to one of: ${available}`
    );
  }
}

program
  .name("multisig")
  .description("CLI tool for managing multisig signers")
  .version("1.0.0");

// ================================================
// Signer Commands
// ================================================

program
  .command("create-signer")
  .description("Create a new signer and add it to the signer registry")
  .argument("[name]", "Name for the signer", "Signer")
  .option("--local", "Use shared PXE storage instead of signer-specific PXE")
  .action(async (name, options) => {
    try {
      const useSharedPXE = Boolean(options?.local);
      const signer = await createSigner(name, useSharedPXE);
      console.log(chalk.green(`✓ Created signer: ${name}`));
      console.log(chalk.white(`  Private Key: ${signer.privateKey}`));
      console.log(chalk.white(`  Public Key X: ${signer.publicKeyX}`));
      console.log(chalk.white(`  Public Key Y: ${signer.publicKeyY}`));
      if (useSharedPXE) {
        console.log(
          chalk.yellow(
            "  Using shared PXE storage (--local). For production, omit --local to mimic separate signer PXEs."
          )
        );
      }
    } catch (error) {
      console.error(chalk.red("Error creating signer:"), error);
      process.exit(1);
    }
  });

program
  .command("create-multisig")
  .description("Create and deploy a new multisig contract")
  .argument("<name>", "Name for the multisig")
  .argument("<threshold>", "Threshold for the multisig")
  .argument("<signers...>", "Names of signers to include in the multisig")
  .action(async (name, threshold, signerNames) => {
    try {
      const thresholdNum = parseInt(threshold);
      if (isNaN(thresholdNum) || thresholdNum < 1) {
        throw new Error("Threshold must be a positive number");
      }

      // Signernames's length should > 0
      if (signerNames.length === 0) {
        throw new Error("Signers list is empty");
      }

      if (thresholdNum > signerNames.length) {
        throw new Error(
          `Threshold (${thresholdNum}) cannot be greater than number of signers (${signerNames.length})`
        );
      }

      // Then create the multisig contract
      let signers = await listSigners();
      // Find the signer in the signers.json file
      signers = signerNames.map((name: string) => {
        const signer = signers.find((signer) => signer.name === name);
        if (!signer) {
          throw new Error(`Signer ${name} not found`);
        }
        return signer;
      });

      // pass signer to create multisig
      const multisigInfo = await createMultisig(signers, thresholdNum, name);
      console.log(
        chalk.green(
          `✓ Multisig "${name}" created with ${signerNames.length} signers and threshold ${thresholdNum}`
        )
      );
      console.log(chalk.white(`  Aztec Address: ${multisigInfo.address}`));
      if (multisigInfo.arbitrumProxy) {
        console.log(
          chalk.white(`  Arbitrum Proxy: ${multisigInfo.arbitrumProxy}`)
        );
      }
    } catch (error) {
      console.error(chalk.red("Error creating multisig contract:"), error);
      process.exit(1);
    }
  });

program
  .command("use-signer")
  .description("Set the current active signer")
  .argument("<name>", "Name of the signer to use")
  .action(async (name) => {
    try {
      await setCurrentSigner(name);
      console.log(chalk.green(`✓ Set current signer to: ${name}`));
    } catch (error) {
      console.error(chalk.red("Error setting current signer:"), error);
      process.exit(1);
    }
  });

program
  .command("use-multisig")
  .description("Set the current active multisig")
  .argument("<name>", "Name of the multisig to use")
  .action(async (name) => {
    try {
      await setCurrentMultisig(name);
      console.log(chalk.green(`✓ Set current multisig to: ${name}`));
    } catch (error) {
      console.error(chalk.red("Error setting current multisig:"), error);
      process.exit(1);
    }
  });

program
  .command("execute-cross-chain")
  .description("Execute cross-chain intent")
  .requiredOption("--message-hash <hash>", "Message hash")
  .option("--amount <amount>", "Amount", "1000000")
  .option("--recipient <address>", "Recipient")
  .action(async (opts) => {
    const spinner = ora("Executing...").start();
    try {
      const messageHash = toFr(opts.messageHash);
      const amount = opts.amount;
      const recipient = opts.recipient || process.env.ARBITRUM_INTENT_VAULT!;

      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("EXECUTE CROSS-CHAIN"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading wallet...";
      // get current caller and multisig info
      const currentSigner = (await getCurrentSigner()) as Signer;
      const currentMultisig = await getCurrentMultisig();
      if (!currentMultisig || !currentSigner) {
        throw new Error("No current multisig or signer");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      console.log(
        `${chalk.white("Message Hash:")} ${chalk.yellow(
          messageHash.toString()
        )}`
      );

      spinner.text = "Loading contract...";

      // Use signer-specific PXE
      const { wallet } = await setupPXEForSigner(currentSigner);
      await registerSignersInWallet(wallet, currentMultisig.signers);
      const accountMgr = await getOrCreateSignerAccount(wallet, currentSigner);
      const contractAddress = toAddress(currentMultisig.address);

      const contract = await MultisigAccountContract.at(
        contractAddress,
        wallet
      );

     

      const targetChain = Fr.fromString("421614");
      const targetContract = ethToAztecAddress(currentMultisig.arbitrumProxy!);
      const intentType = Fr.fromString("1");
      const amountFr = Fr.fromString(amount);
      const recipientAddr = ethToAztecAddress(recipient);

      spinner.text = "Publishing to Wormhole...";
      const fee = await setupSponsoredFPC(wallet);

      // Retry mechanism for note sync
      let lastError: any;
      const maxAttempts = 5;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (attempt > 1) {
            console.log(
              chalk.yellow(
                `\n⏳ Retry ${attempt}/${maxAttempts} - waiting for note sync (30s)...`
              )
            );
            await new Promise((resolve) => setTimeout(resolve, 30000));
          } else {
            spinner.text = "Waiting for note sync (30s)...";
            await new Promise((resolve) => setTimeout(resolve, 30000));
          }

          spinner.start(
            `Publishing to Wormhole (attempt ${attempt}/${maxAttempts})...`
          );

          // Set deadline to 5 minutes from now
          const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes = 300 seconds

          // CRITICAL: Contract signature is (message_hash, target_chain, target_contract, intent_type, amount, recipient, wormhole_address, deadline, signatures)
          const tx = await contract.methods
            .execute_cross_chain_intent(
              messageHash,
              targetChain,
              targetContract,
              intentType,
              amountFr,
              recipientAddr,
              AztecAddress.fromString(WORMHOLE_ADDRESS),
              deadline,
              []
            )
            .send({ from: accountMgr.address, fee })
            .wait({ timeout: 300_000 });

          spinner.succeed("Executed!");
          console.log(chalk.green("\n✅ Wormhole message published!"));
          console.log(chalk.white(`   TX: ${tx.txHash}`));
          console.log(
            chalk.cyan(`\n🔗 https://aztec-testnet.subscan.io/tx/${tx.txHash}`)
          );
          console.log(chalk.cyan("═".repeat(70)) + "\n");
          return;
        } catch (error: any) {
          console.log(error);
          lastError = error;

          if (error.message && error.message.includes("Failed to get a note")) {
            if (attempt < maxAttempts) {
              spinner.warn(
                chalk.yellow(`Attempt ${attempt} failed - note not synced yet`)
              );
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
        console.log(
          chalk.white("   1. Wait 2-3 minutes for PXE to sync notes")
        );

        console.log(
          chalk.white(
            "   2. Verify wormhole configured: npx tsx cli/index.ts info"
          )
        );
        console.log(chalk.white("   3. Retry this command"));
      }
      console.log();
      process.exit(1);
    }
  });

// ================================================
// Proposal Commands
// ================================================

program
  .command("propose-add-signer")
  .description("Propose adding a new signer to the current multisig")
  .argument("<signer-name>", "Name of the signer to add")
  .action(async (signerName) => {
    const spinner = ora("Proposing add signer...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("PROPOSE ADD SIGNER"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading current multisig and signer...";

      const currentMultisig = await getCurrentMultisig();
      const currentSigner = await getCurrentSigner();

      if (!currentMultisig || !currentSigner) {
        throw new Error("No current multisig or signer set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Set deadline to 5 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes = 300 seconds

      spinner.text = "Creating new signer...";

      // find signer in signers.json
      const signers = await listSigners();
      const newSigner = signers.find((s) => s.name === signerName);
      if (!newSigner) {
        throw new Error(`Signer ${signerName} not found`);
      }

      spinner.text = "Creating proposal...";

      const proposal = await proposeAddSigner(
        signerName,
        newSigner.address,
        newSigner.publicKeyX,
        newSigner.publicKeyY,
        deadline.toString()
      );

      spinner.succeed("Proposal created!");

      console.log(chalk.green("\n✅ Add signer proposal created!"));
      console.log(chalk.white(`   Proposal ID: ${proposal.id}`));
      console.log(chalk.white(`   Message Hash: ${proposal.messageHash}`));
      console.log(chalk.white(`   New Signer: ${signerName}`));
      console.log(chalk.white(`   New Signer Address: ${newSigner.address}`));
      console.log(
        chalk.white(
          `   Deadline: ${deadline} (${new Date(
            Number(deadline) * 1000
          ).toISOString()})`
        )
      );
      console.log(chalk.white(`   Threshold: ${proposal.threshold}`));
      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(
        chalk.white("   1. Share the message hash with other signers")
      );
      console.log(
        chalk.white(
          `   2. Each signer runs: yarn dev sign-proposal --message-hash ${proposal.messageHash}`
        )
      );
      console.log(
        chalk.white(
          `   3. Once threshold is met, run: yarn dev execute-add-signer --message-hash ${proposal.messageHash}`
        )
      );
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("propose-remove-signer")
  .description("Propose removing a signer from the current multisig")
  .argument("<signer-name>", "Name of the signer to remove")
  .action(async (signerName) => {
    const spinner = ora("Proposing remove signer...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("PROPOSE REMOVE SIGNER"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading current multisig and signer...";

      const currentMultisig = await getCurrentMultisig();
      const currentSigner = await getCurrentSigner();

      if (!currentMultisig || !currentSigner) {
        throw new Error("No current multisig or signer set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Set deadline to 5 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes = 300 seconds

      spinner.text = "Finding signer to remove...";

      // Find signer in signers.json
      const signers = await listSigners();
      const targetSigner = signers.find((s) => s.name === signerName);
      if (!targetSigner) {
        throw new Error(`Signer ${signerName} not found`);
      }

      // Check if signer is in the multisig
      if (!currentMultisig.signers.includes(signerName)) {
        throw new Error(`Signer ${signerName} is not in the multisig`);
      }

      // Check if removing this signer would make threshold invalid
      const remainingSigners = currentMultisig.signers.length - 1;
      if (currentMultisig.threshold > remainingSigners) {
        throw new Error(
          `Cannot remove signer: threshold (${currentMultisig.threshold}) would be greater than remaining signers (${remainingSigners})`
        );
      }

      spinner.text = "Creating proposal...";

      const { proposeRemoveSigner } = await import("./src/proposal-manager");
      const proposal = await proposeRemoveSigner(
        signerName,
        targetSigner.address,
        deadline.toString()
      );

      spinner.succeed("Proposal created!");

      console.log(chalk.green("\n✅ Remove signer proposal created!"));
      console.log(chalk.white(`   Proposal ID: ${proposal.id}`));
      console.log(chalk.white(`   Message Hash: ${proposal.messageHash}`));
      console.log(chalk.white(`   Target Signer: ${signerName}`));
      console.log(
        chalk.white(`   Target Signer Address: ${targetSigner.address}`)
      );
      console.log(
        chalk.white(
          `   Deadline: ${deadline} (${new Date(
            Number(deadline) * 1000
          ).toISOString()})`
        )
      );
      console.log(chalk.white(`   Threshold: ${proposal.threshold}`));
      console.log(chalk.white(`   Remaining Signers: ${remainingSigners}`));
      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(
        chalk.white("   1. Share the message hash with other signers")
      );
      console.log(
        chalk.white(
          `   2. Each signer runs: yarn dev sign-proposal --message-hash ${proposal.messageHash}`
        )
      );
      console.log(
        chalk.white(
          `   3. Once threshold is met, run: yarn dev execute-remove-signer --message-hash ${proposal.messageHash}`
        )
      );
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("propose-change-threshold")
  .description("Propose changing the threshold of the current multisig")
  .argument("<new-threshold>", "New threshold value")
  .action(async (newThresholdStr) => {
    const spinner = ora("Proposing change threshold...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("PROPOSE CHANGE THRESHOLD"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading current multisig and signer...";

      const currentMultisig = await getCurrentMultisig();
      const currentSigner = await getCurrentSigner();

      if (!currentMultisig || !currentSigner) {
        throw new Error("No current multisig or signer set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      const newThreshold = parseInt(newThresholdStr);
      if (isNaN(newThreshold) || newThreshold < 1) {
        throw new Error("New threshold must be a positive number");
      }

      // Validate threshold
      if (newThreshold > currentMultisig.signers.length) {
        throw new Error(
          `New threshold (${newThreshold}) cannot be greater than number of signers (${currentMultisig.signers.length})`
        );
      }

      if (newThreshold === currentMultisig.threshold) {
        throw new Error(
          "New threshold must be different from current threshold"
        );
      }

      // Set deadline to 5 minutes from now
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes = 300 seconds

      spinner.text = "Creating proposal...";

      const { proposeChangeThreshold } = await import("./src/proposal-manager");
      const proposal = await proposeChangeThreshold(
        newThreshold,
        deadline.toString()
      );

      spinner.succeed("Proposal created!");

      console.log(chalk.green("\n✅ Change threshold proposal created!"));
      console.log(chalk.white(`   Proposal ID: ${proposal.id}`));
      console.log(chalk.white(`   Message Hash: ${proposal.messageHash}`));
      console.log(
        chalk.white(`   Current Threshold: ${currentMultisig.threshold}`)
      );
      console.log(chalk.white(`   New Threshold: ${newThreshold}`));
      console.log(
        chalk.white(`   Total Signers: ${currentMultisig.signers.length}`)
      );
      console.log(
        chalk.white(
          `   Deadline: ${deadline} (${new Date(
            Number(deadline) * 1000
          ).toISOString()})`
        )
      );
      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(
        chalk.white("   1. Share the message hash with other signers")
      );
      console.log(
        chalk.white(
          `   2. Each signer runs: yarn dev sign-proposal --message-hash ${proposal.messageHash}`
        )
      );
      console.log(
        chalk.white(
          `   3. Once threshold is met, run: yarn dev execute-change-threshold --message-hash ${proposal.messageHash}`
        )
      );
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("propose-cross-chain-intent")
  .description("Propose executing a cross-chain intent")
  .requiredOption("--amount <amount>", "Amount to transfer")
  .requiredOption("--recipient <address>", "Recipient address")
  .action(async (opts) => {
    const spinner = ora("Proposing cross-chain intent...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("PROPOSE CROSS-CHAIN INTENT"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading current multisig and signer...";

      const currentMultisig = await getCurrentMultisig();
      const currentSigner = await getCurrentSigner();

      if (!currentMultisig || !currentSigner) {
        throw new Error("No current multisig or signer set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Validate amount
      const amount = parseInt(opts.amount);
      if (isNaN(amount) || amount < 0) {
        throw new Error("Amount must be a non-negative number");
      }

      // Check if current multisig has an Arbitrum proxy
      if (!currentMultisig.arbitrumProxy) {
        throw new Error(
          "Current multisig does not have an Arbitrum proxy deployed"
        );
      }

      spinner.text = "Creating proposal...";

      // Use fixed values: target chain is always 421614 (Arbitrum Sepolia),
      // target contract is the current multisig's Arbitrum proxy,
      // intent type is always 1 (TRANSFER),
      // and deadline is 5 minutes from now
      const targetChain = "421614";
      const targetContract = currentMultisig.arbitrumProxy;
      const intentType = "1"; // Always TRANSFER
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 minutes = 300 seconds

      const proposal = await proposeCrossChainIntent(
        targetChain,
        targetContract,
        intentType,
        opts.amount,
        opts.recipient,
        deadline.toString()
      );

      spinner.succeed("Proposal created!");

      console.log(chalk.green("\n✅ Cross-chain intent proposal created!"));
      console.log(chalk.white(`   Proposal ID: ${proposal.id}`));
      console.log(chalk.white(`   Message Hash: ${proposal.messageHash}`));
      console.log(
        chalk.white(`   Target Chain: ${targetChain} (Arbitrum Sepolia)`)
      );
      console.log(chalk.white(`   Target Contract: ${targetContract}`));
      console.log(chalk.white(`   Intent Type: ${intentType} (TRANSFER)`));
      console.log(chalk.white(`   Amount: ${opts.amount}`));
      console.log(chalk.white(`   Recipient: ${opts.recipient}`));
      console.log(chalk.white(`   Deadline: ${deadline} (24 hours from now)`));
      console.log(chalk.white(`   Threshold: ${proposal.threshold}`));
      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(
        chalk.white("   1. Share the message hash with other signers")
      );
      console.log(
        chalk.white(
          `   2. Each signer runs: yarn dev sign-proposal --message-hash ${proposal.messageHash}`
        )
      );
      console.log(
        chalk.white(
          `   3. Once threshold is met, run: yarn dev execute-cross-chain-intent --message-hash ${proposal.messageHash}`
        )
      );
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("sign-proposal")
  .description("Sign any pending proposal")
  .requiredOption("--message-hash <hash>", "Message hash of the proposal")
  .option(
    "--signer-name <name>",
    "Name of the signer to use (defaults to current)"
  )
  .action(async (opts) => {
    const spinner = ora("Signing proposal...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("SIGN PROPOSAL"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading proposal...";

      const { proposal } = getProposalStatus(opts.messageHash);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== "pending") {
        throw new Error(`Proposal is ${proposal.status}, cannot sign`);
      }

      spinner.text = "Signing with current signer...";

      const signature = await signProposal(opts.messageHash, opts.signerName);
      const { progress } = getProposalStatus(opts.messageHash);

      spinner.succeed("Signed!");

      console.log(chalk.green("\n✅ Proposal signed!"));
      console.log(chalk.white(`   Proposal Type: ${proposal.type}`));
      console.log(chalk.white(`   Signer: ${signature.signerName}`));
      console.log(chalk.white(`   Message Hash: ${opts.messageHash}`));
      console.log(chalk.white(`   Progress: ${progress}`));

      // Check if threshold is met
      const updatedStatus = getProposalStatus(opts.messageHash);
      const thresholdMet =
        updatedStatus.signatures.length >= proposal.threshold;
      if (thresholdMet) {
        console.log(chalk.yellow("\n🎉 Threshold reached! Ready to execute."));
      }

      console.log(chalk.cyan("\n💡 Next steps:"));
      if (thresholdMet) {
        const executeCommands: Record<string, string> = {
          add_signer: `yarn dev execute-add-signer --message-hash ${opts.messageHash}`,
          remove_signer: `yarn dev execute-remove-signer --message-hash ${opts.messageHash}`,
          change_threshold: `yarn dev execute-change-threshold --message-hash ${opts.messageHash}`,
          cross_chain_intent: `yarn dev execute-cross-chain-intent --message-hash ${opts.messageHash}`,
        };
        const executeCommand =
          executeCommands[proposal.type] ??
          "Review proposal type to determine the correct execute command.";
        console.log(chalk.white(`   1. Run: ${executeCommand}`));
      } else {
        console.log(
          chalk.white("   1. Share the message hash with remaining signers")
        );
        console.log(
          chalk.white(
            `   2. Ask remaining signers to run: yarn dev sign-proposal --message-hash ${opts.messageHash}`
          )
        );
      }

      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

// ================================================
// Execute Commands
// ================================================

program
  .command("execute-add-signer")
  .description("Execute an add signer proposal")
  .requiredOption("--message-hash <hash>", "Message hash of the proposal")
  .action(async (opts) => {
    const spinner = ora("Executing add signer...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("EXECUTE ADD SIGNER"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading proposal and signatures...";

      const { proposal, signatures } = getProposalStatus(opts.messageHash);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== "pending") {
        throw new Error(`Proposal is ${proposal.status}, cannot execute`);
      }

      if (signatures.length < proposal.threshold) {
        throw new Error(
          `Insufficient signatures: ${signatures.length}/${proposal.threshold}`
        );
      }

      spinner.text = "Loading wallet and contract...";

      const currentSigner = await getCurrentSigner();
      const currentMultisig = await getCurrentMultisig();

      if (!currentSigner || !currentMultisig) {
        throw new Error("No current signer or multisig set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Use signer-specific PXE
      const { wallet } = await setupPXEForSigner(currentSigner);
      await registerSignersInWallet(wallet, currentMultisig.signers);

      // get current multisig shared state account
      const sharedStateAccount = await getSharedStateAccount(
        currentMultisig.address,
        wallet
      );

      const contractAddress = toAddress(currentMultisig.address);

      const contract = await MultisigAccountContract.at(
        contractAddress,
        wallet
      );

      spinner.text = "Preparing signatures...";

      // Convert signatures to contract format
      const contractSignatures = Array(8)
        .fill(null)
        .map(() => ({
          owner: AztecAddress.ZERO,
          signature: new Array(64).fill(0),
        }));

      signatures.forEach((sig, index) => {
        if (index < 8) {
          // Parse the signature from JSON string back to number array
          const signatureBytes = JSON.parse(sig.signature);

          contractSignatures[index] = {
            owner: AztecAddress.fromString(sig.signerAddress),
            signature: signatureBytes,
          };
        }
      });

      spinner.text = "Executing add signer transaction...";

      const fee = await setupSponsoredFPC(wallet);

      const proposalData = proposal.data as AddSignerData;
      const deadline = BigInt(proposalData.deadline);
      const tx = await contract.methods
        .add_signer(
          Fr.fromString(opts.messageHash),
          AztecAddress.fromString(proposalData.newSignerAddress),
          Fr.fromString(proposalData.newSignerPublicKeyX),
          Fr.fromString(proposalData.newSignerPublicKeyY),
          deadline,
          contractSignatures
        )
        .send({
          from: sharedStateAccount.address,
          fee,
        })
        .wait({ timeout: 300_000 });

      // update multisig in multisigs.json
      const multisigs = await listMultisigs();
      const multisig = multisigs.find(
        (m) => m.address == currentMultisig.address
      );
      if (!multisig) {
        throw new Error("Multisig not found");
      }
      multisig.signers.push(proposalData.newSignerName);
      await saveMultisig(multisig);

      // Register shared state account and contract in the new signer's PXE
      try {
        console.log(
          chalk.cyan(
            `\nRegistering shared state account for ${proposalData.newSignerName}...`
          )
        );
        const { wallet: newSignerWallet } = await setupPXEForSigner(
          proposalData.newSignerName
        );

        await registerSignersInWallet(newSignerWallet, multisig.signers);

        await getSharedStateAccount(currentMultisig.address, newSignerWallet);

        await newSignerWallet.registerContract({
          instance: contract.instance,
          artifact: MultisigAccountContract.artifact,
        });

        console.log(
          chalk.green(
            `✓ Shared state account registered for ${proposalData.newSignerName}`
          )
        );
      } catch (error) {
        console.warn(
          chalk.yellow(
            `⚠ Warning: Could not register shared state for ${proposalData.newSignerName}: ${error}`
          )
        );
      }

      spinner.succeed("Executed!");

      console.log(chalk.green("\n✅ Signer added successfully!"));
      console.log(chalk.white(`   TX: ${tx.txHash}`));
      console.log(chalk.white(`   New Signer: ${proposalData.newSignerName}`));
      console.log(
        chalk.white(`   New Signer Address: ${proposalData.newSignerAddress}`)
      );
      console.log(chalk.white(`   Signatures Used: ${signatures.length}`));

      // Clean up the executed proposal
      cleanupExecutedProposal(opts.messageHash);

      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(chalk.white("   1. Update multisig configuration if needed"));
      console.log(
        chalk.white(
          "   2. New signer can now participate in multisig operations"
        )
      );
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("execute-remove-signer")
  .description("Execute a remove signer proposal")
  .requiredOption("--message-hash <hash>", "Message hash of the proposal")
  .action(async (opts) => {
    const spinner = ora("Executing remove signer...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("EXECUTE REMOVE SIGNER"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading proposal and signatures...";

      const { proposal, signatures } = getProposalStatus(opts.messageHash);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== "pending") {
        throw new Error(`Proposal is ${proposal.status}, cannot execute`);
      }

      if (proposal.type !== "remove_signer") {
        throw new Error("Proposal is not a remove signer proposal");
      }

      if (signatures.length < proposal.threshold) {
        throw new Error(
          `Insufficient signatures: ${signatures.length}/${proposal.threshold}`
        );
      }

      spinner.text = "Loading wallet and contract...";

      const currentSigner = await getCurrentSigner();
      const currentMultisig = await getCurrentMultisig();

      if (!currentSigner || !currentMultisig) {
        throw new Error("No current signer or multisig set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Use signer-specific PXE
      const { wallet } = await setupPXEForSigner(currentSigner);
      await registerSignersInWallet(wallet, currentMultisig.signers);

      // get current multisig shared state account
      const sharedStateAccount = await getSharedStateAccount(
        currentMultisig.address,
        wallet
      );

      const contractAddress = toAddress(currentMultisig.address);

      const contract = await MultisigAccountContract.at(
        contractAddress,
        wallet
      );

      spinner.text = "Preparing signatures...";

      // Convert signatures to contract format
      const contractSignatures = Array(8)
        .fill(null)
        .map(() => ({
          owner: AztecAddress.ZERO,
          signature: new Array(64).fill(0),
        }));

      signatures.forEach((sig, index) => {
        if (index < 8) {
          // Parse the signature from JSON string back to number array
          const signatureBytes = JSON.parse(sig.signature);

          contractSignatures[index] = {
            owner: AztecAddress.fromString(sig.signerAddress),
            signature: signatureBytes,
          };
        }
      });

      spinner.text = "Executing remove signer transaction...";

      const fee = await setupSponsoredFPC(wallet);

      const proposalData = proposal.data as RemoveSignerData;
      const deadline = BigInt(proposalData.deadline);
      const tx = await contract.methods
        .remove_signer(
          Fr.fromString(opts.messageHash),
          AztecAddress.fromString(proposalData.targetSignerAddress),
          deadline,
          contractSignatures
        )
        .send({
          from: sharedStateAccount.address,
          fee,
        })
        .wait({ timeout: 300_000 });

      // update multisig in multisigs.json
      const multisigs = await listMultisigs();
      const multisig = multisigs.find(
        (m) => m.address == currentMultisig.address
      );
      if (!multisig) {
        throw new Error("Multisig not found");
      }
      multisig.signers = multisig.signers.filter(
        (s) => s !== proposalData.targetSignerName
      );
      await saveMultisig(multisig);

      spinner.succeed("Executed!");

      console.log(chalk.green("\n✅ Signer removed successfully!"));
      console.log(chalk.white(`   TX: ${tx.txHash}`));
      console.log(
        chalk.white(`   Removed Signer: ${proposalData.targetSignerName}`)
      );
      console.log(
        chalk.white(
          `   Removed Signer Address: ${proposalData.targetSignerAddress}`
        )
      );
      console.log(chalk.white(`   Signatures Used: ${signatures.length}`));

      // Clean up the executed proposal
      cleanupExecutedProposal(opts.messageHash);

      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(chalk.white("   1. Verify the signer was removed"));
      console.log(chalk.white("   2. Update any external systems if needed"));
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("execute-change-threshold")
  .description("Execute a change threshold proposal")
  .requiredOption("--message-hash <hash>", "Message hash of the proposal")
  .action(async (opts) => {
    const spinner = ora("Executing change threshold...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("EXECUTE CHANGE THRESHOLD"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading proposal and signatures...";

      const { proposal, signatures } = getProposalStatus(opts.messageHash);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== "pending") {
        throw new Error(`Proposal is ${proposal.status}, cannot execute`);
      }

      if (proposal.type !== "change_threshold") {
        throw new Error("Proposal is not a change threshold proposal");
      }

      if (signatures.length < proposal.threshold) {
        throw new Error(
          `Insufficient signatures: ${signatures.length}/${proposal.threshold}`
        );
      }

      spinner.text = "Loading wallet and contract...";

      const currentSigner = await getCurrentSigner();
      const currentMultisig = await getCurrentMultisig();

      if (!currentSigner || !currentMultisig) {
        throw new Error("No current signer or multisig set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Use signer-specific PXE
      const { wallet } = await setupPXEForSigner(currentSigner);
      await registerSignersInWallet(wallet, currentMultisig.signers);

      // get current multisig shared state account
      const sharedStateAccount = await getSharedStateAccount(
        currentMultisig.address,
        wallet
      );

      const contractAddress = toAddress(currentMultisig.address);

      const contract = await MultisigAccountContract.at(
        contractAddress,
        wallet
      );

      spinner.text = "Preparing signatures...";

      // Convert signatures to contract format
      const contractSignatures = Array(8)
        .fill(null)
        .map(() => ({
          owner: AztecAddress.ZERO,
          signature: new Array(64).fill(0),
        }));

      signatures.forEach((sig, index) => {
        if (index < 8) {
          // Parse the signature from JSON string back to number array
          const signatureBytes = JSON.parse(sig.signature);

          contractSignatures[index] = {
            owner: AztecAddress.fromString(sig.signerAddress),
            signature: signatureBytes,
          };
        }
      });

      spinner.text = "Executing change threshold transaction...";

      const fee = await setupSponsoredFPC(wallet);

      const proposalData = proposal.data as ChangeThresholdData;
      const deadline = BigInt(proposalData.deadline);
      const tx = await contract.methods
        .change_threshold(
          Fr.fromString(opts.messageHash),
          proposalData.newThreshold,
          deadline,
          contractSignatures
        )
        .send({
          from: sharedStateAccount.address,
          fee,
        })
        .wait({ timeout: 300_000 });

      // update multisig in multisigs.json
      const multisigs = await listMultisigs();
      const multisig = multisigs.find(
        (m) => m.address == currentMultisig.address
      );
      if (!multisig) {
        throw new Error("Multisig not found");
      }
      multisig.threshold = proposalData.newThreshold;
      await saveMultisig(multisig);

      spinner.succeed("Executed!");

      console.log(chalk.green("\n✅ Threshold changed successfully!"));
      console.log(chalk.white(`   TX: ${tx.txHash}`));
      console.log(
        chalk.white(`   Old Threshold: ${currentMultisig.threshold}`)
      );
      console.log(
        chalk.white(`   New Threshold: ${proposalData.newThreshold}`)
      );
      console.log(chalk.white(`   Signatures Used: ${signatures.length}`));

      // Clean up the executed proposal
      cleanupExecutedProposal(opts.messageHash);

      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(chalk.white("   1. Verify the threshold was updated"));
      console.log(chalk.white("   2. Update any external systems if needed"));
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

program
  .command("execute-cross-chain-intent")
  .description("Execute a cross-chain intent proposal")
  .requiredOption("--message-hash <hash>", "Message hash of the proposal")
  .action(async (opts) => {
    const spinner = ora("Executing cross-chain intent...").start();
    try {
      console.log("\n" + chalk.cyan("═".repeat(70)));
      console.log(chalk.cyan.bold("EXECUTE CROSS-CHAIN INTENT"));
      console.log(chalk.cyan("═".repeat(70)));

      spinner.text = "Loading proposal and signatures...";

      const { proposal, signatures } = getProposalStatus(opts.messageHash);

      if (!proposal) {
        throw new Error("Proposal not found");
      }

      if (proposal.status !== "pending") {
        throw new Error(`Proposal is ${proposal.status}, cannot execute`);
      }

      if (proposal.type !== "cross_chain_intent") {
        throw new Error("Proposal is not a cross-chain intent proposal");
      }

      if (signatures.length < proposal.threshold) {
        throw new Error(
          `Insufficient signatures: ${signatures.length}/${proposal.threshold}`
        );
      }

      spinner.text = "Loading wallet and contract...";

      const currentSigner = await getCurrentSigner();
      const currentMultisig = await getCurrentMultisig();

      if (!currentSigner || !currentMultisig) {
        throw new Error("No current signer or multisig set");
      }

      requireSignerInMultisig(currentSigner, currentMultisig);

      // Use signer-specific PXE
      const { wallet } = await setupPXEForSigner(currentSigner);
      await registerSignersInWallet(wallet, currentMultisig.signers);

      // get current multisig shared state account
      const sharedStateAccount = await getSharedStateAccount(
        currentMultisig.address,
        wallet
      );

      const contractAddress = toAddress(currentMultisig.address);

      const wormholeAddress = AztecAddress.fromString(WORMHOLE_ADDRESS);
      console.log(
        `🔗 Target Wormhole core contract: ${wormholeAddress.toString()}`
      );
      const nodeClient = createAztecNodeClient(NODE_URL);
      const wormholeInstance = await nodeClient.getContract(wormholeAddress);
      if (!wormholeInstance) {
        throw new Error(
          `No contract instance found at ${wormholeAddress.toString()}`
        );
      }

      await wallet.registerContract({
        instance: wormholeInstance,
        artifact: WormholeContractArtifact,
      });

      const contract = await MultisigAccountContract.at(
        contractAddress,
        wallet
      );

      spinner.text = "Preparing signatures...";

      // Convert signatures to contract format
      const contractSignatures = Array(8)
        .fill(null)
        .map(() => ({
          owner: AztecAddress.ZERO,
          signature: new Array(64).fill(0),
        }));

      signatures.forEach((sig, index) => {
        if (index < 8) {
          // Parse the signature from JSON string back to number array
          const signatureBytes = JSON.parse(sig.signature);

          contractSignatures[index] = {
            owner: AztecAddress.fromString(sig.signerAddress),
            signature: signatureBytes,
          };
        }
      });

      spinner.text = "Executing cross-chain intent transaction...";

      const fee = await setupSponsoredFPC(wallet);

      const proposalData = proposal.data as CrossChainIntentData;
      const deadline = BigInt(proposalData.deadline);
      const tx = await contract.methods
        .execute_cross_chain_intent(
          Fr.fromString(opts.messageHash),
          Fr.fromString(proposalData.targetChain),
          ethToAztecAddress(proposalData.targetContract),
          Fr.fromString(proposalData.intentType),
          Fr.fromString(proposalData.amount),
          ethToAztecAddress(proposalData.recipient),
          AztecAddress.fromString(WORMHOLE_ADDRESS),
          deadline,
          contractSignatures
        )
        .send({
          from: sharedStateAccount.address,
          fee,
        })
        .wait({ timeout: 300_000 });

      spinner.succeed("Executed!");

      console.log(
        chalk.green("\n✅ Cross-chain intent executed successfully!")
      );
      console.log(chalk.white(`   TX: ${tx.txHash}`));
      console.log(chalk.white(`   Target Chain: ${proposalData.targetChain}`));
      console.log(
        chalk.white(`   Target Contract: ${proposalData.targetContract}`)
      );
      console.log(chalk.white(`   Intent Type: ${proposalData.intentType}`));
      console.log(chalk.white(`   Amount: ${proposalData.amount}`));
      console.log(chalk.white(`   Recipient: ${proposalData.recipient}`));
      console.log(chalk.white(`   Signatures Used: ${signatures.length}`));

      // Clean up the executed proposal
      cleanupExecutedProposal(opts.messageHash);

      console.log(chalk.cyan("\n💡 Next steps:"));
      console.log(
        chalk.white(
          "   1. Monitor the Arbitrum network for the intent execution"
        )
      );
      console.log(
        chalk.white(
          "   2. Check the ArbitrumIntentVault contract for execution status"
        )
      );
      console.log(chalk.cyan("═".repeat(70)) + "\n");
    } catch (error: any) {
      spinner.fail("Failed");
      console.error(chalk.red("\n❌ " + error.message + "\n"));
      process.exit(1);
    }
  });

// ================================================
// View Commands
// ================================================

program
  .command("list-proposals")
  .description("List all pending proposals")
  .action(async () => {
    try {
      const proposals = listPendingProposals();

      if (proposals.length === 0) {
        console.log(chalk.yellow("No pending proposals."));
        return;
      }

      console.log(chalk.cyan.bold("Pending Proposals:"));
      console.log(chalk.cyan("=".repeat(60)));

      proposals.forEach((proposal, index) => {
        const { signatures } = getProposalStatus(proposal.messageHash);

        console.log(chalk.white(`${index + 1}. ${proposal.id}`));
        console.log(chalk.gray(`   Type: ${proposal.type}`));
        console.log(chalk.gray(`   Multisig: ${proposal.multisigName}`));
        console.log(chalk.gray(`   Message Hash: ${proposal.messageHash}`));
        console.log(
          chalk.gray(
            `   Progress: ${signatures.length}/${proposal.threshold} signatures`
          )
        );
        console.log(chalk.gray(`   Proposer: ${proposal.proposer}`));
        console.log(chalk.gray(`   Created: ${proposal.createdAt}`));

        // Show type-specific details
        switch (proposal.type) {
          case "add_signer":
            const addData = proposal.data as any;
            console.log(chalk.green(`   New Signer: ${addData.newSignerName}`));
            break;
          case "remove_signer":
            const removeData = proposal.data as any;
            console.log(
              chalk.red(`   Target Signer: ${removeData.targetSignerName}`)
            );
            break;
          case "change_threshold":
            const thresholdData = proposal.data as any;
            console.log(
              chalk.blue(`   New Threshold: ${thresholdData.newThreshold}`)
            );
            break;
          case "cross_chain_intent":
            const crossChainData = proposal.data as any;
            console.log(chalk.magenta(`   Amount: ${crossChainData.amount}`));
            console.log(
              chalk.magenta(`   Recipient: ${crossChainData.recipient}`)
            );
            break;
        }
        console.log("");
      });
    } catch (error) {
      console.error(chalk.red("Error listing proposals:"), error);
      process.exit(1);
    }
  });

program
  .command("list-proxies")
  .description("List all deployed Arbitrum proxies")
  .action(async () => {
    try {
      const proxies = await listArbitrumProxies();
      if (proxies.length === 0) {
        console.log(chalk.yellow("No Arbitrum proxies deployed."));
        return;
      }

      console.log(chalk.cyan.bold("Deployed Arbitrum Proxies:"));
      console.log(chalk.cyan("=".repeat(50)));
      proxies.forEach((proxy, index) => {
        console.log(chalk.white(`${index + 1}. ${proxy.name}`));
        console.log(chalk.gray(`   Address: ${proxy.address}`));
        console.log(chalk.gray(`   Multisig: ${proxy.multisigName}`));
        console.log(chalk.gray(`   Created: ${proxy.createdAt}`));
        console.log("");
      });
    } catch (error) {
      console.error(chalk.red("Error listing proxies:"), error);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current global state")
  .action(async () => {
    try {
      const state = await getGlobalState();
      const currentSigner = await getCurrentSigner();
      const currentMultisig = await getCurrentMultisig();

      console.log(chalk.cyan.bold("Current Global State:"));
      console.log(chalk.cyan("=".repeat(30)));

      if (currentSigner) {
        console.log(chalk.white(`Current Signer: ${currentSigner.name}`));
        console.log(chalk.gray(`  Private Key: ${currentSigner.privateKey}`));
        console.log(chalk.gray(`  Public Key X: ${currentSigner.publicKeyX}`));
        console.log(chalk.gray(`  Public Key Y: ${currentSigner.publicKeyY}`));
      } else {
        console.log(chalk.red("Current Signer: None"));
      }

      console.log("");

      if (currentMultisig) {
        console.log(chalk.white(`Current Multisig: ${currentMultisig.name}`));
        console.log(chalk.gray(`  Aztec Address: ${currentMultisig.address}`));
        if (currentMultisig.arbitrumProxy) {
          console.log(
            chalk.gray(`  Arbitrum Proxy: ${currentMultisig.arbitrumProxy}`)
          );
        }
        console.log(
          chalk.gray(
            `  Threshold: ${currentMultisig.threshold}/${currentMultisig.signers.length}`
          )
        );
        console.log(
          chalk.gray(`  Signers: ${currentMultisig.signers.join(", ")}`)
        );
      } else {
        console.log(chalk.red("Current Multisig: None"));
      }
    } catch (error) {
      console.error(chalk.red("Error getting status:"), error);
      process.exit(1);
    }
  });

program
  .command("list-signers")
  .description("List all registered signers")
  .action(async () => {
    try {
      const signers = await listSigners();
      if (signers.length === 0) {
        console.log(chalk.yellow("No signers registered."));
        return;
      }

      console.log(chalk.cyan.bold("Registered Signers:"));
      console.log(chalk.cyan("=".repeat(50)));
      signers.forEach((signer, index) => {
        console.log(chalk.white(`${index + 1}. ${signer.name}`));
        console.log(chalk.gray(`   Private Key: ${signer.privateKey}`));
        console.log(chalk.gray(`   Public Key X: ${signer.publicKeyX}`));
        console.log(chalk.gray(`   Public Key Y: ${signer.publicKeyY}`));
        console.log("");
      });
    } catch (error) {
      console.error(chalk.red("Error listing signers:"), error);
      process.exit(1);
    }
  });

program
  .command("list-multisigs")
  .description("List all registered multisig contracts")
  .action(async () => {
    try {
      const multisigs = await listMultisigs();
      if (multisigs.length === 0) {
        console.log(chalk.yellow("No multisig contracts registered."));
        return;
      }

      console.log(chalk.cyan.bold("Registered Multisig Contracts:"));
      console.log(chalk.cyan("=".repeat(60)));
      multisigs.forEach((multisig, index) => {
        console.log(chalk.white(`${index + 1}. ${multisig.name}`));
        console.log(chalk.gray(`   Aztec Address: ${multisig.address}`));
        if (multisig.arbitrumProxy) {
          console.log(
            chalk.gray(`   Arbitrum Proxy: ${multisig.arbitrumProxy}`)
          );
        }
        console.log(
          chalk.gray(
            `   Threshold: ${multisig.threshold}/${multisig.signers.length}`
          )
        );
        console.log(chalk.gray(`   Signers: ${multisig.signers.join(", ")}`));
        console.log(chalk.gray(`   Created: ${multisig.createdAt}`));
        console.log("");
      });
    } catch (error) {
      console.error(chalk.red("Error listing multisigs:"), error);
      process.exit(1);
    }
  });

program
  .command("proposal-status")
  .description("Show status of any proposal")
  .requiredOption("--message-hash <hash>", "Message hash of the proposal")
  .action(async (opts) => {
    try {
      const { proposal, signatures, progress } = getProposalStatus(
        opts.messageHash
      );

      if (!proposal) {
        console.log(chalk.red("Proposal not found."));
        return;
      }

      console.log(chalk.cyan.bold("Proposal Status:"));
      console.log(chalk.cyan("=".repeat(40)));
      console.log(chalk.white(`Proposal ID: ${proposal.id}`));
      console.log(chalk.white(`Type: ${proposal.type}`));
      console.log(chalk.white(`Multisig: ${proposal.multisigName}`));
      console.log(chalk.white(`Message Hash: ${proposal.messageHash}`));
      console.log(chalk.white(`Status: ${proposal.status}`));
      console.log(chalk.white(`Progress: ${progress}`));
      console.log(chalk.white(`Proposer: ${proposal.proposer}`));
      console.log(chalk.white(`Created: ${proposal.createdAt}`));

      // Show type-specific details
      switch (proposal.type) {
        case "add_signer":
          const addData = proposal.data as any;
          console.log(chalk.green(`New Signer: ${addData.newSignerName}`));
          console.log(
            chalk.green(`New Signer Address: ${addData.newSignerAddress}`)
          );
          break;
        case "remove_signer":
          const removeData = proposal.data as any;
          console.log(
            chalk.red(`Target Signer: ${removeData.targetSignerName}`)
          );
          console.log(
            chalk.red(
              `Target Signer Address: ${removeData.targetSignerAddress}`
            )
          );
          break;
        case "change_threshold":
          const thresholdData = proposal.data as any;
          console.log(
            chalk.blue(`New Threshold: ${thresholdData.newThreshold}`)
          );
          break;
        case "cross_chain_intent":
          const crossChainData = proposal.data as any;
          console.log(chalk.magenta(`Amount: ${crossChainData.amount}`));
          console.log(chalk.magenta(`Recipient: ${crossChainData.recipient}`));
          console.log(
            chalk.magenta(`Target Chain: ${crossChainData.targetChain}`)
          );
          break;
      }
      console.log("");

      if (signatures.length > 0) {
        console.log(chalk.cyan("Signatures:"));
        signatures.forEach((sig, index) => {
          console.log(
            chalk.gray(`  ${index + 1}. ${sig.signerName} (${sig.createdAt})`)
          );
        });
      }
    } catch (error) {
      console.error(chalk.red("Error getting proposal status:"), error);
      process.exit(1);
    }
  });

// ================================================
// Utility Commands
// ================================================

program
  .command("clean")
  .description(
    "Remove all JSON files (signers, multisigs, proxies, global state)"
  )
  .action(async () => {
    try {
      console.log(chalk.cyan("🧹 Cleaning up all JSON files..."));

      const fs = await import("fs");
      const path = await import("path");

      const filesToRemove = [
        "signers.json",
        "multisigs.json",
        "arbitrum-proxies.json",
        "global-state.json",
        "pending-proposals.json",
        "pending-signatures.json",
      ];

      let removedCount = 0;
      for (const file of filesToRemove) {
        try {
          if (fs.existsSync(file)) {
            fs.unlinkSync(file);
            console.log(chalk.green(`✓ Removed ${file}`));
            removedCount++;
          } else {
            console.log(chalk.gray(`- ${file} (not found)`));
          }
        } catch (error) {
          console.log(chalk.red(`✗ Failed to remove ${file}: ${error}`));
        }
      }

      // Remove all PXE stores (shared and per-signer)
      const storePath = path.resolve(process.cwd(), "store");
      if (fs.existsSync(storePath)) {
        fs.rmSync(storePath, { recursive: true, force: true });
        console.log(chalk.green(`✓ Removed store directory (${storePath})`));
      } else {
        console.log(chalk.gray(`- store directory (not found)`));
      }

      console.log("");
      console.log(
        chalk.green(`🎉 Cleanup complete! Removed ${removedCount} files.`)
      );
      console.log(
        chalk.white(
          "All signers, multisigs, proxies, and global state have been cleared."
        )
      );
    } catch (error) {
      console.error(chalk.red("Error during cleanup:"), error);
      process.exit(1);
    }
  });

program.parse();
