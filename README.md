## Aztec cross-chain multisig to interact with Arbitrum

**Monorepo for Q3x demo app**

Consists of

- **aztec**: Contracts for Aztec.
- **arbitrum**: Contracts for Arbitrum.

**Quick Start**

1. Install dependencies

```bash
yarn
```

2. Run the command to spin up sandbox environment.

```bash
aztec start --sandbox
```

> Note: Don't have aztec CLI? Check the quickstart [here](https://docs.aztec.network/developers/getting_started/getting_started_on_sandbox)
>
> Or if you need exact version, use the following command
>
> ```bash
> aztec-up 1.2.0
> ```

3. Run the Aztec script

```bash
yarn aztec:cross-chain-multisig
```

4. Start editing the script file `./packages/aztec/scripts/cross_chain_multisig.ts`

<br />

**Compile Contract**

1. Run the command to compile the Noir contact

```bash
yarn aztec:compile
```

**Reference Contract For Using Wormhole on Aztec and Arbitrum**
Aztec: https://github.com/NethermindEth/aztec-wormhole-app-demo/blob/main/packages/aztec-contracts/emitter/src/main.nr

Arbitrum: https://github.com/NethermindEth/aztec-wormhole-app-demo/blob/main/packages/contracts/src/Vault.sol

**Reference For Using aztec.js To Call Contract Function**
Calling publish message function on Aztec contract using aztec.js: https://github.com/NethermindEth/aztec-wormhole-app-demo/blob/main/packages/frontend/app/contracts/send-message.mjs
