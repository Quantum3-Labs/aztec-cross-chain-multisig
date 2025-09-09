use dep::aztec::macros::aztec;

#[aztec]
pub contract MultisigEmitter {
    use dep::aztec::{
        macros::functions::private,
        prelude::AztecAddress,
        protocol_types::traits::{Deserialize, Serialize},
    };
    use dep::std;
    use dep::token::Token;
    use dep::wormhole::Wormhole;

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
}
