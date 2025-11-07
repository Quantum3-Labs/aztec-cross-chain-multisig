import "dotenv/config";
import fs from "fs";
import path from "path";
import { poseidon2Hash } from "@aztec/foundation/crypto";
import {
  Signer,
  Multisig,
  getCurrentSigner,
  getCurrentMultisig,
} from "./signer-manager";
import { signMessage, toScalar, toFr } from "../utils";
import { Fr } from "@aztec/foundation/fields";

const PENDING_PROPOSALS_FILE = path.resolve(
  process.cwd(),
  "pending-proposals.json"
);
const PENDING_SIGNATURES_FILE = path.resolve(
  process.cwd(),
  "pending-signatures.json"
);

export type ProposalType =
  | "add_signer"
  | "remove_signer"
  | "change_threshold"
  | "cross_chain_intent";

export interface Proposal {
  id: string;
  type: ProposalType;
  messageHash: string;
  multisigName: string;
  multisigAddress: string;
  threshold: number;
  currentSignerCount: number;
  proposer: string;
  createdAt: string;
  status: "pending" | "executed" | "cancelled";
  // Type-specific data
  data:
    | AddSignerData
    | RemoveSignerData
    | ChangeThresholdData
    | CrossChainIntentData;
}

export interface AddSignerData {
  newSignerName: string;
  newSignerAddress: string;
  newSignerPublicKeyX: string;
  newSignerPublicKeyY: string;
  deadline: string;
}

export interface RemoveSignerData {
  targetSignerName: string;
  targetSignerAddress: string;
  deadline: string;
}

export interface ChangeThresholdData {
  newThreshold: number;
  deadline: string;
}

export interface CrossChainIntentData {
  targetChain: string;
  targetContract: string;
  intentType: string;
  amount: string;
  recipient: string;
  deadline: string;
}

export interface Signature {
  proposalId: string;
  messageHash: string;
  signerName: string;
  signerAddress: string;
  signature: string;
  publicKeyX: string;
  publicKeyY: string;
  createdAt: string;
}

