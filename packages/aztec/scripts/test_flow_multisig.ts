import "dotenv/config";
import fs from "fs";
import path from "path";
import { AztecAddress, Fr, EthAddress } from "@aztec/aztec.js";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { MultiSchnorrPortalAccountContract } from "../src/artifacts/MultiSchnorrPortalAccount.js";
import { setupPXE } from "../src/utils/setup_pxe.js";
import { getSponsoredFPCInstance } from "../src/utils/sponsored_fpc.js";

const toBig = (hex: string) => BigInt(hex);
const toFr = (hex: string) => Fr.fromString(toBig(hex).toString());
const toScalar = (hex: string) => GrumpkinScalar.fromString(toBig(hex).toString());
const parseEth = (s: string) => EthAddress.fromString("0x" + s.replace(/^0x/i, "").toLowerCase());

function loadEnv(): Record<string, string> {
  const files = [".env"].map(p => path.resolve(process.cwd(), p));
  const env: Record<string, string> = {};
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    for (const l of lines) {
      if (!l || l.trim().startsWith("#")) continue;
      const i = l.indexOf("=");
      if (i > 0) env[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
  }
  return env;
}

async function main() {
  const cfg = loadEnv();

  const multisigAddrStr = cfg.MULTISIG_ADDRESS || cfg.DEPLOYED_ADDRESS;
  if (!multisigAddrStr) throw new Error("Missing MULTISIG_ADDRESS/DEPLOYED_ADDRESS");

  const secretKey = toFr(cfg.SECRET_KEY!);
  const salt = toFr(cfg.SALT!);
  const priv1 = toScalar(cfg.PRIV1!);

  const targetChain = Number(cfg.TARGET_CHAIN || cfg.ARBITRUM_CHAIN_ID || "421614");
  const targetContract = parseEth(cfg.TARGET_CONTRACT || cfg.ARBITRUM_INTENT_VAULT || cfg.PORTAL || "0x0000000000000000000000000000000000000000");
  const amount = cfg.AMOUNT ? BigInt(cfg.AMOUNT) : 0n;
  const intentType = Number(cfg.INTENT_TYPE || "1");
  const recipient = cfg.RECIPIENT ? toFr(cfg.RECIPIENT) : Fr.random();

  const pxe = await setupPXE();
  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({ instance: sponsoredFPC, artifact: SponsoredFPCContract.artifact });
  const fee = { paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address) };

  const acct = await getSchnorrAccount(pxe, secretKey, priv1, salt);
  const wallet = await acct.getWallet();
  const from: AztecAddress = wallet.getAddress();

  const multisig = await MultiSchnorrPortalAccountContract.at(AztecAddress.fromString(multisigAddrStr), wallet);

  const thresh = await multisig.methods.get_threshold().simulate({ from });
  const beforeNonce = await multisig.methods.get_cross_chain_nonce().simulate({ from });

  const proposedHash = await multisig.methods.propose_cross_chain_tx(
    targetChain,
    targetContract,
    amount,
    recipient,
    intentType,
    1
  ).simulate({ from });

  const sendProp = multisig.methods.propose_cross_chain_tx(
    targetChain,
    targetContract,
    amount,
    recipient,
    intentType,
    1
  ).send({ from, fee });
  await sendProp.wait({ timeout: 180000 });

  const afterNonce = await multisig.methods.get_cross_chain_nonce().simulate({ from });

  if (Number(thresh) > 1) {
    const a2 = multisig.methods.approve_cross_chain_tx(proposedHash, 2).send({ from, fee });
    await a2.wait({ timeout: 180000 });
  }
  if (Number(thresh) > 2) {
    const a3 = multisig.methods.approve_cross_chain_tx(proposedHash, 3).send({ from, fee });
    await a3.wait({ timeout: 180000 });
  }

  const exec = multisig.methods.execute_cross_chain_tx(
    Number(afterNonce),
    targetChain,
    targetContract,
    amount,
    recipient,
    intentType
  ).send({ from, fee });
  const execRcpt = await exec.wait({ timeout: 180000 });

  const approvalCount = await multisig.methods.get_cross_chain_approval_count(proposedHash).simulate({ from });
  const executed = await multisig.methods.is_cross_chain_executed(proposedHash).simulate({ from });

  console.log(JSON.stringify({
    proposedHash: proposedHash.toString(),
    nonceUsed: Number(afterNonce),
    approvalCount: Number(approvalCount),
    executed: Boolean(executed),
    executeTxHash: execRcpt.txHash,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error(e); process.exit(1); });
}
