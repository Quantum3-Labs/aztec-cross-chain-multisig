import "dotenv/config";
import fs from "fs";
import path from "path";
import { AztecAddress, Fr, EthAddress, createLogger } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { MultiSchnorrPortalAccountContract } from "../src/artifacts/MultiSchnorrPortalAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toBig = (hex: string) => BigInt(hex);
const toFr = (hex: string) => Fr.fromString(toBig(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(toBig(hex).toString());
const parseEth = (s: string) => EthAddress.fromString("0x" + s.replace(/^0x/i, "").toLowerCase());
const maybeFr = (k: string) => (process.env[k] ? toFr(process.env[k] as string) : undefined);

async function main() {
  const logger = createLogger("crosschain-multisig");
  const pxe = await setupPXE();
  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const priv1 = toScalar(process.env.PRIV1!);
  const priv2 = toScalar(process.env.PRIV2!);
  const priv3 = toScalar(process.env.PRIV3!);

  const grumpkin = new Grumpkin();
  const gen = grumpkin.generator();
  const dpub1 = await grumpkin.mul(gen, priv1);
  const dpub2 = await grumpkin.mul(gen, priv2);
  const dpub3 = await grumpkin.mul(gen, priv3);

  const pub1x = maybeFr("PUB1_X") ?? dpub1.x;
  const pub1y = maybeFr("PUB1_Y") ?? dpub1.y;
  const pub2x = maybeFr("PUB2_X") ?? dpub2.x;
  const pub2y = maybeFr("PUB2_Y") ?? dpub2.y;
  const pub3x = maybeFr("PUB3_X") ?? dpub3.x;
  const pub3y = maybeFr("PUB3_Y") ?? dpub3.y;

  const portal = parseEth(process.env.PORTAL!);
  const emitter = parseEth(process.env.L1_EMITTER!);
  const threshold = Number(process.env.THRESHOLD ?? "2");

  const acctMgr = await getSchnorrAccount(pxe, secretKey, priv1, salt);
  await (await acctMgr.deploy({ fee })).wait({ timeout: 180000 });
  const ownerWallet = await acctMgr.getWallet();
  const owner: AztecAddress = ownerWallet.getAddress();

  const dm = MultiSchnorrPortalAccountContract.deploy(
    ownerWallet,
    pub1x, pub1y,
    pub2x, pub2y,
    pub3x, pub3y,
    threshold,
    portal,
    emitter
  );
  const sent = dm.send({ from: owner, fee });
  const receipt = await sent.wait({ timeout: 180000 });

  const deployed = receipt.contract.address as AztecAddress;

  const envFile = process.env.ENV_PATH || path.resolve(process.cwd(), ".env");
  const lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/) : [];
  const map: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m) map[m[1]] = i;
  }
  const set = (k: string, v: string) => {
    if (map[k] !== undefined) lines[map[k]] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  };
  set("MULTISIG_ADDRESS", deployed.toString());
  set("DEPLOY_TX_HASH", receipt.txHash.toString());
  set("DEPLOY_TIMESTAMP", new Date().toISOString());
  fs.writeFileSync(envFile, lines.join("\n"));

  console.log("DEPLOYED_ADDRESS=", deployed.toString());
  console.log("DEPLOY_TX_HASH=", receipt.txHash);
}

main().catch(e => { console.error(e); process.exit(1); });
