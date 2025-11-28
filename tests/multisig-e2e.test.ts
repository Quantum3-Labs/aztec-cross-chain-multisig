import { AztecAddress } from "@aztec/aztec.js/addresses";
import { setupPXE } from "../cli/setup_pxe";
import { setupSponsoredFPC } from "../cli/sponsored_fpc";
import { MultisigAccountContract } from "../aztec-contracts/src/artifacts/MultisigAccount";
import { createSigner } from "./utils/signer";
import { ethToAztecAddress, signMessage, toFr, toScalar } from "../cli/utils";
import { randomInt } from "crypto";
import { poseidon2Hash } from "@aztec/foundation/crypto";
import { Fr } from "@aztec/foundation/fields";

async function main() {
  const { wallet, store } = await setupPXE();
  const fee = await setupSponsoredFPC(wallet);
  console.log(randomInt(0, 2 ** 8 - 1).toString());

  const sharedStateAccount = await createSigner(wallet);
  const signer1 = await createSigner(wallet);
  // const signer2 = await createSigner(wallet);
  // console.log(sharedStateAccount.address, signer1.address, signer2.address);
  try {
    // deploy multisig contract
    const multisig = await MultisigAccountContract.deploy(
      wallet,
      [signer1.address, ...Array(7).fill(AztecAddress.ZERO)],
      1,
      [toFr(signer1.publicKeyX), ...Array(7).fill(0)],
      [toFr(signer1.publicKeyY), ...Array(7).fill(0)]
    )
      .send({
        from: AztecAddress.fromString(sharedStateAccount.address),
        fee,
        contractAddressSalt: toFr(randomInt(0, 2 ** 8 - 1).toString()),
      })
      .deployed({
        wallet: wallet,
      });
    // print out signer 1, 2, deployer and multisig addresses
    console.log("signer1 address:", signer1.address);
    // console.log("signer2 address:", signer2.address);
    console.log("multisig address:", multisig.address);
    const notes = await wallet.getNotes({
      contractAddress: AztecAddress.fromString(multisig.address.toString()),
    });
    console.log("notes:", notes);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    // const messageHash = await poseidon2Hash([
    //   Fr.fromString(signer2.address),
    //   Fr.fromString(signer2.publicKeyX),
    //   Fr.fromString(signer2.publicKeyY),
    //   Fr.fromString(deadline.toString()),
    // ]);
    const messageHash2 = await poseidon2Hash([
      Fr.fromString("421614"),
      ethToAztecAddress("0x35340673e33ef796b9a2d00db8b6a549205aabe4"),
      Fr.fromString("1"),
      Fr.fromString("100"),
      ethToAztecAddress("0x35340673e33ef796b9a2d00db8b6a549205aabe4"),
      deadline,
    ]);
    // const signature = await signMessage(
    //   messageHash,
    //   toScalar(signer1.privateKey)
    // );
    const signature2 = await signMessage(
      messageHash2,
      toScalar(signer1.privateKey)
    );

    await multisig
      .withWallet(wallet)
      .methods.execute_cross_chain_intent(
        messageHash2,
        Fr.fromString("421614"),
        ethToAztecAddress("0x35340673e33ef796b9a2d00db8b6a549205aabe4"),
        Fr.fromString("1"),
        Fr.fromString("100"),
        ethToAztecAddress("0x35340673e33ef796b9a2d00db8b6a549205aabe4"),
        AztecAddress.fromString(
          "0x2f56338d0bf01e37b89edea0ee8e96474c89575aa5e6f35012789738a06ed0ac"
        ),
        deadline,
        [
          ...Array(1).fill({
            signature: signature2,
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
    await wallet.getNotes({
      contractAddress: AztecAddress.fromString(multisig.address.toString()),
    });

    // const tx = await multisig
    //   .withWallet(wallet)
    //   .methods.add_signer(
    //     messageHash,
    //     AztecAddress.fromString(signer2.address),
    //     toFr(signer2.publicKeyX),
    //     toFr(signer2.publicKeyY),
    //     deadline,
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
    // await wallet.getNotes({
    //   contractAddress: AztecAddress.fromString(multisig.address.toString()),
    // });
    // // read is signer for signer2
    // const isSigner = await multisig.methods
    //   .is_address_signer(AztecAddress.fromString(signer2.address))
    //   .simulate({
    //     from: AztecAddress.fromString(sharedStateAccount.address),
    //   });
    // console.log("is signer:", isSigner);
    // await multisig
    //   .withWallet(wallet)
    //   .methods.sync_private_state()
    //   .simulate({
    //     from: AztecAddress.fromString(sharedStateAccount.address),
    //     fee,
    //   });
    // // remove signer2 from multisig
    // const removeSignerTx = await multisig
    //   .withWallet(wallet)
    //   .methods.remove_signer(
    //     messageHash2,
    //     AztecAddress.fromString(signer2.address),
    //     deadline,
    //     [
    //       ...Array(1).fill({
    //         signature: signature2,
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
    //   .withWallet(wallet)
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
    // const changeThresholdTx = await multisig
    //   .withWallet(sharedStateAccount.wallet)
    //   .methods.change_threshold(messageHash2, 2, [
    //     ...Array(1).fill({
    //       signature: signature2,
    //       owner: AztecAddress.fromString(signer1.address),
    //     }),
    //     ...Array(7).fill({
    //       signature: [...Array(64).fill(0)],
    //       owner: AztecAddress.ZERO,
    //     }),
    //   ])
    //   .send({ from: AztecAddress.fromString(sharedStateAccount.address), fee })
    //   .wait();
    // // read threshold
    // const threshold = await multisig.methods.get_threshold().simulate({
    //   from: AztecAddress.fromString(sharedStateAccount.address),
    // });
    // console.log("threshold:", threshold);
    await store.delete();
  } catch (error) {
    console.log(error);
    await store.delete();
  }
}

main().catch(console.error);
