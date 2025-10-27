import { AztecAddress, Fr, waitForPXE } from "@aztec/aztec.js";
import { setupPXE } from "../cli/setup_pxe";
import { setupSponsoredFPC } from "../cli/sponsored_fpc";
import { MultisigAccountContract } from "../aztec-contracts/src/artifacts/MultisigAccount";
import { createSigner } from "./utils/signer";
import { signMessage, toFr, toScalar } from "../cli/utils";
import { randomInt } from "crypto";
import { poseidon2Hash } from "@aztec/foundation/crypto";

async function main() {
  const { pxe, store } = await setupPXE();
  await waitForPXE(pxe);

  const fee = await setupSponsoredFPC();
  console.log(randomInt(0, 2 ** 8 - 1).toString());

  const sharedStateAccount = await createSigner(pxe);
  const signer1 = await createSigner(pxe);
  const signer2 = await createSigner(pxe);

  try {
    console.log(signer1.address, signer2.address);

    // deploy multisig contract
    const multisig = await MultisigAccountContract.deploy(
      sharedStateAccount.wallet,
      [signer1.address, ...Array(7).fill(AztecAddress.ZERO)],
      1,
      [toFr(signer1.publicKeyX), ...Array(7).fill(0)],
      [toFr(signer1.publicKeyY), ...Array(7).fill(0)]
    )
      .send({
        from: sharedStateAccount.wallet.getAddress(),
        fee,
        contractAddressSalt: toFr(randomInt(0, 2 ** 8 - 1).toString()),
      })
      .deployed({
        wallet: sharedStateAccount.wallet,
      });
    // print out signer 1, 2, deployer and multisig addresses
    console.log("signer1 address:", signer1.address);
    console.log("signer2 address:", signer2.address);
    console.log("multisig address:", multisig.address);

    await pxe.resetNoteSyncData();

    const notes = await pxe.getNotes({
      contractAddress: AztecAddress.fromString(multisig.address.toString()),
    });
    console.log("notes:", notes);

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const messageHash = await poseidon2Hash([
      Fr.fromString(signer2.address),
      Fr.fromString(signer2.publicKeyX),
      Fr.fromString(signer2.publicKeyY),
      Fr.fromString(deadline.toString()),
    ]);
    const messageHash2 = await poseidon2Hash([
      Fr.fromString(signer2.address),
      Fr.fromString(signer1.publicKeyX),
      Fr.fromString(signer1.publicKeyY),
      Fr.fromString(deadline.toString()),
    ]);

    const signature = await signMessage(
      messageHash,
      toScalar(signer1.privateKey)
    );
    const signature2 = await signMessage(
      messageHash2,
      toScalar(signer1.privateKey)
    );

    const tx = await multisig
      .withWallet(sharedStateAccount.wallet)
      .methods.add_signer(
        messageHash,
        AztecAddress.fromString(signer2.address),
        toFr(signer2.publicKeyX),
        toFr(signer2.publicKeyY),
        [
          ...Array(1).fill({
            signature: signature,
            owner: AztecAddress.fromString(signer1.address),
          }),
          ...Array(7).fill({
            signature: [...Array(64).fill(0)],
            owner: AztecAddress.ZERO,
          }),
        ]
      )
      .send({ from: AztecAddress.fromString(sharedStateAccount.address), fee })
      .wait();

    await pxe.resetNoteSyncData();
    await pxe.getNotes({
      contractAddress: AztecAddress.fromString(multisig.address.toString()),
    });

    // read is signer for signer2
    const isSigner = await multisig.methods
      .is_address_signer(AztecAddress.fromString(signer2.address))
      .simulate({
        from: AztecAddress.fromString(sharedStateAccount.address),
      });
    console.log("is signer:", isSigner);

    await multisig
      .withWallet(sharedStateAccount.wallet)
      .methods.sync_private_state()
      .simulate({
        from: AztecAddress.fromString(sharedStateAccount.address),
        fee,
      });

    // remove signer2 from multisig
    // const removeSignerTx = await multisig
    //   .withWallet(sharedStateAccount.wallet)
    //   .methods.remove_signer(
    //     messageHash,
    //     AztecAddress.fromString(signer2.address),
    //     [
    //       ...Array(1).fill({
    //         signature: signature,
    //         owner: AztecAddress.fromString(signer1.address),
    //       }),
    //       ...Array(7).fill({
    //         signature: [...Array(64).fill(0)],
    //         owner: AztecAddress.ZERO,
    //       }),
    //     ]
    //   )
    //   .send({ from: AztecAddress.fromString(sharedStateAccount.address), fee })
    //   .wait();

    // // sync again
    // await multisig
    //   .withWallet(sharedStateAccount.wallet)
    //   .methods.sync_private_state()
    //   .simulate({
    //     from: AztecAddress.fromString(sharedStateAccount.address),
    //     fee,
    //   });

    // // validate signer 2 again
    // const isSignerAgain = await multisig.methods
    //   .is_address_signer(AztecAddress.fromString(signer2.address))
    //   .simulate({
    //     from: AztecAddress.fromString(sharedStateAccount.address),
    //   });
    // console.log("is signer again:", isSignerAgain);

    // change threshold
    const changeThresholdTx = await multisig
      .withWallet(sharedStateAccount.wallet)
      .methods.change_threshold(messageHash2, 2, [
        ...Array(1).fill({
          signature: signature2,
          owner: AztecAddress.fromString(signer1.address),
        }),
        ...Array(7).fill({
          signature: [...Array(64).fill(0)],
          owner: AztecAddress.ZERO,
        }),
      ])
      .send({ from: AztecAddress.fromString(sharedStateAccount.address), fee })
      .wait();

    // read threshold
    const threshold = await multisig.methods.get_threshold().simulate({
      from: AztecAddress.fromString(sharedStateAccount.address),
    });
    console.log("threshold:", threshold);

    await store.delete();
  } catch (error) {
    console.log(error);
    await store.delete();
  }
}

main().catch(console.error);
