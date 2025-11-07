# WebRTC Implementation for Shared State Account Exchange

This implementation provides a real WebRTC solution for exchanging shared state accounts between signers during multisig creation.

## Architecture

### Components

1. **Signaling Server** (`signaling-server.ts`)
   - WebSocket-based signaling server
   - Handles room management and message routing
   - Runs on port 8081 by default

2. **WebRTC Client** (`webrtc-client.ts`)
   - Manages peer-to-peer connections
   - Handles offer/answer exchange
   - Manages ICE candidates
   - Uses data channels for secure data exchange

3. **WebRTC Signaling** (`webrtc-signaling.ts`)
   - High-level API for exchanging shared state accounts
   - Coordinates the WebRTC exchange process

## How It Works

1. **Signaling Server Startup**
   - Automatically starts when `exchangeSharedStateViaWebRTC` is called
   - Creates a WebSocket server for signaling

2. **Room Creation**
   - Each multisig creation session gets a unique room ID
   - All signers join the same room

3. **Peer Connection Establishment**
   - Creator initiates WebRTC offers to all recipients
   - Recipients respond with answers
   - ICE candidates are exchanged for NAT traversal

4. **Data Channel**
   - Once connected, data channels are established
   - Shared state account data is sent through encrypted data channels

5. **Cleanup**
   - All connections are closed after exchange completes

## Usage

The WebRTC exchange is automatically triggered during multisig creation:

```typescript
await createMultisig(signers, threshold, multisigName);
```

The exchange happens automatically when there are multiple signers.

## Dependencies

- `@koush/wrtc`: WebRTC implementation for Node.js (prebuilt for Apple silicon)
- `ws`: WebSocket library for signaling

## Network Requirements

- STUN servers are used for NAT traversal (Google's public STUN servers)
- For production, consider using TURN servers for better connectivity
- Signaling server must be accessible to all signers

## Security Considerations

- Data channels are encrypted by WebRTC
- Shared state account data is sent over secure peer-to-peer connections
- Consider additional encryption for sensitive data if needed

## Troubleshooting

### Connection Issues

If peer connections fail:
1. Check firewall settings
2. Ensure STUN/TURN servers are accessible
3. Verify signaling server is running
4. Check network connectivity between signers

### Timeout Errors

If you see timeout errors:
- Increase timeout values in `webrtc-client.ts`
- Check network latency
- Verify all signers are connected to signaling server

