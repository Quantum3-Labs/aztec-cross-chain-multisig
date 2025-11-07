import { Fr, GrumpkinScalar, Point } from "@aztec/aztec.js/fields";
import { setupPXE } from "./setup_pxe";
import { listMultisigs, listSigners, Signer } from "./src/signer-manager";
import { Grumpkin, Schnorr } from "@aztec/foundation/crypto";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { TestWallet } from "@aztec/test-wallet/server";
import { AccountManager } from "@aztec/aztec.js/wallet";
import { SALT, SECRET_KEY } from "./constants";

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
  const { wallet } = await setupPXE();

  const secretKey = toFr(process.env.SECRET_KEY!);
  const salt = toFr(process.env.SALT!);
  const accountMgr = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    privateKey
  );
  return accountMgr;
}

export const toAddress = (hex: string) => AztecAddress.fromString(hex);

/**
 * Gets or creates a signer account and ensures it's registered with the wallet.
 * This is needed because each CLI command creates a new wallet instance,
 * and accounts need to be re-registered in the wallet's internal map.
 */
export async function getOrCreateSignerAccount(
  wallet: TestWallet,
  signer: Signer
): Promise<AccountManager> {
  const secretKey = toFr(SECRET_KEY);
  const salt = toFr(SALT);
  const accountMgr = await wallet.createSchnorrAccount(
    secretKey,
    salt,
    toScalar(signer.privateKey)
  );

  // Register the sender to ensure the wallet knows about this account
  await wallet.registerSender(accountMgr.address);

  return accountMgr;
}

export async function registerSignersInWallet(
  wallet: TestWallet,
  signerNames: string[]
) {
  const allSigners = await listSigners();
  const uniqueNames = Array.from(new Set(signerNames));

  for (const name of uniqueNames) {
    const signer = allSigners.find((s) => s.name === name);
    if (!signer) {
      console.warn(
        `⚠ Signer ${name} not found in signers.json, skipping PXE registration.`
      );
      continue;
    }
    try {
      await getOrCreateSignerAccount(wallet, signer);
    } catch (error) {
      console.warn(
        `⚠ Failed to register signer ${name} in PXE: ${error}. Continuing with remaining signers.`
      );
    }
  }
}

export async function registerSharedStateAccountInWallet(
  wallet: TestWallet,
  sharedState: {
    address: string;
    secretKey: any;
    saltKey: any;
    privateKey: string;
  }
) {
  try {
    const secretKeyStr =
      typeof sharedState.secretKey === "string"
        ? sharedState.secretKey
        : sharedState.secretKey.toString();
    const saltKeyStr =
      typeof sharedState.saltKey === "string"
        ? sharedState.saltKey
        : sharedState.saltKey.toString();

    const secretKeyFr = Fr.fromString(secretKeyStr);
    const saltKeyFr = Fr.fromString(saltKeyStr);
    const privateScalar = toScalar(sharedState.privateKey);

    const accountMgr = await wallet.createSchnorrAccount(
      secretKeyFr,
      saltKeyFr,
      privateScalar
    );

    try {
      await wallet.registerSender(accountMgr.address);
    } catch (error) {
      // Ignore if already registered
    }

    return accountMgr;
  } catch (error) {
    throw new Error(
      `Failed to register shared state account ${sharedState.address}: ${error}`
    );
  }
}

export async function getSharedStateAccount(
  multisigAddress: string,
  wallet?: TestWallet
) {
  // read from multisigs.json
  const multisigs = await listMultisigs();
  const multisig = multisigs.find((m) => m.address === multisigAddress);
  if (!multisig) {
    throw new Error(`Multisig ${multisigAddress} not found`);
  }

  // Use provided wallet or create a new one
  let walletToUse: TestWallet;
  if (!wallet) {
    const setup = await setupPXE();
    walletToUse = setup.wallet;
  } else {
    walletToUse = wallet;
  }

  const secretKey = toFr(multisig.sharedStateAccountSecretKey);
  const salt = toFr(multisig.sharedStateAccountSaltKey);
  const accountMgr = await walletToUse.createSchnorrAccount(
    secretKey,
    salt,
    toScalar(multisig.sharedStateAccountPrivateKey)
  );

  // Register the sender to ensure the wallet knows about this account
  await walletToUse.registerSender(accountMgr.address);

  return accountMgr;
}
