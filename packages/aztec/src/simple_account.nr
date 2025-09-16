use dep::aztec::prelude::{Field}
use dep::aztec::macros::{contract, constructor, public}
use dep::aztec::crypto::{poseidon, schnorr}

contract SimpleAccount {
    owner_pub_x: Field;
    owner_pub_y: Field;

    event TransferExecuted(to: Field, amount: Field);

    constructor(owner_x: Field, owner_y: Field) {
        self.owner_pub_x.write(owner_x);
        self.owner_pub_y.write(owner_y);
    }

    pub fn verify_and_transfer(to: Field, amount: Field, sig_r: Field, sig_s: Field) {
        let payload_hash = poseidon([to, amount]);
        let ok = schnorr::verify(self.owner_pub_x.read(), self.owner_pub_y.read(), payload_hash, sig_r, sig_s);
        assert(ok == 1, "invalid signature");
        emit TransferExecuted(to, amount);
    }
}
