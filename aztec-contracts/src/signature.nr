use aztec::protocol_types::{address::AztecAddress, traits::Serialize};

#[derive(Serialize)]
pub struct Signature {
    pub signature: [u8; 64],
    pub owner: AztecAddress,
}
