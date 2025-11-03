import "dotenv/config";
import fs from "fs";
import path from "path";
import { GrumpkinScalar } from "@aztec/foundation/fields";
import { Grumpkin } from "@aztec/foundation/crypto";
import { SALT, SECRET_KEY } from "../constants";
import { toFr, toHex0x } from "../utils";
import { setupPXE } from "../setup_pxe";
import { setupSponsoredFPC } from "../sponsored_fpc";
import { AztecAddress } from "@aztec/stdlib/aztec-address";

const SIGNERS_FILE = path.resolve(process.cwd(), "signers.json");
const MULTISIGS_FILE = path.resolve(process.cwd(), "multisigs.json");
const GLOBAL_STATE_FILE = path.resolve(process.cwd(), "global-state.json");

export interface Signer {
  name: string;
  address: string;
  privateKey: string;
  publicKeyX: string;
  publicKeyY: string;
  createdAt: string;
}

export interface Deployer {
  privateKey: string;
  publicKeyX: string;
  publicKeyY: string;
  secret: string;
  salt: string;
}

export interface Multisig {
  name: string;
  address: string;
  threshold: number;
  signers: string[];
  createdAt: string;
  sharedStateAccountAddress: string;
  sharedStateAccountSecretKey: string;
  sharedStateAccountSaltKey: string;
  sharedStateAccountPublicKeyX: string;
  sharedStateAccountPublicKeyY: string;
  sharedStateAccountPrivateKey: string;
  arbitrumProxy?: string;
}

export interface GlobalState {
  currentSigner?: string;
  currentMultisig?: string;
}

function readSigners(): Signer[] {
  if (!fs.existsSync(SIGNERS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(SIGNERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      "Warning: Could not read signers file, starting with empty list"
    );
    return [];
  }
}

function writeSigners(signers: Signer[]): void {
  fs.writeFileSync(SIGNERS_FILE, JSON.stringify(signers, null, 2));
}

export async function createSigner(name: string): Promise<Signer> {
  const signers = readSigners();

  // Check if signer with this name already exists
  if (signers.some((s) => s.name === name)) {
    throw new Error(`Signer with name "${name}" already exists`);
  }
  const { wallet } = await setupPXE();

  const privateKey = GrumpkinScalar.random();
  const grumpkin = new Grumpkin();
  const generator = grumpkin.generator();
  const publicKey = await grumpkin.mul(generator, privateKey);

  const newAccount = await wallet.createSchnorrAccount(
    toFr(SECRET_KEY),
    toFr(SALT),
    privateKey
  );
  const fee = await setupSponsoredFPC();
  await (await newAccount.getDeployMethod())
    .send({ from: AztecAddress.ZERO, fee: fee })
    .wait();

  await wallet.registerSender(newAccount.address);

  const signer: Signer = {
    name,
    address: newAccount.address.toString(),
    privateKey: toHex0x(privateKey),
    publicKeyX: toHex0x(publicKey.x),
    publicKeyY: toHex0x(publicKey.y),
    createdAt: new Date().toISOString(),
  };

  signers.push(signer);
  writeSigners(signers);

  return signer;
}

export async function listSigners(): Promise<Signer[]> {
  return readSigners();
}

// Multisig management functions
function readMultisigs(): Multisig[] {
  if (!fs.existsSync(MULTISIGS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(MULTISIGS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      "Warning: Could not read multisigs file, starting with empty list"
    );
    return [];
  }
}

function writeMultisigs(multisigs: Multisig[]): void {
  fs.writeFileSync(MULTISIGS_FILE, JSON.stringify(multisigs, null, 2));
}

export async function saveMultisig(multisig: Multisig): Promise<void> {
  const multisigs = readMultisigs();
  const existingIndex = multisigs.findIndex(
    (m) => m.address === multisig.address
  );

  if (existingIndex >= 0) {
    // Update existing multisig
    multisigs[existingIndex] = multisig;
  } else {
    // Add new multisig
    multisigs.push(multisig);
  }

  writeMultisigs(multisigs);
}

export async function listMultisigs(): Promise<Multisig[]> {
  return readMultisigs();
}

export async function getMultisig(name: string): Promise<Multisig | null> {
  const multisigs = readMultisigs();
  return multisigs.find((m) => m.name === name) || null;
}

// Global state management functions
function readGlobalState(): GlobalState {
  if (!fs.existsSync(GLOBAL_STATE_FILE)) {
    return {};
  }
  try {
    const data = fs.readFileSync(GLOBAL_STATE_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      "Warning: Could not read global state file, starting with empty state"
    );
    return {};
  }
}

function writeGlobalState(state: GlobalState): void {
  fs.writeFileSync(GLOBAL_STATE_FILE, JSON.stringify(state, null, 2));
}

export async function setCurrentSigner(signerName: string): Promise<void> {
  const signers = readSigners();
  const signer = signers.find((s) => s.name === signerName);
  if (!signer) {
    throw new Error(`Signer "${signerName}" not found`);
  }

  const state = readGlobalState();
  state.currentSigner = signerName;
  writeGlobalState(state);
}

export async function setCurrentMultisig(multisigName: string): Promise<void> {
  const multisigs = readMultisigs();
  const multisig = multisigs.find((m) => m.name === multisigName);
  if (!multisig) {
    throw new Error(`Multisig "${multisigName}" not found`);
  }

  const state = readGlobalState();
  state.currentMultisig = multisigName;
  writeGlobalState(state);
}

export async function getCurrentSigner(): Promise<Signer | null> {
  const state = readGlobalState();
  if (!state.currentSigner) {
    return null;
  }

  const signers = readSigners();
  return signers.find((s) => s.name === state.currentSigner) || null;
}

export async function getCurrentMultisig(): Promise<Multisig | null> {
  const state = readGlobalState();
  if (!state.currentMultisig) {
    return null;
  }

  const multisigs = readMultisigs();
  return multisigs.find((m) => m.name === state.currentMultisig) || null;
}

export async function getGlobalState(): Promise<GlobalState> {
  return readGlobalState();
}
