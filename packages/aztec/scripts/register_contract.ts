// scripts/register_contract.ts
import "dotenv/config";
import { AztecAddress, Fr } from "@aztec/aztec.js";
import { PrivateMultisigContract } from "../src/artifacts/PrivateMultisig.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";

const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(BigInt(hex).toString());

async function main() {
  console.log("📝 Registering contract with PXE...");
  
  const pxe = await setupPXE();
  const address = AztecAddress.fromString(process.env.PRIVATE_MULTISIG_ADDRESS!);
  
  // Register deployer account first
  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const deployerPrivKey = toScalar(process.env.PRIV_DEPLOYER!);
  
  console.log("Registering deployer account...");
  const deployerAcctMgr = await getSchnorrAccount(pxe, secretKey, deployerPrivKey, salt);
  await deployerAcctMgr.register();
  
  console.log("Waiting for contract instance...");
  let instance = null;
  
  // Retry to get contract instance
  for (let i = 0; i < 10; i++) {
    instance = await pxe.getContractInstance(address);
    if (instance) break;
    console.log(`  Attempt ${i + 1}/10...`);
    await new Promise(r => setTimeout(r, 2000));
  }
  
  if (!instance) {
    console.error("❌ Contract instance still not found!");
    console.log("\n⚠️  Try running: npm run deploy");
    process.exit(1);
  }
  
  await pxe.registerContract({
    instance,
    artifact: PrivateMultisigContract.artifact,
  });
  
  console.log("✅ Contract registered!");
  console.log(`Address: ${address}`);
}

main().catch(console.error);