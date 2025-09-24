import { ethers } from "ethers";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

async function registerAztecEmitter() {
  console.log(
    "🔗 Step 3: Register/Update Aztec contract as Wormhole emitter..."
  );

  // Step 3.1: Load configurations
  console.log("Step 3.1: Loading configurations...");

  // Load Arbitrum config
  const requiredEnv = ["PRIVATE_KEY", "ARBITRUM_RPC", "ARBITRUM_VAULT_ADDRESS"];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  // Load Aztec config
  const aztecEnvPath = path.resolve(process.cwd(), ".env.crosschain");
  const aztecEnvContent = fs.readFileSync(aztecEnvPath, "utf8");
  const aztecConfig: any = {};

  aztecEnvContent.split("\n").forEach((line) => {
    if (line.includes("=") && !line.startsWith("#") && line.trim()) {
      const [key, value] = line.split("=");
      aztecConfig[key.trim()] = value.trim();
    }
  });

  const aztecAddress = aztecConfig.DEPLOYED_ADDRESS;
  if (!aztecAddress) {
    throw new Error("Could not find DEPLOYED_ADDRESS in .env.crosschain");
  }

  console.log(`✅ Arbitrum RPC: ${process.env.ARBITRUM_RPC}`);
  console.log(`✅ Vault address: ${process.env.ARBITRUM_VAULT_ADDRESS}`);
  console.log(`✅ Aztec contract: ${aztecAddress}`);

  // Step 3.2: Setup connection
  console.log("\nStep 3.2: Setting up connection...");
  const provider = new ethers.JsonRpcProvider(process.env.ARBITRUM_RPC);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

  console.log(`✅ Wallet: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`✅ Balance: ${ethers.formatEther(balance)} ETH`);

  // Step 3.3: Setup vault contract
  console.log("\nStep 3.3: Setting up vault contract...");
  const vaultAbi = [
    "function owner() external view returns (address)",
    "function vaultContracts(uint16) external view returns (bytes32)",
    "function registerEmitter(uint16 chainId_, bytes32 emitterAddress_) external",
    "event EmitterRegistered(uint16 indexed chainId, bytes32 indexed emitterAddress)",
  ];

  const vault = new ethers.Contract(
    process.env.ARBITRUM_VAULT_ADDRESS!,
    vaultAbi,
    wallet
  );

  // Verify ownership
  const owner = await vault.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Wallet ${wallet.address} is not the vault owner ${owner}`);
  }
  console.log(`✅ Confirmed wallet is vault owner`);

  // Step 3.4: Check current registration
  console.log("\nStep 3.4: Checking current emitter registration...");
  const aztecChainId = 56; // Aztec chain ID in Wormhole
  const currentEmitter = await vault.vaultContracts(aztecChainId);

  console.log(`Current registered emitter: ${currentEmitter}`);
  console.log(`New Aztec contract: ${aztecAddress}`);

  // Convert Aztec address to bytes32 format
  let aztecBytes32: string;
  if (aztecAddress.startsWith("0x")) {
    // Ensure it's exactly 32 bytes (64 hex chars + 0x)
    if (aztecAddress.length === 66) {
      aztecBytes32 = aztecAddress;
    } else {
      // Pad with zeros if needed
      aztecBytes32 = aztecAddress + "0".repeat(66 - aztecAddress.length);
    }
  } else {
    aztecBytes32 = "0x" + aztecAddress + "0".repeat(64 - aztecAddress.length);
  }

  console.log(`Aztec address as bytes32: ${aztecBytes32}`);

  // Check if update needed
  const needsUpdate =
    currentEmitter.toLowerCase() !== aztecBytes32.toLowerCase();

  if (!needsUpdate) {
    console.log("✅ Emitter already correctly registered!");
    console.log("No update needed.");
    return {
      success: true,
      updated: false,
      emitter: currentEmitter,
    };
  }

  console.log("ℹ️  Emitter needs to be updated");

  // Step 3.5: Register/Update emitter
  console.log("\nStep 3.5: Registering new emitter...");

  let tx: any = null;

  try {
    // Estimate gas
    const gasEstimate = await vault.registerEmitter.estimateGas(
      aztecChainId,
      aztecBytes32
    );
    console.log(`✅ Gas estimate: ${gasEstimate.toString()}`);

    // Send transaction
    console.log("📤 Sending registration transaction...");
    tx = await vault.registerEmitter(aztecChainId, aztecBytes32, {
      gasLimit: (gasEstimate * 120n) / 100n, // 20% buffer
    });

    console.log(`✅ Transaction sent: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");

    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block ${receipt.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

    // Verify registration
    const updatedEmitter = await vault.vaultContracts(aztecChainId);
    const registrationSuccess =
      updatedEmitter.toLowerCase() === aztecBytes32.toLowerCase();

    if (registrationSuccess) {
      console.log("✅ Emitter registration successful!");
      console.log(`✅ Verified emitter: ${updatedEmitter}`);
    } else {
      throw new Error(
        `Registration failed. Expected: ${aztecBytes32}, Got: ${updatedEmitter}`
      );
    }
  } catch (error) {
    console.error("❌ Registration transaction failed:", error);
    throw error;
  }

  // Step 3.6: Final verification
  console.log("\nStep 3.6: Final verification...");
  const finalEmitter = await vault.vaultContracts(aztecChainId);
  const finalVerification =
    finalEmitter.toLowerCase() === aztecBytes32.toLowerCase();

  console.log("📊 Registration Summary:");
  console.log("=".repeat(50));
  console.log(`Aztec Chain ID: ${aztecChainId}`);
  console.log(`Previous Emitter: ${currentEmitter}`);
  console.log(`New Emitter: ${finalEmitter}`);
  console.log(
    `Registration Success: ${finalVerification ? "✅ YES" : "❌ NO"}`
  );
  console.log(`Vault Contract: ${process.env.ARBITRUM_VAULT_ADDRESS}`);
  console.log(`Transaction Hash: ${tx?.hash || "N/A"}`);
  console.log("=".repeat(50));

  if (finalVerification) {
    console.log("\n🎉 Step 3 completed successfully!");
    console.log("✅ Aztec multisig contract is now registered as emitter");
    console.log("✅ Ready for Step 4: Test cross-chain message flow");
  }

  return {
    success: finalVerification,
    updated: true,
    emitter: finalEmitter,
    transactionHash: tx?.hash,
  };
}

// Export for use in other scripts
export { registerAztecEmitter };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  registerAztecEmitter()
    .then((result) => {
      if (result.success) {
        console.log("🎊 Emitter registration completed successfully!");
        if (result.updated) {
          console.log(`Transaction: ${result.transactionHash}`);
        }
      } else {
        console.log("❌ Emitter registration failed");
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Emitter registration failed:", error);
      process.exit(1);
    });
}
