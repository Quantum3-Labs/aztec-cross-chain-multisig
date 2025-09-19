import "dotenv/config";
import { AztecAddress, Fr, getContractInstanceFromDeployParams } from "@aztec/aztec.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { WormholeContractArtifact } from "../src/artifacts/Wormhole.js";

async function main() {
  const pxe = await setupPXE();

  const chainId = Number(process.env.AZTEC_CHAIN_ID ?? 777);
  const evmChainId = Number(process.env.L1_CHAIN_ID ?? 11155111);

  if (!process.env.BRIDGE_RECEIVER || !process.env.TOKEN_ADDRESS) {
    throw new Error("Missing BRIDGE_RECEIVER or TOKEN_ADDRESS in .env");
  }

  const receiver = AztecAddress.fromString(process.env.BRIDGE_RECEIVER);
  const token = AztecAddress.fromString(process.env.TOKEN_ADDRESS);

  const wormholeInstance = await getContractInstanceFromDeployParams(WormholeContractArtifact, {
    salt: new Fr(0),
    constructorArgs: [chainId, evmChainId, receiver, token],
  });

  await pxe.registerContract({ instance: wormholeInstance, artifact: WormholeContractArtifact });

  console.log(
    `✅ Wormhole contract added: ${WormholeContractArtifact.name} at ${wormholeInstance.address.toString()}`
  );

  const contracts = await pxe.getContracts();
  console.log("📋 Contracts currently registered in PXE:");
  contracts.forEach(c => {
    console.log(` - ${c}`);
  });

}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
