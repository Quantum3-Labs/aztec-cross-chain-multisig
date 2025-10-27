import {
  AztecAddress,
  Fr,
  Grumpkin,
  GrumpkinScalar,
  Point,
  Schnorr,
} from "@aztec/aztec.js";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { setupPXE } from "./setup_pxe";
import { listMultisigs } from "./src/signer-manager";

export const toFr = (hex: string) => Fr.fromString(BigInt(hex).toString());
export const toHex0x = (x: { toString(): string }) =>
  "0x" + BigInt(x.toString()).toString(16).padStart(64, "0");

export const toScalar = (hex: string) =>
  GrumpkinScalar.fromString(BigInt(hex).toString());

export async function derivePublicKey(
  privateKey: GrumpkinScalar
): Promise<Point> {
  const grumpkin = new Grumpkin();
  return grumpkin.mul(grumpkin.generator(), privateKey);
}

export function pointToFr(p: Point): { x: Fr; y: Fr } {
  return { x: Fr.fromString(p.x.toString()), y: Fr.fromString(p.y.toString()) };
}

export function ethToAztecAddress(ethAddress: string): AztecAddress {
  const clean = ethAddress.toLowerCase().replace("0x", "");
  const padded = "0x" + clean.padStart(64, "0");
  return AztecAddress.fromString(padded);
}

export async function signMessage(
  messageHash: Fr,
  privateKey: GrumpkinScalar
): Promise<number[]> {
  const schnorr = new Schnorr();
  const messageBytes = messageHash.toBuffer();
  const signature = await schnorr.constructSignature(messageBytes, privateKey);
  return Array.from(signature.toBuffer());
}

export async function getWallet(privateKey: GrumpkinScalar) {
  const { pxe } = await setupPXE();

  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const accountMgr = await getSchnorrAccount(pxe, secretKey, privateKey, salt);
  return accountMgr.getWallet();
}

export const toAddress = (hex: string) => AztecAddress.fromString(hex);

export async function getSharedStateAccount(multisigAddress: string) {
  // read from multisigs.json
  const multisigs = await listMultisigs();
  const multisig = multisigs.find((m) => m.address === multisigAddress);
  if (!multisig) {
    throw new Error(`Multisig ${multisigAddress} not found`);
  }
  // get schnorr account
  const { pxe } = await setupPXE();
  const secretKey = toFr(multisig.sharedStateAccountSecretKey);
  const salt = toFr(multisig.sharedStateAccountSaltKey);
  const account = await getSchnorrAccount(
    pxe,
    secretKey,
    toScalar(multisig.sharedStateAccountPrivateKey),
    salt
  );
  return account;
}
