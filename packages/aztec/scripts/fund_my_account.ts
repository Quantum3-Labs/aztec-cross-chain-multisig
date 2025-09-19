import "dotenv/config";
import { AztecAddress } from "@aztec/aztec.js";
import { setupPXE } from "../src/utils/setup_pxe.js";

async function checkMyAccount() {
  const pxe = await setupPXE();
  
  const myAddress = AztecAddress.fromString(
    process.env.ACCOUNT_ADDRESS!
  );
  
  try {
    const accounts = await pxe.getRegisteredAccounts();
    console.log(`\n📊 Total accounts in sandbox: ${accounts.length}`);
    
    const found = accounts.find(
      acc => acc.address.toString() === myAddress.toString()
    );
    
    if (found) {
      console.log("\n✅ Your account is REGISTERED");
      console.log(`📍 Address: ${myAddress.toString()}`);
      console.log("\n💡 Next steps:");
      console.log("   1. Your account needs Fee Juice tokens to deploy");
      console.log("   2. Sandbox account 0 has tokens");
      console.log("   3. Need to transfer tokens to your account");
    } else {
      console.log("\n❌ Your account NOT found");
      console.log("💡 Run 'npm run deploy:account' first");
    }
    
    if (accounts.length > 0) {
      console.log("\n💰 Sandbox account 0 (has tokens):");
      console.log(`   ${accounts[0].address.toString()}`);
    }
    
  } catch (error) {
    console.log("❌ Error:", error);
    console.log("💡 Make sure 'aztec sandbox' is running");
  }
}

checkMyAccount().catch(console.error);