import WebSocket from "ws";
import wrtc from "@koush/wrtc";
import chalk from "chalk";
import { SharedStateAccountData } from "./webrtc-signaling";

const { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate } =
  (wrtc as any) ?? {};

export interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate" | "ready" | "join" | "leave";
  from: string;
  to?: string;
  data?: any;
  room?: string;
}

/**
 * WebRTC Client for peer-to-peer communication
 */
export class WebRTCClient {
  private ws: WebSocket;
  private signerName: string;
  private room: string;
  private peers: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private iceServers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  constructor(signalingServerUrl: string, signerName: string, room: string) {
    this.signerName = signerName;
    this.room = room;
    this.ws = new WebSocket(signalingServerUrl);

    this.setupWebSocket();
  }

  private setupWebSocket() {
    this.ws.on("open", () => {
      console.log(chalk.green(`✓ Connected to signaling server`));
      // Join the room
      this.send({
        type: "join",
        from: this.signerName,
        room: this.room,
      });
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const message: SignalingMessage = JSON.parse(data.toString());
        this.handleSignalingMessage(message);
      } catch (error) {
        console.error(chalk.red("Error parsing signaling message:"), error);
      }
    });

    this.ws.on("error", (error) => {
      console.error(chalk.red("WebSocket error:"), error);
    });

