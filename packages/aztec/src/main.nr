use dep::aztec::macros::aztec;

#[aztec]
pub contract MultisigEmitter {
    use dep::aztec::{
        authwit::{account::AccountActions, entrypoint::{app::AppPayload, fee::FeePayload}},
        macros::functions::{private, view},
        oracle::auth_witness::get_auth_witness,
        prelude::{AztecAddress, PrivateContext},
    };
    use dep::std;
    use dep::token::Token;
    use dep::wormhole::Wormhole;
    use std::embedded_curve_ops::EmbeddedCurvePoint;

    global public_key: EmbeddedCurvePoint = EmbeddedCurvePoint {
        x: 0x16b93f4afae55cab8507baeb8e7ab4de80f5ab1e9e1f5149bf8cd0d375451d90,
        y: 0x208d44b36eb6e73b254921134d002da1a90b41131024e3b1d721259182106205,
        is_infinite: false,
    };

    #[private]
    pub fn verify_and_publish(
        msg: [[u8; 31]; 7], // Format: [Account address on Arbitrum, Arb chain ID, msg1, msg2, msg3, msg4, msg5]
        wormhole_address: AztecAddress,
        token_address: AztecAddress, // address of the token to be donated
        amount: u128, // amount of tokens to be donated on chosen chainID
        nonce: Field,
    ) {
        let bridge_address = AztecAddress {
            inner: 0x0848d2af89dfd7c0e171238f9216399e61e908cd31b0222a920f1bf621a16ed6, // Wormhome bridge address
        };

        let amount_field: Field = amount as Field;
        let payload3: [u8; 31] = amount_field.to_le_bytes();

        // Payload Field 4-8: Message
        // The message is already in the format of 5 u8s, so we can directly use it
        let wormhole_payload = [msg[0], msg[1], payload3, msg[2], msg[3], msg[4], msg[5], msg[6]];

        // 4. call publish message
        let _ = Wormhole::at(wormhole_address)
            .publish_message_in_private(1, wormhole_payload, 2, 2, context.msg_sender(), nonce)
            .call(&mut context);
    }

    // Note: If you globally change the entrypoint signature don't forget to update account_entrypoint.ts
    #[private]
    fn entrypoint(app_payload: AppPayload, fee_payload: FeePayload, cancellable: bool) {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.entrypoint(app_payload, fee_payload, cancellable);
    }

    #[private]
    #[view]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    // docs:start:is-valid
    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Load auth witness and format as an u8 array

        // Safety: The witness is only used as a "magical value" that makes the signature verification below pass.
        // Hence it's safe.
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }

        // Verify signature using hardcoded public key
        schnorr::verify_signature(public_key, signature, outer_hash.to_be_bytes::<32>())
    }
    // docs:end:is-valid
}
