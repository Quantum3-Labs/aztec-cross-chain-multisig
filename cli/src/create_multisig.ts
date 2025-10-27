import { AztecAddress, waitForPXE } from "@aztec/aztec.js";
import { Signer, Multisig, saveMultisig } from "./signer-manager";
import { SALT, SECRET_KEY, WORMHOLE_ADDRESS } from "../constants";
import { getSchnorrAccount } from "@aztec/accounts/schnorr";
import { derivePublicKey, pointToFr, toFr, toScalar } from "../utils";
import { deployArbitrumProxy } from "./arbitrum-deployer";
import { setupPXE } from "../setup_pxe";
import { setupSponsoredFPC } from "../sponsored_fpc";
import { MultisigAccountContract } from "../../aztec-contracts/src/artifacts/MultisigAccount";
import { createSigner } from "../../tests/utils/signer";

export async function createMultisig(
  signers: Signer[],
  threshold: number,
  multisigName?: string
) {
  const { pxe } = await setupPXE();
  await waitForPXE(pxe);

  const fee = await setupSponsoredFPC();

  const sharedStateAccount = await createSigner(pxe);

  // Deploy multisig contract
  const multisig = await MultisigAccountContract.deploy(
    sharedStateAccount.wallet,
    [
      ...signers.map((s) => AztecAddress.fromString(s.address)),
      // fill the rest of the signers with zeros
      ...Array(8 - signers.length).fill(AztecAddress.ZERO),
    ],
    threshold,
    [
      ...signers.map((s) => toFr(s.publicKeyX)),
      ...Array(8 - signers.length).fill(0),
    ],
    [
      ...signers.map((s) => toFr(s.publicKeyY)),
      ...Array(8 - signers.length).fill(0),
    ]
  )
    .send({ from: sharedStateAccount.wallet.getAddress(), fee })
    .deployed();

  // Save multisig information
  const multisigInfo: Multisig = {
    name: multisigName || `Multisig-${Date.now()}`,
    address: multisig.address.toString(),
    threshold,
    signers: signers.map((s) => s.name),
    createdAt: new Date().toISOString(),
    sharedStateAccountAddress: sharedStateAccount.address,
    sharedStateAccountSecretKey: sharedStateAccount.secretKey.toString(),
    sharedStateAccountSaltKey: sharedStateAccount.saltKey.toString(),
    sharedStateAccountPublicKeyX: sharedStateAccount.publicKeyX,
    sharedStateAccountPublicKeyY: sharedStateAccount.publicKeyY,
    sharedStateAccountPrivateKey: sharedStateAccount.privateKey,
  };

  // Deploy corresponding Arbitrum proxy
  console.log("Deploying Arbitrum proxy...");
  const arbitrumProxy = await deployArbitrumProxy(multisigInfo.name);

  // Update multisig info with Arbitrum proxy address
  multisigInfo.arbitrumProxy = arbitrumProxy.address;
  await saveMultisig(multisigInfo);

  return multisigInfo;
}
