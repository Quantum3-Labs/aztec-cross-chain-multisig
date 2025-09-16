import {
    AccountContract,
    ContractArtifact,
    CompleteAddress,
    NodeInfo,
    AccountInterface,
    AuthWitnessProvider,
    AuthWitness,
    Fr,
    Schnorr,
    GrumpkinScalar,
  } from "@aztec/aztec.js";
  import { CustomAccountContractArtifact } from "../artifacts/CustomAccount.js";
  import * as dotenv from "dotenv";
  
  dotenv.config();
  
  const SECRET = process.env.SECRET;
  if (!SECRET) {
    throw new Error("Missing SECRET in .env");
  }
  
  const PRIVATE_KEY = GrumpkinScalar.fromHexString(SECRET);
  
  export class CustomAccount implements AccountContract {
    getContractArtifact(): Promise<ContractArtifact> {
      return Promise.resolve(CustomAccountContractArtifact);
    }
  
    async getDeploymentFunctionAndArgs() {
      return undefined;
    }
  
    getInterface(address: CompleteAddress, nodeInfo: NodeInfo): AccountInterface {
      return {
        getCompleteAddress: () => address,
        getChainId: () => new Fr(nodeInfo.l1ChainId),  
        getVersion: () => new Fr(1n),                
        getAddress: () => address.address,
        createTxExecutionRequest: () => {
          throw new Error("Not implemented: createTxExecutionRequest");
        },
        createAuthWit: () => {
          throw new Error("Not implemented: createAuthWit");
        },
      };
    }
  
    getAuthWitnessProvider(_address: CompleteAddress): AuthWitnessProvider {
      return {
        async createAuthWit(messageHash: Fr): Promise<AuthWitness> {
          const signer = new Schnorr();
          const signature = await signer.constructSignature(
            messageHash.toBuffer(),
            PRIVATE_KEY,
          );
          return new AuthWitness(messageHash, [...signature.toBuffer()]);
        },
      };
    }
  }
  