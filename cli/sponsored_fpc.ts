import {
  ContractInstanceWithAddress,
  Fr,
  getContractInstanceFromInstantiationParams,
  SponsoredFeePaymentMethod,
} from "@aztec/aztec.js";
import { SponsoredFPCContract } from "@aztec/noir-contracts.js/SponsoredFPC";
import { setupPXE } from "./setup_pxe";

const SPONSORED_FPC_SALT = new Fr(0);

export async function getSponsoredFPCInstance(): Promise<ContractInstanceWithAddress> {
  return await getContractInstanceFromInstantiationParams(
    SponsoredFPCContract.artifact,
    {
      salt: SPONSORED_FPC_SALT,
    }
  );
}

export async function setupSponsoredFPC() {
  const { pxe } = await setupPXE();

  const sponsoredFPC = await getSponsoredFPCInstance();
  await pxe.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });

  const fee = {
    paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
  };
  return fee;
}
