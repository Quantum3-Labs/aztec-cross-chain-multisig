import { Fr } from "@aztec/aztec.js/fields";
import {
  getContractInstanceFromInstantiationParams,
  type ContractInstanceWithAddress,
} from "@aztec/aztec.js/contracts";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee/testing";
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
  const { wallet } = await setupPXE();

  const sponsoredFPC = await getSponsoredFPCInstance();
  await wallet.registerContract({
    instance: sponsoredFPC,
    artifact: SponsoredFPCContract.artifact,
  });

  const fee = {
    paymentMethod: new SponsoredFeePaymentMethod(sponsoredFPC.address),
  };
  return fee;
}
