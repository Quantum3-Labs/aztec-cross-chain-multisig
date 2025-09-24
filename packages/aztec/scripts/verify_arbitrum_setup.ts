import { ethers } from "ethers";
import * as dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

interface ArbitrumConfig {
  PRIVATE_KEY: string;
  ARBITRUM_RPC: string;
  ARBITRUM_VAULT_ADDRESS: string;
  ARBITRUM_DONATION_ADDRESS?: string;
}

function loadArbitrumConfig(): ArbitrumConfig {
  const required = ["PRIVATE_KEY", "ARBITRUM_RPC", "ARBITRUM_VAULT_ADDRESS"];

  const config: any = {};

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(
        `Missing required environment variable: ${key}. Please add to .env file`
      );
    }
    config[key] = process.env[key];
  }

  // Optional - không bắt buộc
  config.ARBITRUM_DONATION_ADDRESS = process.env.ARBITRUM_DONATION_ADDRESS;

  return config as ArbitrumConfig;
}

async function verifyArbitrumSetup() {
  console.log("🔗 Step 2: Verifying Arbitrum setup and connections...");

  // Step 2.1: Load and validate configuration
  console.log("Step 2.1: Loading Arbitrum configuration...");
  const config = loadArbitrumConfig();
  console.log(
    `✅ Private key loaded: ${config.PRIVATE_KEY.substring(0, 10)}...`
  );
  console.log(`✅ Arbitrum RPC: ${config.ARBITRUM_RPC}`);
  console.log(`✅ Vault address: ${config.ARBITRUM_VAULT_ADDRESS}`);
  if (config.ARBITRUM_DONATION_ADDRESS) {
    console.log(`✅ Donation address: ${config.ARBITRUM_DONATION_ADDRESS}`);
  }

  // Step 2.2: Setup Arbitrum connection
  console.log("\nStep 2.2: Testing Arbitrum connection...");
  const provider = new ethers.JsonRpcProvider(config.ARBITRUM_RPC);
  const network = await provider.getNetwork();
  try {
    console.log(
      `✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`
    );

    if (network.chainId !== 421614n) {
      console.warn(
        `⚠️  Warning: Expected Arbitrum Sepolia (421614), got ${network.chainId}`
      );
    }

    const blockNumber = await provider.getBlockNumber();
    console.log(`✅ Latest block: ${blockNumber}`);
  } catch (error) {
    console.error("❌ Failed to connect to Arbitrum:", error);
    throw error;
  }

  // Step 2.3: Setup wallet and check balance
  console.log("\nStep 2.3: Setting up wallet...");
  const wallet = new ethers.Wallet(config.PRIVATE_KEY, provider);
  console.log(`✅ Wallet address: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  const balanceEth = ethers.formatEther(balance);
  console.log(`✅ Wallet balance: ${balanceEth} ETH`);

  if (parseFloat(balanceEth) < 0.001) {
    console.warn(
      "⚠️  Warning: Low ETH balance. You may need more ETH for transactions."
    );
  }

  // Step 2.4: Verify vault contract
  console.log("\nStep 2.4: Verifying vault contract...");
  const vaultAbi = [
    "function owner() external view returns (address)",
    "function vaultContracts(uint16) external view returns (bytes32)",
    "function registerEmitter(uint16 chainId_, bytes32 emitterAddress_) external",
    "function verifyAndProcessIntent(bytes memory encodedVm) external",
  ];
  const vault = new ethers.Contract(
    config.ARBITRUM_VAULT_ADDRESS,
    vaultAbi,
    wallet
  );
  const owner = await vault.owner();
  const isOwner = owner.toLowerCase() === wallet.address.toLowerCase();

  try {
    // Check if contract exists
    const code = await provider.getCode(config.ARBITRUM_VAULT_ADDRESS);
    if (code === "0x") {
      throw new Error("Vault contract not deployed at specified address");
    }
    console.log(`✅ Vault contract exists at ${config.ARBITRUM_VAULT_ADDRESS}`);

    // Check owner

    console.log(`✅ Vault owner: ${owner}`);

    console.log(`✅ Wallet is owner: ${isOwner}`);

    if (!isOwner) {
      console.warn(
        "⚠️  Warning: Wallet is not the owner. Cannot register emitters."
      );
    }

    // Check existing registrations
    console.log("\n🔍 Checking existing emitter registrations...");
    const aztecChainId = 56; // Aztec chain ID in Wormhole
    const existingEmitter = await vault.vaultContracts(aztecChainId);
    console.log(`✅ Aztec chain ${aztecChainId} emitter: ${existingEmitter}`);

    if (
      existingEmitter ===
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      console.log(
        "ℹ️  No Aztec emitter registered yet - ready for registration"
      );
    } else {
      console.log("ℹ️  Aztec emitter already registered");
    }
  } catch (error) {
    console.error("❌ Vault contract verification failed:", error);
    throw error;
  }

  // Step 2.5: Verify donation contract (if provided)
  if (config.ARBITRUM_DONATION_ADDRESS) {
    console.log("\nStep 2.5: Verifying donation contract...");

    try {
      const donationCode = await provider.getCode(
        config.ARBITRUM_DONATION_ADDRESS
      );
      if (donationCode === "0x") {
        console.warn("⚠️  Donation contract not found at specified address");
      } else {
        console.log(
          `✅ Donation contract exists at ${config.ARBITRUM_DONATION_ADDRESS}`
        );

        // Try to check some basic info
        const donationAbi = [
          "function receiver() external view returns (address)",
          "function name() external view returns (string)",
          "function symbol() external view returns (string)",
        ];

        const donation = new ethers.Contract(
          config.ARBITRUM_DONATION_ADDRESS,
          donationAbi,
          provider
        );

        try {
          const receiver = await donation.receiver();
          const name = await donation.name();
          const symbol = await donation.symbol();
          console.log(`✅ Donation receiver: ${receiver}`);
          console.log(`✅ Token: ${name} (${symbol})`);
        } catch (error) {
          console.log(
            "ℹ️  Could not read donation contract details (may be normal)"
          );
        }
      }
    } catch (error) {
      console.warn("⚠️  Could not verify donation contract:", error);
    }
  }

  // Step 2.6: Load Aztec config for next step
  console.log("\nStep 2.6: Loading Aztec config for registration...");
  let aztecContractAddress = "";

  try {
    const aztecEnvPath = path.resolve(process.cwd(), ".env.crosschain");
    const aztecEnvContent = fs.readFileSync(aztecEnvPath, "utf8");

    const aztecConfig: any = {};
    aztecEnvContent.split("\n").forEach((line) => {
      if (line.includes("=") && !line.startsWith("#") && line.trim()) {
        const [key, value] = line.split("=");
        aztecConfig[key.trim()] = value.trim();
      }
    });

    aztecContractAddress = aztecConfig.DEPLOYED_ADDRESS;
    console.log(`✅ Aztec multisig address: ${aztecContractAddress}`);
  } catch (error) {
    console.warn("⚠️  Could not load Aztec config. Run Step 1 first.");
  }

  // Summary
  console.log("\n📊 Arbitrum Setup Summary:");
  console.log("=".repeat(50));
  console.log(`Network: Arbitrum Sepolia (${network.chainId})`);
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Balance: ${balanceEth} ETH`);
  console.log(`Vault Contract: ${config.ARBITRUM_VAULT_ADDRESS}`);
  console.log(`Vault Owner: ${await vault.owner()}`);
  console.log(`Can Register: ${isOwner ? "Yes" : "No"}`);
  console.log(`Aztec Contract: ${aztecContractAddress || "Not loaded"}`);
  console.log("=".repeat(50));

  if (isOwner && aztecContractAddress) {
    console.log("\n✅ Ready for Step 3: Register Aztec contract as emitter");
  } else {
    if (!isOwner) {
      console.log("\n❌ Cannot proceed: Wallet is not vault owner");
    }
    if (!aztecContractAddress) {
      console.log("\n❌ Cannot proceed: Aztec contract address not found");
    }
  }

  return {
    success: true,
    canRegister: isOwner && !!aztecContractAddress,
    config: {
      network: network.chainId.toString(),
      wallet: wallet.address,
      balance: balanceEth,
      vaultAddress: config.ARBITRUM_VAULT_ADDRESS,
      aztecAddress: aztecContractAddress,
    },
  };
}

// Export for use in other scripts
export { verifyArbitrumSetup, loadArbitrumConfig };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  verifyArbitrumSetup()
    .then((result) => {
      if (result.canRegister) {
        console.log("🎉 Arbitrum setup verification completed successfully!");
      } else {
        console.log("⚠️  Setup issues detected. Please fix before proceeding.");
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Arbitrum setup verification failed:", error);
      process.exit(1);
    });
}
