import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export interface ArbitrumProxy {
  name: string;
  address: string;
  multisigName: string;
  createdAt: string;
}

const ARBITRUM_CONTRACTS_DIR = path.resolve(
  process.cwd(),
  "arbitrum-contracts"
);
const PROXIES_FILE = path.resolve(process.cwd(), "arbitrum-proxies.json");

function readProxies(): ArbitrumProxy[] {
  if (!fs.existsSync(PROXIES_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(PROXIES_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      "Warning: Could not read arbitrum proxies file, starting with empty list"
    );
    return [];
  }
}

function writeProxies(proxies: ArbitrumProxy[]): void {
  fs.writeFileSync(PROXIES_FILE, JSON.stringify(proxies, null, 2));
}

export async function deployArbitrumProxy(
  multisigName: string
): Promise<ArbitrumProxy> {
  console.log(`🚀 Deploying Arbitrum proxy for multisig: ${multisigName}`);

  // Set environment variables for the deployment script
  const env = {
    ...process.env,
    MULTISIG_NAME: multisigName,
  };

  try {
    // Change to arbitrum-contracts directory and run deployment
    const command = `cd ${ARBITRUM_CONTRACTS_DIR} && forge script script/DeployMultisigProxy.s.sol --broadcast -vvvv --rpc-url https://sepolia-rollup.arbitrum.io/rpc`;

    console.log("Executing deployment command...");
    const output = execSync(command, {
      env,
      encoding: "utf8",
      stdio: "pipe",
    });

    console.log("Deployment output:", output);

    // Extract the deployed address from the console output
    const addressMatch = output.match(
      /Multisig Proxy deployed at: (0x[a-fA-F0-9]{40})/
    );
    if (!addressMatch) {
      throw new Error("Failed to extract proxy address from deployment output");
    }
    const proxyAddress = addressMatch[1];

    const proxy: ArbitrumProxy = {
      name: `${multisigName}-Proxy`,
      address: proxyAddress,
      multisigName,
      createdAt: new Date().toISOString(),
    };

    // Save proxy information
    const proxies = readProxies();
    proxies.push(proxy);
    writeProxies(proxies);

    console.log(`✅ Arbitrum proxy deployed at: ${proxyAddress}`);
    return proxy;
  } catch (error) {
    console.error("Error deploying Arbitrum proxy:", error);
    throw error;
  }
}

export async function listArbitrumProxies(): Promise<ArbitrumProxy[]> {
  return readProxies();
}

export async function getArbitrumProxy(
  multisigName: string
): Promise<ArbitrumProxy | null> {
  const proxies = readProxies();
  return proxies.find((p) => p.multisigName === multisigName) || null;
}