function readPendingProposals(): Proposal[] {
  if (!fs.existsSync(PENDING_PROPOSALS_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(PENDING_PROPOSALS_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      "Warning: Could not read pending proposals file, starting with empty list"
    );
    return [];
  }
}

function writePendingProposals(proposals: Proposal[]): void {
  fs.writeFileSync(PENDING_PROPOSALS_FILE, JSON.stringify(proposals, null, 2));
}

function readPendingSignatures(): Signature[] {
  if (!fs.existsSync(PENDING_SIGNATURES_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(PENDING_SIGNATURES_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    console.warn(
      "Warning: Could not read pending signatures file, starting with empty list"
    );
    return [];
  }
}

function writePendingSignatures(signatures: Signature[]): void {
  fs.writeFileSync(
    PENDING_SIGNATURES_FILE,
    JSON.stringify(signatures, null, 2)
  );
}

// General proposal creation function
export async function createProposal(
  type: ProposalType,
  data:
    | AddSignerData
    | RemoveSignerData
    | ChangeThresholdData
    | CrossChainIntentData
): Promise<Proposal> {
  const currentMultisig = await getCurrentMultisig();
  const currentSigner = await getCurrentSigner();

  if (!currentMultisig || !currentSigner) {
    throw new Error("No current multisig or signer set");
  }

  // Create message hash based on proposal type
  let messageHash: Fr;

  switch (type) {
    case "add_signer":
      const addData = data as AddSignerData;
      // Contract: poseidon2_hash([new_signer.to_field(), new_signer_pk_x, new_signer_pk_y, deadline as Field])
      messageHash = await poseidon2Hash([
        Fr.fromString(addData.newSignerAddress),
        Fr.fromString(addData.newSignerPublicKeyX),
        Fr.fromString(addData.newSignerPublicKeyY),
        Fr.fromString(addData.deadline),
      ]);
      break;

    case "remove_signer":
      const removeData = data as RemoveSignerData;
      // Contract: poseidon2_hash([target_signer.to_field(), deadline as Field])
      messageHash = await poseidon2Hash([
        Fr.fromString(removeData.targetSignerAddress),
        Fr.fromString(removeData.deadline),
      ]);
      break;

    case "change_threshold":
      const thresholdData = data as ChangeThresholdData;
      // Contract: poseidon2_hash([new_threshold as Field, deadline as Field])
      messageHash = await poseidon2Hash([
        Fr.fromString(thresholdData.newThreshold.toString()),
        Fr.fromString(thresholdData.deadline),
      ]);
      break;

    case "cross_chain_intent":
      const crossChainData = data as CrossChainIntentData;
      // Contract: poseidon2_hash([target_chain, target_contract.to_field(), intent_type, amount, recipient.to_field(), deadline as Field])
      // Note: target_contract and recipient need to be converted from Ethereum address to Aztec address, then to Field
      const { ethToAztecAddress } = await import("../utils");
      const targetContractAddr = ethToAztecAddress(
        crossChainData.targetContract
      );
      const recipientAddr = ethToAztecAddress(crossChainData.recipient);
      messageHash = await poseidon2Hash([
        Fr.fromString(crossChainData.targetChain),
        Fr.fromString(targetContractAddr.toString()),
        Fr.fromString(crossChainData.intentType),
        Fr.fromString(crossChainData.amount),
        Fr.fromString(recipientAddr.toString()),
        Fr.fromString(crossChainData.deadline),
      ]);
      break;

    default:
      throw new Error(`Unsupported proposal type: ${type}`);
  }

  const proposal: Proposal = {
    id: `${type}-${Date.now()}`,
    type,
    messageHash: messageHash.toString(),
    multisigName: currentMultisig.name,
    multisigAddress: currentMultisig.address,
    threshold: currentMultisig.threshold,
    currentSignerCount: currentMultisig.signers.length,
    proposer: currentSigner.name,
    createdAt: new Date().toISOString(),
    status: "pending",
    data,
  };

  const proposals = readPendingProposals();
  proposals.push(proposal);
  writePendingProposals(proposals);

  return proposal;
}

// General signing function
export async function signProposal(
  messageHash: string,
  signerName?: string
): Promise<Signature> {
  const currentSigner = await getCurrentSigner();
  const signer: any = signerName
    ? (await import("./signer-manager"))
        .listSigners()
        .then((signers) => signers.find((s) => s.name === signerName))
    : currentSigner;

  if (!signer) {
    throw new Error(`Signer ${signerName || "current"} not found`);
  }

  // Check if already signed
  const existingSignatures = readPendingSignatures();
  const alreadySigned = existingSignatures.find(
    (sig) => sig.messageHash === messageHash && sig.signerName === signer.name
  );

  if (alreadySigned) {
    throw new Error(`Signer ${signer.name} has already signed this proposal`);
  }

  // Sign the message
  const signature = await signMessage(
    Fr.fromString(messageHash),
    toScalar(signer.privateKey)
  );

  const proposalSignature: Signature = {
    proposalId: `proposal-${messageHash.slice(0, 8)}`,
    messageHash,
    signerName: signer.name,
    signerAddress: signer.address,
    signature: JSON.stringify(signature), // Store as JSON string since it's a number array
    publicKeyX: signer.publicKeyX,
    publicKeyY: signer.publicKeyY,
    createdAt: new Date().toISOString(),
  };

  existingSignatures.push(proposalSignature);
  writePendingSignatures(existingSignatures);

  return proposalSignature;
}

export function getProposalSignatures(messageHash: string): Signature[] {
  const signatures = readPendingSignatures();
  return signatures.filter((sig) => sig.messageHash === messageHash);
}

export function getProposalStatus(messageHash: string): {
  proposal: Proposal | null;
  signatures: Signature[];
  progress: string;
} {
  const proposals = readPendingProposals();
  const proposal = proposals.find((p) => p.messageHash === messageHash) || null;
  const signatures = getProposalSignatures(messageHash);

  if (!proposal) {
    return { proposal: null, signatures: [], progress: "Proposal not found" };
  }

  const progress = `${signatures.length}/${proposal.threshold} signatures collected`;
  return { proposal, signatures, progress };
}

export function listPendingProposals(): Proposal[] {
  return readPendingProposals().filter((p) => p.status === "pending");
}

export function markProposalExecuted(messageHash: string): void {
  const proposals = readPendingProposals();
  const proposal = proposals.find((p) => p.messageHash === messageHash);
  if (proposal) {
    proposal.status = "executed";
    writePendingProposals(proposals);
  }
}

export function cleanupExecutedProposal(messageHash: string): void {
  // Remove signatures for executed proposal
  const signatures = readPendingSignatures();
  const filteredSignatures = signatures.filter(
    (sig) => sig.messageHash !== messageHash
  );
  writePendingSignatures(filteredSignatures);

  // Mark proposal as executed
  markProposalExecuted(messageHash);
}

// Convenience functions for specific proposal types
export async function proposeAddSigner(
  newSignerName: string,
  newSignerAddress: string,
  newSignerPublicKeyX: string,
  newSignerPublicKeyY: string,
  deadline: string
): Promise<Proposal> {
  return createProposal("add_signer", {
    newSignerName,
    newSignerAddress,
    newSignerPublicKeyX,
    newSignerPublicKeyY,
    deadline,
  });
}

export async function proposeRemoveSigner(
  targetSignerName: string,
  targetSignerAddress: string,
  deadline: string
): Promise<Proposal> {
  return createProposal("remove_signer", {
    targetSignerName,
    targetSignerAddress,
    deadline,
  });
}

export async function proposeChangeThreshold(
  newThreshold: number,
  deadline: string
): Promise<Proposal> {
  return createProposal("change_threshold", {
    newThreshold,
    deadline,
  });
}

export async function proposeCrossChainIntent(
  targetChain: string,
  targetContract: string,
  intentType: string,
  amount: string,
  recipient: string,
  deadline: string
): Promise<Proposal> {
  return createProposal("cross_chain_intent", {
    targetChain,
    targetContract,
    intentType,
    amount,
    recipient,
    deadline,
  });
}
