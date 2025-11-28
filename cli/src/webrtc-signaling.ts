import chalk from "chalk";
import { Signer } from "./signer-manager";
import { WebRTCClient } from "./webrtc-client";
import { startSignalingServer, stopSignalingServer } from "./signaling-server";

export interface SharedStateAccountData {
  address: string;
  secretKey: string;
  saltKey: string;
  publicKeyX: string;
  publicKeyY: string;
  privateKey: string;
}

const SIGNALING_SERVER_PORT = 8081;
const SIGNALING_SERVER_URL = `ws://localhost:${SIGNALING_SERVER_PORT}`;

/**
 * Real WebRTC exchange using signaling server
 * Exchanges shared state account data between creator and recipient signers
 */
export async function exchangeSharedStateViaWebRTC(
  creatorSigner: Signer,
  recipientSigners: Signer[],
  sharedStateData: SharedStateAccountData
): Promise<void> {
  console.log(
    chalk.cyan("\n🔄 Starting WebRTC exchange for shared state account...")
  );

  if (recipientSigners.length === 0) {
    console.log(chalk.yellow("  No recipients, skipping exchange"));
    return;
  }

  // Start signaling server if not already running
  const signalingServer = startSignalingServer(SIGNALING_SERVER_PORT);

  // Create a unique room ID for this multisig creation session
  const roomId = `multisig-${Date.now()}`;
  console.log(chalk.cyan(`  Room ID: ${roomId}`));

  // Create WebRTC client for creator
  const creatorClient = new WebRTCClient(
    SIGNALING_SERVER_URL,
    creatorSigner.name,
    roomId
  );

  // Wait a bit for connection to establish
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Create WebRTC clients for recipients
  const recipientClients: Map<string, WebRTCClient> = new Map();
  for (const recipient of recipientSigners) {
    const client = new WebRTCClient(
      SIGNALING_SERVER_URL,
      recipient.name,
      roomId
    );
    recipientClients.set(recipient.name, client);
  }

  // Wait for all clients to connect
  console.log(chalk.cyan("  Waiting for all signers to connect..."));
  await new Promise((resolve) => setTimeout(resolve, 2000));

  try {
    // Creator initiates connections with all recipients
    console.log(
      chalk.cyan(
        `  Creating peer connections with ${recipientSigners.length} recipient(s)...`
      )
    );

    for (const recipient of recipientSigners) {
      console.log(
        chalk.cyan(`  → Initiating connection with ${recipient.name}...`)
      );
      await creatorClient.createOffer(recipient.name);
    }

    // Wait for all data channels to be ready
    console.log(chalk.cyan("  Waiting for data channels to establish..."));
    for (const recipient of recipientSigners) {
      await creatorClient.waitForDataChannel(recipient.name, 30000);
    }

    // Send shared state account data to all recipients
    console.log(chalk.cyan("  Sending shared state account data..."));
    const sendPromises = recipientSigners.map((recipient) =>
      creatorClient
        .sendSharedState(recipient.name, sharedStateData)
        .catch((error) => {
          console.error(
            chalk.red(`  ✗ Failed to send to ${recipient.name}:`),
            error
          );
          throw error;
        })
    );

    await Promise.all(sendPromises);

    console.log(
      chalk.green(
        `\n✓ Successfully exchanged shared state account with ${recipientSigners.length} signer(s) via WebRTC`
      )
    );
  } catch (error) {
    console.error(chalk.red("\n✗ WebRTC exchange failed:"), error);
    throw error;
  } finally {
    // Clean up
    creatorClient.close();
    recipientClients.forEach((client) => client.close());
    stopSignalingServer();
  }
}
