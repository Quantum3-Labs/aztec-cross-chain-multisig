import "dotenv/config";
import { AztecAddress, Fr } from "@aztec/aztec.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { MyCustomAccountContract } from "../src/accounts/MyCustomAccount.js";
import { AccountManager } from "@aztec/aztec.js";
import { MyCustomAccountContract as MyCustomAccountWrapper } from "../src/artifacts/MyCustomAccount.js";

async function sendCrossChainMessage() {
  console.log("🚀 Starting cross-chain message test...");
  
  const pxe = await setupPXE();
  const secretKeyHex = process.env.SECRET!;
  const salt = Fr.fromString(process.env.SALT!);

  console.log("📦 Setting up account...");
  const accountContract = new MyCustomAccountContract(secretKeyHex);
  const account = await AccountManager.create(
    pxe,
    Fr.fromString(secretKeyHex),
    accountContract,
    salt
  );
  const wallet = await account.getWallet();
  console.log("💼 Wallet address:", wallet.getAddress().toString());

  const wormholeAddress = AztecAddress.fromString(process.env.WORMHOLE_ADDRESS!);

  const targetEthAddress = "0x781a68C3149d13D05a5F0C9E22C9D321d6f620E1";
  const targetAddressField = Fr.fromString(
    "0x" + targetEthAddress.slice(2).padStart(64, "0")
  );

  const amount = Fr.fromString("100");
  const intentType = Fr.fromString("0");
  const nonce = Fr.random();

  console.log("📝 Intent details:");
  console.log("  - Target (Arbitrum):", targetEthAddress);
  console.log("  - Amount:", amount.toString());
  console.log("  - Nonce:", nonce.toString());

  const contract = await MyCustomAccountWrapper.at(
    await wallet.getAddress(),
    wallet
  );

  console.log("📤 Sending cross-chain message...");
  try {
    const tx = contract.methods
      .send_cross_chain_message(
        wormholeAddress,
        targetAddressField,
        amount,
        intentType,
        nonce
      )
      .send();

    console.log("⏳ Waiting for transaction...");
    await tx.wait();
    console.log("✅ Cross-chain message sent!");
    console.log("📋 Transaction hash:", tx);
  } catch (error) {
    console.error("❌ Error:", error);
    console.log("\n⚠️  If error is 'No contract instance found for Wormhole':");
    console.log("Use the mocked version of main.nr to test without Wormhole");
  }
}

sendCrossChainMessage().catch(console.error);
