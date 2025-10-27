use aztec::{
    macros::notes::note,
    protocol_types::{address::AztecAddress, traits::{Hash, Packable, Serialize}},
};

#[derive(Serialize)]
pub struct Signature {
    pub signature: [u8; 64],
    pub owner: AztecAddress,
}
