import "dotenv/config";
import { ethers } from "ethers";

async function main() {
  const RPC = "https://sepolia-rollup.arbitrum.io/rpc";
  const CORE = "0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35";
  if (!RPC || !CORE) throw new Error("Missing ARBITRUM_RPC or ARB_WORMHOLE_CORE/WORMHOLE_ADDRESS");

  const provider = new ethers.JsonRpcProvider(RPC);
  const abi = ["function chainId() view returns (uint16)"];
  const core = new ethers.Contract(CORE, abi, provider);

  const id: number = await core.chainId();
  console.log("WH_CHAIN_ID_ARB =", id);
}

main().catch((e) => { console.error(e); process.exit(1); });
