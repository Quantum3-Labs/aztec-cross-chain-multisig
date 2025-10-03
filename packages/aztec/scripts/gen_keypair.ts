import "dotenv/config";
import fs from "fs";
import path from "path";
import { Fr } from "@aztec/aztec.js";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";

const ENV_PATH = process.env.ENV_PATH || path.resolve(process.cwd(), ".env");

const toHex0x = (x: { toString(): string }) =>
  "0x" + BigInt(x.toString()).toString(16).padStart(64, "0");

function readEnvLines(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split(/\r?\n/);
}

function writeEnvLines(p: string, lines: string[]) {
  fs.writeFileSync(p, lines.join("\n"));
}

function updateEnv(lines: string[], kv: Record<string, string>): string[] {
  const idx: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l || l.trim().startsWith("#")) continue;
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) idx[m[1]] = i;
  }
  for (const [k, v] of Object.entries(kv)) {
    if (idx[k] !== undefined) {
      const i = idx[k];
      const leading = (lines[i].match(/^\s*/) || [""])[0];
      lines[i] = `${leading}${k}=${v}`;
    } else {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      lines.push(`${k}=${v}`);
    }
  }
  return lines;
}

async function main() {
  console.log("=".repeat(70));
  console.log("GENERATING DEPLOYER + 3 SIGNER KEYPAIRS");
  console.log("=".repeat(70) + "\n");

  const secret = Fr.random();
  const salt = Fr.random();
  
  const privDeployer = GrumpkinScalar.random();
  
  const priv1 = GrumpkinScalar.random();
  const priv2 = GrumpkinScalar.random();
  const priv3 = GrumpkinScalar.random();

  const grumpkin = new Grumpkin();
  const gen = grumpkin.generator();
  const pubDeployer = await grumpkin.mul(gen, privDeployer);
  const pub1 = await grumpkin.mul(gen, priv1);
  const pub2 = await grumpkin.mul(gen, priv2);
  const pub3 = await grumpkin.mul(gen, priv3);

  const kv: Record<string, string> = {
    SECRET_KEY: toHex0x(secret),
    SALT: toHex0x(salt),
    
    PRIV_DEPLOYER: toHex0x(privDeployer),
    PUB_DEPLOYER_X: toHex0x(pubDeployer.x),
    PUB_DEPLOYER_Y: toHex0x(pubDeployer.y),
    
    PRIV1: toHex0x(priv1),
    PRIV2: toHex0x(priv2),
    PRIV3: toHex0x(priv3),
    
    PUB1_X: toHex0x(pub1.x),
    PUB1_Y: toHex0x(pub1.y),
    PUB2_X: toHex0x(pub2.x),
    PUB2_Y: toHex0x(pub2.y),
    PUB3_X: toHex0x(pub3.x),
    PUB3_Y: toHex0x(pub3.y),
  };

  const lines = readEnvLines(ENV_PATH);
  const out = updateEnv(lines, kv);
  writeEnvLines(ENV_PATH, out);

  console.log("✓ Keys generated and saved to .env\n");
  console.log("DEPLOYER (Admin account - not a signer):");
  console.log(`  PRIV_DEPLOYER = ${kv.PRIV_DEPLOYER}`);
  console.log(`  PUB_DEPLOYER_X = ${kv.PUB_DEPLOYER_X}`);
  console.log(`  PUB_DEPLOYER_Y = ${kv.PUB_DEPLOYER_Y}\n`);
  
  console.log("SIGNER 1:");
  console.log(`  PRIV1 = ${kv.PRIV1}`);
  console.log(`  PUB1_X = ${kv.PUB1_X}`);
  console.log(`  PUB1_Y = ${kv.PUB1_Y}\n`);
  
  console.log("SIGNER 2:");
  console.log(`  PRIV2 = ${kv.PRIV2}`);
  console.log(`  PUB2_X = ${kv.PUB2_X}`);
  console.log(`  PUB2_Y = ${kv.PUB2_Y}\n`);
  
  console.log("SIGNER 3:");
  console.log(`  PRIV3 = ${kv.PRIV3}`);
  console.log(`  PUB3_X = ${kv.PUB3_X}`);
  console.log(`  PUB3_Y = ${kv.PUB3_Y}\n`);
  
  console.log("SECRET_KEY = " + kv.SECRET_KEY);
  console.log("SALT = " + kv.SALT + "\n");
  console.log("=".repeat(70));
}

main().catch(e => { console.error(e); process.exit(1); });