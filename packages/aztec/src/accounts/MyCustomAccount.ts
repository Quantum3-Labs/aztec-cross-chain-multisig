import {
  AccountContract,
  AuthWitness,
  AuthWitnessProvider,
  CompleteAddress,
  ContractArtifact,
  Fr,
  GrumpkinScalar,
  Schnorr,
  NodeInfo,
} from "@aztec/aztec.js";
import { DefaultAccountContract } from "@aztec/accounts/defaults";
import { MyCustomAccountContractArtifact } from "../artifacts/MyCustomAccount.js";

export class MyCustomAccountContract extends DefaultAccountContract {
  private privateKey: GrumpkinScalar;

  constructor(privateKeyString?: string) {
    super();
    const keyToUse = privateKeyString || process.env.SECRET;
    if (!keyToUse) {
      throw new Error(
        "Private key must be provided or SECRET must be set in environment"
      );
    }
    this.privateKey = GrumpkinScalar.fromString(keyToUse);
  }

  override getContractArtifact(): Promise<ContractArtifact> {
    return Promise.resolve(MyCustomAccountContractArtifact);
  }

  getDeploymentFunctionAndArgs() {
    return Promise.resolve(undefined);
  }

  getAuthWitnessProvider(_address: CompleteAddress): AuthWitnessProvider {
    const privateKey = this.privateKey;
    return {
      async createAuthWit(messageHash: Fr): Promise<AuthWitness> {
        const signer = new Schnorr();
        const signature = await signer.constructSignature(
          messageHash.toBuffer(),
          privateKey
        );
        return Promise.resolve(
          new AuthWitness(messageHash, [...signature.toBuffer()])
        );
      },
    };
  }
}
