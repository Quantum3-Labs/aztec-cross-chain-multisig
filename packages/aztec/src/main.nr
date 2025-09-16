use dep::aztec::macros::aztec;

#[aztec]
pub contract MyCustomAccount {
    use dep::aztec::{
        authwit::{account::AccountActions, entrypoint::{app::AppPayload, fee::FeePayload}},
        macros::functions::{private, view},
        oracle::auth_witness::get_auth_witness,
        prelude::PrivateContext,
    };
    use std::embedded_curve_ops::EmbeddedCurvePoint;

    global public_key: EmbeddedCurvePoint = EmbeddedCurvePoint {
        x: 0x2fd60b1a7bd27630e3fdf305b509fc3dc6f5fcdcab3a03ba494f52fe3f019708,
        y: 0x18193f254d1d3fbf0fa92e39af6aa2f342ef853db56b01e0e168f26b9506509a,
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

    #[private]
    fn publish_message_in_private(
        target_chain: Field,
        target_address: Field,
        message_hash: Field
    ) -> Field {
        // For now, just return the message hash
        // Wormhole integration will be added when contract is available
        message_hash
    }

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Safety: The witness is only used for signature verification
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }
        schnorr::verify_signature(public_key, signature, outer_hash.to_be_bytes::<32>())
    }
}