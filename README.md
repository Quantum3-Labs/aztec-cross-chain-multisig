# Aztec Cross-Chain Multisig

A comprehensive CLI tool for managing Aztec private multisig contracts with cross-chain capabilities to Arbitrum.

## High Level Architecture
<img width="8340" height="4083" alt="image" src="https://github.com/user-attachments/assets/539c64f7-34b0-452b-af14-4eb233246739" />

## Quick Start

### Installation

1. **Clone and install dependencies:**

   ```bash
   git clone https://github.com/Quantum3-Labs/aztec-cross-chain-multisig.git
   cd aztec-cross-chain-multisig
   yarn install
   ```

2. **Initialize submodules:**

   ```bash
   git submodule update --init --recursive
   ```

3. **Start Aztec sandbox:**

   ```bash
   aztec start --sandbox
   ```

4. **Compile contracts:**
   ```bash
   yarn compile
   ```

## CLI Commands Reference

#### `create-signer [name]`

Creates a new signer and adds it to the signer registry.

**Options:**

- `name` (optional): Name for the signer (default: "Signer")

**Example:**

```bash
yarn dev create-signer alice
```

#### `list-signers`

Lists all registered signers with their private/public keys.

**Example:**

```bash
yarn dev list-signers
```

#### `use-signer <name>`

Sets the current active signer for operations.

**Options:**

- `name` (required): Name of the signer to use

**Example:**

```bash
yarn dev use-signer alice
```

#### `create-multisig <name> <threshold> <signers...>`

Creates and deploys a new multisig contract with specified signers and threshold.

**Options:**

- `name` (required): Name for the multisig
- `threshold` (required): Minimum number of signatures required
- `signers...` (required): Names of signers to include

**Example:**

```bash
yarn dev create-multisig family 2 alice bob charlie
```

#### `list-multisigs`

Lists all registered multisig contracts with their details.

**Example:**

```bash
yarn dev list-multisigs
```

#### `use-multisig <name>`

Sets the current active multisig for operations.

**Options:**

- `name` (required): Name of the multisig to use

**Example:**

```bash
yarn dev use-multisig family
```

#### `execute-cross-chain --message-hash <hash> [options]`

Executes a cross-chain intent to Arbitrum.

**Options:**

- `--message-hash <hash>` (required): Message hash of the intent
- `--amount <amount>` (optional): Amount to transfer (default: "1000000")
- `--recipient <address>` (optional): Recipient address

**Example:**

```bash
yarn dev execute-cross-chain --message-hash 0x123... --amount 1000000 --recipient 0x456...
```

#### `propose-add-signer <signer-name>`

Proposes adding a new signer to the current multisig.

**Options:**

- `signer-name` (required): Name of the signer to add

**Example:**

```bash
yarn dev propose-add-signer david
```

#### `propose-remove-signer <signer-name>`

Proposes removing a signer from the current multisig.

**Options:**

- `signer-name` (required): Name of the signer to remove

**Example:**

```bash
yarn dev propose-remove-signer charlie
```

#### `propose-change-threshold <new-threshold>`

Proposes changing the threshold of the current multisig.

**Options:**

- `new-threshold` (required): New threshold value

**Example:**

```bash
yarn dev propose-change-threshold 3
```

#### `sign-proposal --message-hash <hash> [options]`

Signs any pending proposal.

**Options:**

- `--message-hash <hash>` (required): Message hash of the proposal
- `--signer-name <name>` (optional): Name of the signer to use

**Example:**

```bash
yarn dev sign-proposal --message-hash 0x123...
```

#### `execute-add-signer --message-hash <hash>`

Executes an add signer proposal once threshold is met.

**Options:**

- `--message-hash <hash>` (required): Message hash of the proposal

**Example:**

```bash
yarn dev execute-add-signer --message-hash 0x123...
```

#### `execute-remove-signer --message-hash <hash>`

Executes a remove signer proposal once threshold is met.

**Options:**

- `--message-hash <hash>` (required): Message hash of the proposal

**Example:**

```bash
yarn dev execute-remove-signer --message-hash 0x123...
```

#### `execute-change-threshold --message-hash <hash>`

Executes a change threshold proposal once threshold is met.

**Options:**

- `--message-hash <hash>` (required): Message hash of the proposal

**Example:**

```bash
yarn dev execute-change-threshold --message-hash 0x123...
```

#### `status`

Shows current global state including active signer and multisig.

**Example:**

```bash
yarn dev status
```

#### `list-proxies`

Lists all deployed Arbitrum proxies.

**Example:**

```bash
yarn dev list-proxies
```

#### `list-proposals`

Lists all pending proposals with their status.

**Example:**

```bash
yarn dev list-proposals
```

#### `proposal-status --message-hash <hash>`

Shows detailed status of any proposal.

**Options:**

- `--message-hash <hash>` (required): Message hash of the proposal

**Example:**

```bash
yarn dev proposal-status --message-hash 0x123...
```

#### `clean`

Removes all JSON files (signers, multisigs, proxies, global state) and clears PXE store.

**Example:**

```bash
yarn dev clean
```

## 🏗️ Project Structure

```
├── aztec-contracts/          # Aztec Noir contracts
│   ├── src/
│   │   ├── main.nr          # Main multisig contract
│   │   ├── signature.nr     # Signature verification
│   │   └── artifacts/       # Generated contract artifacts
│   └── Nargo.toml
├── arbitrum-contracts/       # Solidity contracts for Arbitrum
│   ├── src/                 # Contract source files
│   ├── script/              # Deployment scripts
│   └── lib/                 # Submodules (OpenZeppelin, Wormhole, Forge)
├── cli/                     # CLI tool source
│   ├── src/                 # Core CLI modules
│   ├── index.ts             # Main CLI entry point
│   └── wormhole/            # Wormhole integration
├── tests/                   # Test files
└── store/                   # PXE data storage
```
