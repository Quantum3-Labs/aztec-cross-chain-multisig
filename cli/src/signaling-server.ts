import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "events";
import chalk from "chalk";

export interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate" | "ready" | "join" | "leave";
  from: string;
  to?: string;
  data?: any;
  room?: string;
}

/**
 * WebRTC Signaling Server
 * Handles WebSocket connections for WebRTC signaling
 */
export class SignalingServer extends EventEmitter {
  private server: WebSocketServer;
  private clients: Map<string, WebSocket> = new Map();
  private rooms: Map<string, Set<string>> = new Map(); // room -> set of signer names

  constructor(port: number = 8081) {
    super();
    this.server = new WebSocketServer({ port });
    this.setupServer();
    console.log(chalk.green(`✓ Signaling server started on port ${port}`));
  }

  private setupServer() {
    this.server.on("connection", (ws: WebSocket) => {
      let signerName: string | null = null;

      ws.on("message", (message: string) => {
        try {
          const msg: SignalingMessage = JSON.parse(message.toString());

          switch (msg.type) {
            case "join":
              signerName = msg.from;
              this.clients.set(signerName, ws);
              this.joinRoom(msg.room!, signerName);
              console.log(
                chalk.cyan(`  → ${signerName} joined room ${msg.room}`)
              );
              this.broadcastToRoom(
                msg.room!,
                {
                  type: "ready",
                  from: signerName,
                  room: msg.room,
                },
                signerName
              );
              break;

            case "offer":
            case "answer":
            case "ice-candidate":
              if (msg.to && this.clients.has(msg.to)) {
                const targetClient = this.clients.get(msg.to)!;
                targetClient.send(JSON.stringify(msg));
              }
              break;

            case "leave":
              if (signerName) {
                this.leaveRoom(msg.room!, signerName);
                this.clients.delete(signerName);
                console.log(
                  chalk.yellow(`  ← ${signerName} left room ${msg.room}`)
                );
              }
              break;
          }
        } catch (error) {
          console.error(chalk.red("Error processing message:"), error);
        }
      });

      ws.on("close", () => {
        if (signerName) {
          // Find and leave all rooms
          for (const [room, signers] of this.rooms.entries()) {
            if (signers.has(signerName)) {
              this.leaveRoom(room, signerName);
            }
          }
          this.clients.delete(signerName);
          console.log(chalk.yellow(`  ← ${signerName} disconnected`));
        }
      });

      ws.on("error", (error) => {
        console.error(chalk.red("WebSocket error:"), error);
      });
    });
  }

  private joinRoom(room: string, signerName: string) {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, new Set());
    }
    this.rooms.get(room)!.add(signerName);
  }

  private leaveRoom(room: string, signerName: string) {
    const signers = this.rooms.get(room);
    if (signers) {
      signers.delete(signerName);
      if (signers.size === 0) {
        this.rooms.delete(room);
      }
    }
  }

  private broadcastToRoom(
    room: string,
    message: SignalingMessage,
    exclude?: string
  ) {
    const signers = this.rooms.get(room);
    if (signers) {
      signers.forEach((signer) => {
        if (signer !== exclude && this.clients.has(signer)) {
          this.clients.get(signer)!.send(JSON.stringify(message));
        }
      });
    }
  }

  close() {
    this.clients.forEach((client) => {
      try {
        client.close();
      } catch (error) {
        console.warn(chalk.yellow(`  ⚠ Failed to close client: ${error}`));
      }
    });
    this.clients.clear();
    this.rooms.clear();
    this.server.close();
    this.removeAllListeners();
  }
}

/**
 * Start signaling server (if not already running)
 */
let signalingServerInstance: SignalingServer | null = null;

export function startSignalingServer(port: number = 8081): SignalingServer {
  if (!signalingServerInstance) {
    signalingServerInstance = new SignalingServer(port);
  }
  return signalingServerInstance;
}

export function getSignalingServer(): SignalingServer | null {
  return signalingServerInstance;
}

export function stopSignalingServer(): void {
  if (signalingServerInstance) {
    signalingServerInstance.close();
    signalingServerInstance = null;
  }
}