    this.ws.on("close", () => {
      console.log(chalk.yellow("Disconnected from signaling server"));
    });
  }

  private send(message: SignalingMessage) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  private async handleSignalingMessage(message: SignalingMessage) {
    switch (message.type) {
      case "ready":
        // Another peer is ready, initiate connection if we're the creator
        if (message.from !== this.signerName) {
          // We'll handle this in the exchange function
        }
        break;

      case "offer":
        if (message.from && message.data) {
          await this.handleOffer(message.from, message.data);
        }
        break;

      case "answer":
        if (message.from && message.data) {
          await this.handleAnswer(message.from, message.data);
        }
        break;

      case "ice-candidate":
        if (message.from && message.data) {
          await this.handleIceCandidate(message.from, message.data);
        }
        break;
    }
  }

  /**
   * Create a peer connection as the offerer
   */
  async createOffer(targetSigner: string): Promise<void> {
    const peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    const dataChannel = peerConnection.createDataChannel("shared-state", {
      ordered: true,
    });

    this.setupDataChannel(targetSigner, dataChannel);
    this.setupPeerConnection(targetSigner, peerConnection);

    // Create offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    const localDescription = peerConnection.localDescription;
    if (!localDescription) {
      throw new Error("Failed to obtain local description for offer");
    }

    // Send offer
    this.send({
      type: "offer",
      from: this.signerName,
      to: targetSigner,
      data: {
        type: localDescription.type,
        sdp: localDescription.sdp,
      },
    });

    console.log(chalk.cyan(`  → Sent offer to ${targetSigner}`));
  }

  /**
   * Handle incoming offer
   */
  private async handleOffer(from: string, offerData: any): Promise<void> {
    const peerConnection = new RTCPeerConnection({
      iceServers: this.iceServers,
    });

    // Set up data channel receiver
    peerConnection.ondatachannel = (event: any) => {
      const dataChannel = event.channel;
      this.setupDataChannel(from, dataChannel);
    };

    this.setupPeerConnection(from, peerConnection);

    // Set remote description
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(offerData)
    );

    // Create answer
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const localDescription = peerConnection.localDescription;
    if (!localDescription) {
      throw new Error("Failed to obtain local description for answer");
    }

    // Send answer
    this.send({
      type: "answer",
      from: this.signerName,
      to: from,
      data: {
        type: localDescription.type,
        sdp: localDescription.sdp,
      },
    });

    console.log(chalk.cyan(`  → Sent answer to ${from}`));
  }

  /**
   * Handle incoming answer
   */
  private async handleAnswer(from: string, answerData: any): Promise<void> {
    const peerConnection = this.peers.get(from);
    if (!peerConnection) {
      console.error(chalk.red(`No peer connection found for ${from}`));
      return;
    }

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(answerData)
    );
    console.log(chalk.green(`  ✓ Answer received from ${from}`));
  }

  /**
   * Handle ICE candidate
   */
  private async handleIceCandidate(
    from: string,
    candidateData: any
  ): Promise<void> {
    const peerConnection = this.peers.get(from);
    if (!peerConnection) {
      console.error(chalk.red(`No peer connection found for ${from}`));
      return;
    }

    try {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (error) {
      console.error(chalk.red(`Error adding ICE candidate:`), error);
    }
  }

  /**
   * Setup peer connection event handlers
   */
  private setupPeerConnection(
    targetSigner: string,
    peerConnection: RTCPeerConnection
  ) {
    peerConnection.onicecandidate = (event: any) => {
      if (event.candidate) {
        const candidateData = event.candidate.toJSON
          ? event.candidate.toJSON()
          : {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid ?? undefined,
              sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
            };
        this.send({
          type: "ice-candidate",
          from: this.signerName,
          to: targetSigner,
          data: candidateData,
        });
      }
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      console.log(
        chalk.cyan(`  → Connection state with ${targetSigner}: ${state}`)
      );
      if (state === "failed" || state === "disconnected") {
        console.warn(
          chalk.yellow(`  ⚠ Connection ${state} with ${targetSigner}`)
        );
      }
    };

    this.peers.set(targetSigner, peerConnection);
  }

  /**
   * Setup data channel event handlers
   */
  private setupDataChannel(targetSigner: string, dataChannel: RTCDataChannel) {
    dataChannel.onopen = () => {
      console.log(chalk.green(`  ✓ Data channel opened with ${targetSigner}`));
    };

    dataChannel.onerror = (error) => {
      console.error(
        chalk.red(`Data channel error with ${targetSigner}:`),
        error
      );
    };

    dataChannel.onclose = () => {
      console.log(chalk.yellow(`  ← Data channel closed with ${targetSigner}`));
    };

    this.dataChannels.set(targetSigner, dataChannel);
  }

  /**
   * Send shared state account data
   */
  sendSharedState(
    targetSigner: string,
    sharedStateData: SharedStateAccountData
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const dataChannel = this.dataChannels.get(targetSigner);
      if (!dataChannel) {
        reject(new Error(`No data channel with ${targetSigner}`));
        return;
      }

      // Wait for channel to open (max 30 seconds)
      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Timeout waiting for data channel to open with ${targetSigner}`
          )
        );
      }, 30000);

      const checkAndSend = () => {
        if (dataChannel.readyState === "open") {
          clearTimeout(timeout);
          try {
            dataChannel.send(JSON.stringify(sharedStateData));
            console.log(
              chalk.green(`  ✓ Shared state sent to ${targetSigner}`)
            );
            resolve();
          } catch (error) {
            clearTimeout(timeout);
            reject(error);
          }
        } else if (dataChannel.readyState === "closed") {
          clearTimeout(timeout);
          reject(new Error(`Data channel with ${targetSigner} is closed`));
        } else {
          // Wait a bit and check again
          setTimeout(checkAndSend, 100);
        }
      };

      // If already open, send immediately
      if (dataChannel.readyState === "open") {
        checkAndSend();
      } else {
        // Wait for open event
        const openHandler = () => {
          clearTimeout(timeout);
          dataChannel.removeEventListener("open", openHandler);
          checkAndSend();
        };
        dataChannel.addEventListener("open", openHandler);
        // Also check periodically in case event was missed
        const interval = setInterval(() => {
          if (dataChannel.readyState === "open") {
            clearInterval(interval);
            clearTimeout(timeout);
            dataChannel.removeEventListener("open", openHandler);
            checkAndSend();
          } else if (dataChannel.readyState === "closed") {
            clearInterval(interval);
            clearTimeout(timeout);
            dataChannel.removeEventListener("open", openHandler);
            reject(new Error(`Data channel with ${targetSigner} is closed`));
          }
        }, 100);
      }
    });
  }

  /**
   * Receive shared state account data
   */
  receiveSharedState(targetSigner: string): Promise<SharedStateAccountData> {
    return new Promise((resolve, reject) => {
      const dataChannel = this.dataChannels.get(targetSigner);
      if (!dataChannel) {
        reject(new Error(`No data channel with ${targetSigner}`));
        return;
      }

      const timeout = setTimeout(() => {
        reject(
          new Error(`Timeout waiting for shared state from ${targetSigner}`)
        );
      }, 30000);

      const messageHandler = (event: { data: any }) => {
        try {
          const data = JSON.parse(event.data as string);
          clearTimeout(timeout);
          dataChannel.removeEventListener("message", messageHandler);
          resolve(data);
        } catch (error) {
          clearTimeout(timeout);
          dataChannel.removeEventListener("message", messageHandler);
          reject(error);
        }
      };

      dataChannel.addEventListener("message", messageHandler);
    });
  }

  /**
   * Wait for data channel to be ready
   */
  async waitForDataChannel(
    targetSigner: string,
    timeout: number = 30000
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const dataChannel = this.dataChannels.get(targetSigner);
      if (!dataChannel) {
        reject(new Error(`No data channel with ${targetSigner}`));
        return;
      }

      if (dataChannel.readyState === "open") {
        resolve();
        return;
      }

      const timeoutId = setTimeout(() => {
        reject(
          new Error(`Timeout waiting for data channel with ${targetSigner}`)
        );
      }, timeout);

      dataChannel.onopen = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      dataChannel.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error(`Data channel error with ${targetSigner}`));
      };
    });
  }

  /**
   * Close all connections
   */
  close() {
    this.peers.forEach((peer) => peer.close());
    this.dataChannels.forEach((channel) => channel.close());
    this.peers.clear();
    this.dataChannels.clear();

    if (this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: "leave",
        from: this.signerName,
        room: this.room,
      });
      this.ws.close();
    }
  }
}
