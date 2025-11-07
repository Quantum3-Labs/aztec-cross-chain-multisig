import {
  Signer,
  Multisig,
  saveMultisig,
  getCurrentSigner,
} from "./signer-manager";
import { SALT, SECRET_KEY, WORMHOLE_ADDRESS } from "../constants";
import { derivePublicKey, pointToFr, toFr, toScalar } from "../utils";
import { deployArbitrumProxy } from "./arbitrum-deployer";
import { setupPXEForSigner } from "./pxe-manager";
import { setupSponsoredFPC } from "../sponsored_fpc";
import { MultisigAccountContract } from "../../aztec-contracts/src/artifacts/MultisigAccount";
import { createSigner } from "../../tests/utils/signer";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import chalk from "chalk";
import { exchangeSharedStateViaWebRTC } from "./webrtc-signaling";
import {
  getSharedStateAccount,
  getOrCreateSignerAccount,
  registerSignersInWallet,
  registerSharedStateAccountInWallet,
} from "../utils";

export async function createMultisig(
  signers: Signer[],
  threshold: number,
  multisigName?: string
) {
  // Get the current signer (creator)
  const creatorSigner = await getCurrentSigner();
  if (!creatorSigner) {
    throw new Error(
      "No current signer set. Please set a current signer first."
    );
  }

  // Verify creator is in the signers list
  if (!signers.find((s) => s.name === creatorSigner.name)) {
    throw new Error("Current signer must be one of the multisig signers");
  }

  console.log(
    chalk.cyan(`\n🔧 Creating multisig with ${signers.length} signers...`)
  );
  console.log(chalk.white(`   Creator: ${creatorSigner.name}`));

  // Use creator's signer-specific PXE
  const { wallet: creatorWallet } = await setupPXEForSigner(creatorSigner);
  console.log(chalk.green(`✓ Using PXE for signer: ${creatorSigner.name}`));

  const fee = await setupSponsoredFPC(creatorWallet);

  // Create shared state account using creator's PXE
  console.log(chalk.cyan("Creating shared state account..."));
  const sharedStateAccount = await createSigner(creatorWallet);

  const signerNames = signers.map((s) => s.name);

  // Ensure creator's PXE knows about all current signers
  await registerSignersInWallet(creatorWallet, signerNames);

  // Register shared state account in every signer's PXE
  console.log(
    chalk.cyan("Registering shared state account across signer PXEs...")
  );
  for (const signer of signers) {
    try {
      const { wallet: signerWallet } = await setupPXEForSigner(signer);

      await registerSignersInWallet(signerWallet, signerNames);

      await registerSharedStateAccountInWallet(
        signerWallet,
        sharedStateAccount
      );

      console.log(
        chalk.green(`✓ Shared state registered in ${signer.name}'s PXE`)
      );
    } catch (error) {
      console.warn(
        chalk.yellow(
          `⚠ Warning: Could not register shared state in ${signer.name}'s PXE: ${error}`
        )
      );
    }
  }

  // Deploy multisig contract
  console.log(chalk.cyan("Deploying multisig contract..."));
  const multisig = await MultisigAccountContract.deploy(
    creatorWallet,
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
    .send({
      from: sharedStateAccount.wallet.address,
      fee,
    })
    .deployed();

  console.log(
    chalk.green(
      `✓ Multisig contract deployed at: ${multisig.address.toString()}`
    )
  );

  // Register multisig contract in creator's PXE
  await creatorWallet.registerContract({
    instance: multisig.instance,
    artifact: multisig.artifact,
  });

  // Prepare shared state account data for exchange
  const sharedStateData = {
    address: sharedStateAccount.address,
    secretKey: sharedStateAccount.secretKey.toString(),
    saltKey: sharedStateAccount.saltKey.toString(),
    publicKeyX: sharedStateAccount.publicKeyX,
    publicKeyY: sharedStateAccount.publicKeyY,
    privateKey: sharedStateAccount.privateKey,
  };

  // Exchange shared state account with other signers via WebRTC
  const otherSigners = signers.filter((s) => s.name !== creatorSigner.name);
  if (otherSigners.length > 0) {
    console.log(
      chalk.cyan(
        `\n🔄 Exchanging shared state account with ${otherSigners.length} signer(s)...`
      )
    );
    await exchangeSharedStateViaWebRTC(
      creatorSigner,
      otherSigners,
      sharedStateData
    );
  }

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
  console.log(chalk.cyan("\nDeploying Arbitrum proxy..."));
  const arbitrumProxy = await deployArbitrumProxy(multisigInfo.name);

  // Update multisig info with Arbitrum proxy address
  multisigInfo.arbitrumProxy = arbitrumProxy.address;
  await saveMultisig(multisigInfo);

  // Register the multisig contract in each signer's PXE
  console.log(
    chalk.cyan("Registering multisig contract across signer PXEs...")
  );
  for (const signer of signers) {
    try {
      const { wallet: signerWallet } = await setupPXEForSigner(signer);

      await registerSignersInWallet(signerWallet, signerNames);

      await registerSharedStateAccountInWallet(
        signerWallet,
        sharedStateAccount
      );

      await signerWallet.registerContract({
        instance: multisig.instance,
        artifact: multisig.artifact,
      });

      console.log(chalk.green(`✓ Multisig registered in ${signer.name}'s PXE`));
    } catch (error) {
      console.warn(
        chalk.yellow(
          `⚠ Warning: Could not register multisig in ${signer.name}'s PXE: ${error}`
        )
      );
    }
  }

  console.log(chalk.green(`\n✅ Multisig created successfully!`));
  console.log(chalk.white(`   Name: ${multisigInfo.name}`));
  console.log(chalk.white(`   Address: ${multisigInfo.address}`));
  console.log(chalk.white(`   Threshold: ${threshold}/${signers.length}`));
  console.log(chalk.white(`   Arbitrum Proxy: ${arbitrumProxy.address}`));

  return multisigInfo;
}
