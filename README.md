# Aztec Cross-Chain Multisig

Private multisig coordination for Aztec that can bridge intents to Arbitrum via Wormhole. This repository contains the Noir multisig account contract, the Solidity vault that consumes Wormhole VAAs on Arbitrum, a CLI that orchestrates user workflows, and a relayer stack that keeps both domains in sync.

<p> Multisig management demo: https://drive.google.com/file/d/1La9Z93QykAXEWgre4Q79ZBVTpvAf-Y0f/view?usp=sharing <br />
Multisig cross chain demo: https://drive.google.com/file/d/1gWRVDAABJpS2UY-bdu_crydFhcJQ0rAp/view?usp=sharing <br />
(PLEASE SWITCH TO 720P)
</p>
---

## Architecture Overview

- **Aztec multisig contract (`aztec-contracts/src/main.nr`)**  
  A private Noir contract that stores up to eight signers, enforces thresholds, verifies Schnorr signatures, and publishes Wormhole payloads through the Aztec Wormhole binding.

- **CLI orchestrator (`cli/`)**  
  Built with Commander.js. It spins up signer-specific PXE instances, deploys Noir contracts, tracks state in local JSON files, and shells out to Foundry scripts for L2 deployments. The CLI is the entrypoint for creating accounts, proposing transactions, gathering signatures, and finally executing intents.

- **Arbitrum intent vault (`arbitrum-contracts/src/ArbitrumIntentVault.sol`)**  
  Solidity contract that consumes Wormhole VAAs. Once a valid Aztec emitter publishes a cross-chain intent, the vault validates the payload, stores bookkeeping, and releases funds to the requested recipient.

- **Relayer + VAA verification service (`relayer/`)**  
  A Go process subscribed to the Wormhole spy service. For Aztec→Arbitrum flows it validates VAAs, forwards payloads to the vault on Arbitrum. It handles retries, health checks, and logging levels suitable for prod monitoring.

- **Supporting artifacts**  
  Local signer data (`signers.json`), multisig manifests (`multisigs.json`), proposal/signature queues, Arbitrum proxy registry, and PXE stores under `store/` enable stateless commands to reconstruct context on each run.

---

## Data Flow at a Glance

1. **Signer bootstrap** – `create-signer` create a new keypair, deploys a Schnorr account in Aztec, and records data in `signers.json`.
2. **Multisig deployment** – `create-multisig` spins up a shared state account, register into every signer's PXE, deploys the Noir `MultisigAccount`, exchanges the shared account via WebRTC, deploys an Arbitrum proxy, and registers the Aztec emitter inside the Arbitrum vault.
<img src="https://github.com/Quantum3-Labs/aztec-cross-chain-multisig/blob/main/imgs/create-multisig.png"/>
4. **Proposal lifecycle** – `proposal-manager.ts` hashes intent-specific payloads (Poseidon2) and persists metadata to `pending-proposals.json`. Commands such as `propose-add-signer`, `propose-remove-signer`, `propose-change-threshold`, and `propose-cross-chain-intent` all feed this store.
5. **Signature collection** – Each signer runs `sign-proposal`, generates a Schnorr signature, and appends it to `pending-signatures.json`. Threshold progress is computed from this file.
6. **Execution** – Once enough signatures exist, `execute-*` commands build the 8-slot signature array expected by the Noir contract, submit the transaction, and persist the updated multisig state.
   - For cross-chain intents the Noir contract encodes the payload and calls Wormhole’s `publish_message_in_private_flat`.
   - The Go relayer watches for that emitter, fetches the VAA, and invokes `ArbitrumIntentVault.verify`, which validates the emitter and forwards the donation to the requested recipient.
<img src="https://github.com/Quantum3-Labs/aztec-cross-chain-multisig/blob/main/imgs/cross-chain.png"/>
---

## Operational Flows

### 1. Creating a signer (`yarn dev create-signer [name]`)

- Generates a fresh keypair
- Deploys a Schnorr account using `setupPXEForSigner` (isolated store under `store/<signer>`). Deployment fees are paid through the sponsored FPC helper.
- Registers the account sender with the wallet and writes `{name, address, keys, createdAt}` to `signers.json`.

### 2. Creating a multisig (`yarn dev create-multisig <name> <threshold> <signers...>`)

- Requires the CLI’s current signer to be part of the signer set.
- Builds a shared state account (used as the multisig “master”) and registers it inside every signer’s PXE via WebRTC-assisted exchange.
- Deploys the Noir `MultisigAccount` with padded arrays for up to eight signers and persists shared-account secrets inside `multisigs.json`.
- Deploys an Arbitrum proxy using Foundry’s `DeployMultisigProxy.s.sol`, stores it in `arbitrum-proxies.json`, and registers the Aztec emitter with the vault’s `registerEmitter`.

### 3. Proposing changes or intents

All proposal commands share the same plumbing in `cli/src/proposal-manager.ts`:

| Command                      | What gets hashed into `messageHash`                       | Stored metadata           |
| ---------------------------- | --------------------------------------------------------- | ------------------------- |
| `propose-add-signer`         | `[newSigner]`                         | Signer identity |
| `propose-remove-signer`      | `[targetSigner]`                                | Target signer info        |
| `propose-change-threshold`   | `[newThreshold]`                                | Desired threshold         |
| `propose-cross-chain-intent` | `[chain, proxy, intentType, amount, recipient]` | Arbitrum target + amount  |

