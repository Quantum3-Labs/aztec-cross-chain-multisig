use dep::aztec::macros::aztec;

#[aztec]
pub contract MyCustomAccount {
    use dep::aztec::{
        authwit::{
            account::AccountActions,
            entrypoint::{app::AppPayload, fee::FeePayload},
        },
        macros::functions::{private, view},
        oracle::auth_witness::get_auth_witness,
        prelude::{AztecAddress, PrivateContext},
        protocol_types::traits::ToField,
    };
    use std::embedded_curve_ops::EmbeddedCurvePoint;
    use dep::wormhole::Wormhole;

    global public_key: EmbeddedCurvePoint = EmbeddedCurvePoint {
        x: 0x21941cb6c24c76a77a3dc7f2b6abb66abf364bb6ec39f143827f395b24a01ca8,
        y: 0x25e1e36253675d5c600a378725d35f93fe8bf154eead9c44e4b8ef7be550be6d,
        is_infinite: false,
    };

    #[private]
    fn entrypoint(app_payload: AppPayload, fee_payload: FeePayload, cancellable: bool) {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.entrypoint(app_payload, fee_payload, cancellable);
    }

    #[private]
    #[view]
    pub fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    #[private]
    fn send_cross_chain_message(
        wormhole_address: AztecAddress,
        target_eth_address: Field,
        amount: Field,
        intent_type: Field,
        nonce: Field,
    ) {
        let tx_id = std::hash::pedersen_hash([context.msg_sender().to_field(), nonce]);

        let mut payload_1: [u8; 31] = [0; 31];
        let tx_id_bytes = tx_id.to_be_bytes::<32>();
        for i in 0..31 {
            payload_1[i] = tx_id_bytes[i + 1];
        }

        let mut payload_2: [u8; 31] = [0; 31];
        let intent_bytes = intent_type.to_be_bytes::<32>();
        for i in 0..31 {
            payload_2[i] = intent_bytes[i + 1];
        }

        let mut payload_3: [u8; 31] = [0; 31];
        let target_bytes = target_eth_address.to_be_bytes::<32>();
        for i in 0..20 {
            payload_3[i + 11] = target_bytes[i + 12];
        }

        let mut payload_4: [u8; 31] = [0; 31];
        let amount_bytes = amount.to_be_bytes::<32>();
        for i in 0..31 {
            payload_4[i] = amount_bytes[i + 1];
        }

        let payload_5: [u8; 31] = [0; 31];
        let payload_6: [u8; 31] = [0; 31];
        let payload_7: [u8; 31] = [0; 31];
        let payload_8: [u8; 31] = [0; 31];

        let wormhole_payload: [[u8; 31]; 8] = [
            payload_1, payload_2, payload_3, payload_4,
            payload_5, payload_6, payload_7, payload_8,
        ];

        let _ = Wormhole::at(wormhole_address).publish_message_in_private(
            1,
            wormhole_payload,
            23,
            23,
            context.msg_sender(),
            nonce,
        ).call(&mut context);
    }

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Safety: witness must be provided externally by PXE
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }
        schnorr::verify_signature(public_key, signature, outer_hash.to_be_bytes::<32>())
    }
}
