import { Fr } from "@aztec/aztec.js";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { Schnorr } from "@aztec/foundation/crypto";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const ENV_FILE = ".env";

function to0xHex32(u8: Uint8Array) {
  const hex = Buffer.from(u8).toString("hex").padStart(64, "0");
  return "0x" + hex;
}

function saveEnv(key: string, value: string) {
  let env = fs.existsSync(ENV_FILE)
    ? fs.readFileSync(ENV_FILE, "utf-8").split("\n")
    : [];
  const existingIdx = env.findIndex((line) => line.startsWith(key + "="));
  if (existingIdx >= 0) {
    env[existingIdx] = `${key}=${value}`;
  } else {
    env.push(`${key}=${value}`);
  }
  fs.writeFileSync(ENV_FILE, env.join("\n"));
}

export async function exportPubKey() {
  let secret = process.env.SECRET;
  let salt = process.env.SALT;

  if (!secret) {
    secret = Fr.random().toString();
    saveEnv("SECRET", secret);
    console.log("Generated new SECRET and saved to .env");
  }

  if (!salt) {
    salt = Fr.random().toString();
    saveEnv("SALT", salt);
    console.log("Generated new SALT and saved to .env");
  }

  const secretHex = secret.startsWith("0x") ? secret.slice(2) : secret;
  const secretKey = Fr.fromBuffer(Buffer.from(secretHex, "hex"));

  const signingKey = deriveSigningKey(secretKey);
  const schnorr = new Schnorr();
  const pubKey = await schnorr.computePublicKey(signingKey);

  let xHex: string;
  let yHex: string;

  if (typeof (pubKey.x as any).toBuffer === "function") {
    xHex = to0xHex32((pubKey.x as any).toBuffer());
    yHex = to0xHex32((pubKey.y as any).toBuffer());
  } else {
    const xDec = pubKey.x.toString();
    const yDec = pubKey.y.toString();
    xHex = "0x" + BigInt(xDec).toString(16).padStart(64, "0");
    yHex = "0x" + BigInt(yDec).toString(16).padStart(64, "0");
  }

  console.log("👉 PUBLIC_KEY.x =", xHex);
  console.log("👉 PUBLIC_KEY.y =", yHex);

  console.log(
    `
global PUBLIC_KEY: EmbeddedCurvePoint = EmbeddedCurvePoint {
  x: ${xHex},
  y: ${yHex},
  is_infinite: false,
};`.trim()
  );
}

exportPubKey().catch((err) => {
  console.error(err);
  process.exit(1);
});
