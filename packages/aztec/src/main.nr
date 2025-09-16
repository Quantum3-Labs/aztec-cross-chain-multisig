use dep::aztec::macros::aztec;

#[aztec]
pub contract CustomAccount {
    use dep::aztec::{
        authwit::{
            account::AccountActions,
            entrypoint::{app::AppPayload, fee::FeePayload},
        },
        macros::functions::{private, view},
        oracle::auth_witness::get_auth_witness,
        prelude::{PrivateContext, AztecAddress},
    };
    use dep::wormhole::Wormhole;
    use dep::std::embedded_curve_ops::EmbeddedCurvePoint;

    global public_key: EmbeddedCurvePoint = EmbeddedCurvePoint {
        x: 0x05f25702c577d430017d4482cc2dbed6e862928afa6cb81723c8ebb54bdbd00e,
        y: 0x2a393d77ff08a77101dc2bf9d753315cafb4394f3840b426f9068fc56f9c14b4,
        is_infinite: false,
    };

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

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Safety: witness only used to pass Schnorr verification
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }
        schnorr::verify_signature(public_key, signature, outer_hash.to_be_bytes::<32>())
    }

    #[private]
    pub fn publish_intent(
        wormhole_address: Field,
        target_chain_id: Field,
        target_contract: Field,
        method_id: Field,
        payload: [Field; 4],
        nonce: Field,
    ) {
        let wormhole_payload: [[u8; 31]; 8] = [
            target_chain_id.to_be_bytes::<31>(),
            target_contract.to_be_bytes::<31>(),
            method_id.to_be_bytes::<31>(),
            payload[0].to_be_bytes::<31>(),
            payload[1].to_be_bytes::<31>(),
            payload[2].to_be_bytes::<31>(),
            payload[3].to_be_bytes::<31>(),
            nonce.to_be_bytes::<31>(),
        ];

        let _ = Wormhole::at(AztecAddress { inner: wormhole_address }).publish_message_in_private(
            1,
            wormhole_payload,
            2,
            2,
            context.msg_sender(),
            nonce,
        ).call(&mut context);
    }
}
