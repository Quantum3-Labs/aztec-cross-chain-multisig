use aztec::protocol_types::{address::AztecAddress, traits::{Deserialize, FromField, Serialize}};

#[derive(Serialize, Deserialize)]
pub struct Signature {
    pub signature: [u8; 64],
    pub owner: AztecAddress,
}
