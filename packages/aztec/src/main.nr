use dep::aztec::macros::aztec;

#[aztec]
pub contract MultiSchnorrAccount {
    use aztec::{
        macros::{functions::{initializer, public}, storage::storage},
        state_vars::{Map, PublicMutable},
    };

    global IS_VALID_SELECTOR: Field = 0xabf64ad4;

    #[storage]
    struct Storage<Context> {
        pk_x: Map<u8, PublicMutable<Field, Context>, Context>,
        pk_y: Map<u8, PublicMutable<Field, Context>, Context>,
        threshold: PublicMutable<u8, Context>,
        approvals: Map<Field, PublicMutable<u8, Context>, Context>,
    }

    #[public]
    #[initializer]
    fn constructor(
        pk1_x: Field, pk1_y: Field,
        pk2_x: Field, pk2_y: Field,
        pk3_x: Field, pk3_y: Field,
        m: u8
    ) {
        storage.pk_x.at(1).write(pk1_x);
        storage.pk_y.at(1).write(pk1_y);

        storage.pk_x.at(2).write(pk2_x);
        storage.pk_y.at(2).write(pk2_y);

        storage.pk_x.at(3).write(pk3_x);
        storage.pk_y.at(3).write(pk3_y);

        storage.threshold.write(m);
    }

    #[public]
    fn approve_public_authwit(inner_hash: Field) {
        let count_before: u8 = storage.approvals.at(inner_hash).read();
        let new_count: u8 = count_before + 1;
        storage.approvals.at(inner_hash).write(new_count);
    }

    #[public]
    fn verify_public_authwit(inner_hash: Field) -> Field {
        let count: u8 = storage.approvals.at(inner_hash).read();
        let th: u8 = storage.threshold.read();
        if count >= th {
            storage.approvals.at(inner_hash).write(0);
            IS_VALID_SELECTOR
        } else {
            0
        }
    }

    #[public]
    fn get_threshold() -> u8 {
        storage.threshold.read()
    }

    #[public]
    fn get_pk(i: u8) -> (Field, Field) {
        (storage.pk_x.at(i).read(), storage.pk_y.at(i).read())
    }
}
