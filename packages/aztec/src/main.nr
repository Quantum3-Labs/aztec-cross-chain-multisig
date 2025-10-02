use dep::aztec::macros::aztec;

#[aztec]
pub contract PrivateMultisig {
    use dep::aztec::{
        authwit::{account::AccountActions, entrypoint::{app::AppPayload, fee::FeePayload}},
        context::PrivateContext,
        macros::{functions::{internal, private, public}, storage::storage},
        note::note_getter_options::NoteGetterOptions,
        oracle::auth_witness::get_auth_witness,
        protocol_types::{address::AztecAddress, hash::poseidon2_hash, traits::ToField},
        state_vars::{Map, PrivateMutable, PrivateSet, PublicMutable},
    };
    use dep::value_note::value_note::ValueNote;

    #[storage]
    struct Storage<Context> {
        message_approvals: Map<Field, Map<AztecAddress, PrivateSet<ValueNote, Context>, Context>, Context>,
        signers: Map<AztecAddress, PrivateSet<ValueNote, Context>, Context>,
        threshold: PrivateMutable<ValueNote, Context>,
        signer_pubkeys_x: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_pubkeys_y: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_count: PrivateMutable<ValueNote, Context>,
        executed_intents: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Safety: get_auth_witness is safe here as we validate the witness format
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }
        _validate_signature_format(signature, outer_hash)
    }

    #[contract_library_method]
    fn _validate_signature_format(signature: [u8; 64], message_hash: Field) -> bool {
        let mut signature_valid = false;
        let mut non_zero_bytes = 0;
        for i in 0..64 {
            if signature[i] != 0 {
                non_zero_bytes = non_zero_bytes + 1;
                signature_valid = true;
            }
        }
        signature_valid & (non_zero_bytes >= 32) & (message_hash != 0)
    }

    #[contract_library_method]
    fn verify_schnorr_signature(
        message_hash: Field,
        signature: [u8; 64],
        pubkey_x: Field,
        pubkey_y: Field,
    ) -> bool {
        let pub_key = dep::std::embedded_curve_ops::EmbeddedCurvePoint {
            x: pubkey_x,
            y: pubkey_y,
            is_infinite: false,
        };
        dep::schnorr::verify_signature(pub_key, signature, message_hash.to_be_bytes::<32>())
    }

    #[private]
    fn constructor(
        initial_signer: AztecAddress,
        initial_signer_pk_x: Field,
        initial_signer_pk_y: Field,
        initial_threshold: Field,
    ) {
        assert(initial_threshold as u32 > 0, "Threshold must be greater than 0");
        assert(!initial_signer.is_zero(), "Initial signer cannot be zero address");

        let deployer = context.msg_sender();

        storage.threshold.initialize(ValueNote::new(initial_threshold, deployer)).discard();
        storage.signers.at(initial_signer).insert(ValueNote::new(1, initial_signer)).discard();
        storage
            .signer_pubkeys_x
            .at(initial_signer)
            .initialize(ValueNote::new(initial_signer_pk_x, initial_signer))
            .discard();
        storage
            .signer_pubkeys_y
            .at(initial_signer)
            .initialize(ValueNote::new(initial_signer_pk_y, initial_signer))
            .discard();
        storage.signer_count.initialize(ValueNote::new(1, deployer)).discard();
    }

    #[private]
    fn entrypoint(app: AppPayload, fee: FeePayload, cancellable: bool) {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.entrypoint(app, fee, cancellable);
    }

    #[private]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    #[private]
    fn add_signer(
        new_signer: AztecAddress,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        assert(!new_signer.is_zero(), "Cannot add zero address as signer");
        assert((new_signer_pk_x != 0) & (new_signer_pk_y != 0), "Invalid public key");

        let caller = context.msg_sender();
        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(caller).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Caller is not a signer");
        assert(signer_notes.get(0).note.value() == 1, "Caller is not an active signer");

        let message_hash = poseidon2_hash([
            1 as Field,
            new_signer.to_field(),
            new_signer_pk_x,
            new_signer_pk_y,
            0 as Field,
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        storage
            .message_approvals
            .at(message_hash)
            .at(caller)
            .insert(ValueNote::new(1, caller))
            .discard();
        message_hash
    }

    #[private]
    fn execute_add_signer(
        message_hash: Field,
        new_signer: AztecAddress,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
        approved_signers: [AztecAddress; 10],
        num_approved: u32,
    ) {
        let mut approval_count = 0;
        for i in 0..10 {
            if i < num_approved {
                let mut opts = NoteGetterOptions::new();
                let approvals = storage
                    .message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(opts.set_limit(1));
                if (approvals.len() > 0) & (approvals.get(0).note.value() == 1) {
                    approval_count += 1;
                }
            }
        }

        let threshold_note = storage.threshold.get_note();
        assert(approval_count >= threshold_note.note.value() as u32, "Insufficient approvals");

        let mut opts = NoteGetterOptions::new();
        assert(
            storage.signers.at(new_signer).get_notes(opts.set_limit(1)).len() == 0,
            "Signer exists",
        );

        storage.signers.at(new_signer).insert(ValueNote::new(1, new_signer)).discard();
        storage
            .signer_pubkeys_x
            .at(new_signer)
            .initialize(ValueNote::new(new_signer_pk_x, new_signer))
            .discard();
        storage
            .signer_pubkeys_y
            .at(new_signer)
            .initialize(ValueNote::new(new_signer_pk_y, new_signer))
            .discard();

        let count = storage.signer_count.get_note().note.value() + 1;
        storage.signer_count.replace(ValueNote::new(count, context.msg_sender())).discard();

        PrivateMultisig::at(context.this_address())._mark_executed(message_hash).enqueue(
            &mut context,
        );
    }

    #[private]
    fn remove_signer(
        target_signer: AztecAddress,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        let caller = context.msg_sender();
        assert(caller != target_signer, "Cannot remove yourself");

        let message_hash = poseidon2_hash([
            2 as Field,
            target_signer.to_field(),
            0 as Field,
            0 as Field,
            0 as Field,
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        storage
            .message_approvals
            .at(message_hash)
            .at(caller)
            .insert(ValueNote::new(1, caller))
            .discard();
        message_hash
    }

    #[private]
    fn execute_remove_signer(
        message_hash: Field,
        target_signer: AztecAddress,
        approved_signers: [AztecAddress; 10],
        num_approved: u32,
    ) {
        let mut approval_count = 0;
        for i in 0..10 {
            if i < num_approved {
                let mut opts = NoteGetterOptions::new();
                let approvals = storage
                    .message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(opts.set_limit(1));
                if (approvals.len() > 0) & (approvals.get(0).note.value() == 1) {
                    approval_count += 1;
                }
            }
        }

        let threshold = storage.threshold.get_note().note.value();
        assert(approval_count >= threshold as u32, "Insufficient approvals");

        let count = storage.signer_count.get_note().note.value();
        assert((count - 1) as u32 >= threshold as u32, "Would break threshold");

        let mut opts = NoteGetterOptions::new();
        let _old = storage.signers.at(target_signer).pop_notes(opts.set_limit(1));
        storage.signers.at(target_signer).insert(ValueNote::new(0, target_signer)).discard();
        storage.signer_count.replace(ValueNote::new(count - 1, context.msg_sender())).discard();

        PrivateMultisig::at(context.this_address())._mark_executed(message_hash).enqueue(
            &mut context,
        );
    }

    #[private]
    fn change_threshold(
        new_threshold: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        let message_hash = poseidon2_hash([
            3 as Field,
            0 as Field,
            0 as Field,
            0 as Field,
            new_threshold,
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let caller = context.msg_sender();
        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        storage
            .message_approvals
            .at(message_hash)
            .at(caller)
            .insert(ValueNote::new(1, caller))
            .discard();
        message_hash
    }

    #[private]
    fn execute_change_threshold(
        message_hash: Field,
        new_threshold: Field,
        approved_signers: [AztecAddress; 10],
        num_approved: u32,
    ) {
        let mut approval_count = 0;
        for i in 0..10 {
            if i < num_approved {
                let mut opts = NoteGetterOptions::new();
                let approvals = storage
                    .message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(opts.set_limit(1));
                if (approvals.len() > 0) & (approvals.get(0).note.value() == 1) {
                    approval_count += 1;
                }
            }
        }

        let old_threshold = storage.threshold.get_note().note.value();
        assert(approval_count >= old_threshold as u32, "Insufficient approvals");

        let count = storage.signer_count.get_note().note.value();
        assert(new_threshold as u32 <= count as u32, "Threshold exceeds signers");
        assert(new_threshold as u32 > 0, "Threshold must be > 0");

        storage.threshold.replace(ValueNote::new(new_threshold, context.msg_sender())).discard();
        PrivateMultisig::at(context.this_address())._mark_executed(message_hash).enqueue(
            &mut context,
        );
    }

    #[private]
    fn propose_transaction(
        to: AztecAddress,
        amount: u128,
        function_selector: Field,
        data_hash: Field,
        deadline: u64,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
    ) -> Field {
        let message_hash = poseidon2_hash([
            to.to_field(),
            amount as Field,
            function_selector,
            data_hash,
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let caller = context.msg_sender();
        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        storage
            .message_approvals
            .at(message_hash)
            .at(caller)
            .insert(ValueNote::new(1, caller))
            .discard();
        message_hash
    }

    #[private]
    fn approve_transaction(
        message_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
    ) {
        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let caller = context.msg_sender();
        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        storage
            .message_approvals
            .at(message_hash)
            .at(caller)
            .insert(ValueNote::new(1, caller))
            .discard();
    }

    #[private]
    fn execute_transaction(
        message_hash: Field,
        to: AztecAddress,
        amount: u128,
        function_selector: Field,
        data_hash: Field,
        approved_signers: [AztecAddress; 10],
        num_approved: u32,
    ) {
        let mut approval_count = 0;
        for i in 0..10 {
            if i < num_approved {
                let mut opts = NoteGetterOptions::new();
                let approvals = storage
                    .message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(opts.set_limit(1));
                if (approvals.len() > 0) & (approvals.get(0).note.value() == 1) {
                    approval_count += 1;
                }
            }
        }

        let threshold = storage.threshold.get_note().note.value();
        assert(approval_count >= threshold as u32, "Insufficient approvals");

        PrivateMultisig::at(context.this_address())._mark_executed(message_hash).enqueue(
            &mut context,
        );
    }

    #[internal]
    #[public]
    fn _mark_executed(message_hash: Field) {
        storage.executed_intents.at(message_hash).write(true);
    }

    #[public]
    fn is_executed(message_hash: Field) -> bool {
        storage.executed_intents.at(message_hash).read()
    }

    #[private]
    fn get_threshold() -> Field {
        storage.threshold.get_note().note.value()
    }

    #[private]
    fn get_signer_count() -> Field {
        storage.signer_count.get_note().note.value()
    }

    #[private]
    fn is_signer(address: AztecAddress) -> bool {
        let mut opts = NoteGetterOptions::new();
        let notes = storage.signers.at(address).get_notes(opts.set_limit(1));
        (notes.len() > 0) & (notes.get(0).note.value() == 1)
    }
}
