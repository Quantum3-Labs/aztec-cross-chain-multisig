use dep::aztec::macros::aztec;

#[aztec]
contract SimpleWormhole {
    use dep::aztec::{
        prelude::{AztecAddress, Field},
        macros::functions::{private, public},
        context::gas::GasOpts,
    };

    #[private]
    fn publish_message_in_private(
        consistency_level: u8,
        payload: [[u8; 31]; 8],
        target_chain: u16,
        target_address: u16,
        refund_address: AztecAddress,
        nonce: Field
    ) {
        // Convert payload to fields for public function
        let mut payload_fields: [Field; 8] = [0; 8];
        for i in 0..8 {
            let mut value = 0 as Field;
            for j in 0..31 {
                value = value * 256 + payload[i][j] as Field;
            }
            payload_fields[i] = value;
        }
        
        // Enqueue public call to emit message
        SimpleWormhole::at(context.this_address()).emit_wormhole_message(
            consistency_level as Field,
            payload_fields,
            target_chain as Field,
            nonce
        ).enqueue(&mut context);
    }

    #[public]
    fn emit_wormhole_message(
        consistency_level: Field,
        payload: [Field; 8],
        target_chain: Field,
        nonce: Field
    ) {
        // Emit as unencrypted log that can be read by relayers
        context.emit_unencrypted_log(
            [consistency_level, target_chain, nonce, payload[0], payload[1], payload[2], payload[3], payload[4]]
        );
    }
}