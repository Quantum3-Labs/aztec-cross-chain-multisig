import { createAztecNodeClient } from "@aztec/aztec.js";

async function checkNodeInfo() {
  const node = createAztecNodeClient("https://aztec-alpha-testnet-fullnode.zkv.xyz");
  const info = await node.getNodeInfo();
  console.log("Node info:", JSON.stringify(info, null, 2));
}

checkNodeInfo().catch(console.error);