import {
  createLogger,
  createPXEClient,
  loadContractArtifact,
  Logger,
  waitForPXE,
} from "@aztec/aztec.js";

// const MultisigEmitterContractArtifact = loadContractArtifact();

const { PXE_URL = "http://localhost:8080" } = process.env;

async function main() {
  /***************************  BASIC SETUP ****************************** */
  let logger: Logger;
  logger = createLogger("aztec:cross-chain-multisig");

  console.log("HALOO");

  /***************************  SETUP PXE ****************************** */
  const pxe = createPXEClient(PXE_URL);
  await waitForPXE(pxe);
  console.log(`Connected to PXE at ${PXE_URL}`);

  /***************************  SETUP ACCOUNT ****************************** */
}

main();