Each proposal is persisted to `pending-proposals.json` with status `pending`, threshold counts, proposer name, and deadline.

### 4. Signing a proposal (`yarn dev sign-proposal --message-hash <hash>`)

- Loads the proposal and verifies it is still pending.
- Selects either the CLI’s current signer
- Uses Schnorr to sign the Poseidon hash and appends `{signerName, aztecAddress, signatureBytes}` to `pending-signatures.json`.
- Displays live progress (`collected / threshold`). The CLI warns when the threshold has been met so the executor can move forward.

### 5. Executing / submitting

Each executor command shares the same skeleton:

1. Build the `[Signature; 8]` array required by the Noir contract (empty slots zero-filled).
2. Call the target method (`add_signer`, `remove_signer`, `change_threshold`, or `execute_cross_chain_intent`) with the stored proposal data plus the signature array.

For **cross-chain intents** there are extra steps:

- The CLI registers the Wormhole core contract artifact, encodes the intent fields, and calls `execute_cross_chain_intent`.
- The Noir contract publishes the payload to Wormhole, marking the `message_hash` as executed so it cannot replay.
- The relayer receives the VAA, then calls `ArbitrumIntentVault.verify`.
- `ArbitrumIntentVault` checks the emitter registration, parses the payload, and execute.

---

## Command Reference

All commands live in `cli/index.ts` and are compiled via `yarn dev <command>`. The list below groups them by responsibility.

### Signer & Multisig Management

- `create-signer [name] [--local]`
- `list-signers`
- `use-signer <name>`
- `create-multisig <name> <threshold> <signers...>`
- `list-multisigs`
- `use-multisig <name>`
- `status`

### Proposal Lifecycle

- `propose-add-signer <signer-name>`
- `propose-remove-signer <signer-name>`
- `propose-change-threshold <new-threshold>`
- `propose-cross-chain-intent --amount <n> --recipient <0x...>`
- `list-proposals`
- `proposal-status --message-hash <hash>`
- `sign-proposal --message-hash <hash> [--signer-name <name>]`

### Execution

- `execute-add-signer --message-hash <hash>`
- `execute-remove-signer --message-hash <hash>`
- `execute-change-threshold --message-hash <hash>`
- `execute-cross-chain-intent --message-hash <hash>`
- `execute-cross-chain --message-hash <hash> [--amount <n>] [--recipient <0x...>]`

### Arbitrum Utilities

- `list-proxies` (reads `arbitrum-proxies.json`)

### Maintenance

- `clean` (purges JSON state files and the PXE `store/` directory).

---

## State & Persistence

| File                      | Purpose                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| `signers.json`            | List of signer identities created via `create-signer`.                         |
| `multisigs.json`          | On-chain multisig metadata, shared-state account secrets, thresholds, and Arbitrum proxy links. |
| `global-state.json`       | Tracks which signer/multisig is currently “active” for the CLI session.                         |
| `pending-proposals.json`  | Queue of proposals awaiting signatures or execution.                                            |
| `pending-signatures.json` | Schnorr signatures collected for each proposal.                                                 |
| `arbitrum-proxies.json`   | Addresses of Arbitrum proxies deployed per multisig.                                            |
| `store/`                  | LMDB PXE state per signer (`store/<signer>`). Clearing this wipes local witness data.           |

---

## Running the system

1. **Clone & install**
   - `git clone https://github.com/Quantum3-Labs/aztec-cross-chain-multisig.git` then `cd aztec-cross-chain-multisig`
   - `yarn` to install dependencies
2. **Start the Wormhole spy service** (required for the relayer)
   - Use the docker command:
     ```bash
     docker run --pull=always --platform=linux/amd64 \
       -p 7073:7073 \
       --entrypoint /guardiand ghcr.io/wormhole-foundation/guardiand:latest \
       spy \
       --nodeKey /node.key \
       --spyRPC "[::]:7073" \
       --env testnet
     ```
3. **Create and select a signer**
   - `yarn dev create-signer a` → provisions signer alias `a`
   - `yarn dev use-signer a` → updates `global-state.json` to act as signer `a`
4. **Create and select a multisig**
   - `yarn dev create-multisig company 1 a` → deploys multisig `company` with threshold 1 and signer `a`
   - `yarn dev use-multisig company` → marks `company` as the active multisig
5. **Inspect addresses**
   - `yarn dev status` → note both the Aztec multisig address and the Arbitrum proxy address for `company`
6. **Run the relayer**
   - Run with your private key, arbitrum proxy address and multisig address:
     ```bash
     go run ./relayer.go evm \
       --private-key <arbitrum-private-key> \
       --wormhole-contract 0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35 \
       --evm-target-contract <arbitrum-proxy-address> \
       --emitter-address <aztec-multisig-address>
     ```
7. **Propose and execute a cross-chain transfer**
   - `yarn dev propose-cross-chain-intent --amount 32 --recipient 0x35340673e33ef796b9a2d00db8b6a549205aabe4`
   - Follow the CLI instructions: sign via `yarn dev sign-proposal --message-hash <hash>` (only signer `a` is required with threshold 1) and execute with `yarn dev execute-cross-chain-intent --message-hash <hash>`.
8. **Let the relayer finalize**
   - Keep the relayer running; it will ingest the Wormhole VAA and submit to Arbitrum
