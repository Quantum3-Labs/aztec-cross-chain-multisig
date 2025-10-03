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

    global IS_VALID_SELECTOR: Field = 0xabf64ad4;

    #[storage]
    struct Storage<Context> {
        message_approval_count: Map<Field, PublicMutable<Field, Context>, Context>,
        signer_has_approved: Map<Field, Map<AztecAddress, PublicMutable<bool, Context>, Context>, Context>,
        threshold: PublicMutable<Field, Context>,
        signer_count: PublicMutable<Field, Context>,
        executed_intents: Map<Field, PublicMutable<bool, Context>, Context>,
        approved_actions: Map<Field, PublicMutable<bool, Context>, Context>,
        signer_status: Map<AztecAddress, PublicMutable<bool, Context>, Context>,
        signers: Map<AztecAddress, PrivateSet<ValueNote, Context>, Context>,
        signer_pubkeys_x: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_pubkeys_y: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
    }

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
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

        PrivateMultisig::at(context.this_address())
            .initialize_public_state(initial_threshold, 1)
            .enqueue(&mut context);
        
        PrivateMultisig::at(context.this_address())
            ._initialize_signer_status(initial_signer)
            .enqueue(&mut context);
    }

    #[public]
    fn initialize_public_state(threshold: Field, count: Field) {
        assert(storage.threshold.read() == 0, "Already initialized");
        assert(threshold as u32 > 0, "Threshold must be > 0");
        assert(count as u32 > 0, "Count must be > 0");
        
        storage.threshold.write(threshold);
        storage.signer_count.write(count);
    }

    #[public]
    fn _initialize_signer_status(signer: AztecAddress) {
        storage.signer_status.at(signer).write(true);
    }

    #[private]
    fn entrypoint(app: AppPayload, fee: FeePayload, cancellable: bool) {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.entrypoint(app, fee, cancellable);
    }

    #[private]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        PrivateMultisig::at(context.this_address())._check_action_approved(inner_hash).enqueue(
            &mut context,
        );
        IS_VALID_SELECTOR
    }

    #[internal]
    #[public]
    fn _check_action_approved(action_hash: Field) {
        assert(storage.approved_actions.at(action_hash).read(), "Action not approved");
    }

    #[private]
    fn get_signer_note(signer: AztecAddress) -> Field {
        let mut opts = NoteGetterOptions::new();
        let notes = storage.signers.at(signer).get_notes(opts.set_limit(1));
        if notes.len() > 0 {
            notes.get(0).note.value()
        } else {
            0
        }
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
        let retrieved_note = signer_notes.get(0);
        assert(retrieved_note.note.value() == 1, "Caller is not an active signer");

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

        PrivateMultisig::at(context.this_address())._record_approval(message_hash, caller).enqueue(
            &mut context,
        );

        message_hash
    }

    #[private]
    fn execute_add_signer(
        message_hash: Field,
        new_signer: AztecAddress,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
    ) {
        let mut opts = NoteGetterOptions::new();
        assert(
            storage.signers.at(new_signer).get_notes(opts.set_limit(1)).len() == 0,
            "Signer already exists",
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

        PrivateMultisig::at(context.this_address())._execute_add_signer(message_hash).enqueue(
            &mut context,
        );
        
        PrivateMultisig::at(context.this_address())._set_signer_status(new_signer, true).enqueue(
            &mut context,
        );
    }

    #[internal]
    #[public]
    fn _execute_add_signer(message_hash: Field) {
        let approval_count = storage.message_approval_count.at(message_hash).read();
        let threshold = storage.threshold.read();
        assert(approval_count as u32 >= threshold as u32, "Insufficient approvals");

        let count = storage.signer_count.read();
        storage.signer_count.write(count + 1);
        storage.executed_intents.at(message_hash).write(true);
    }

    #[internal]
    #[public]
    fn _set_signer_status(signer: AztecAddress, status: bool) {
        storage.signer_status.at(signer).write(status);
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

        PrivateMultisig::at(context.this_address())._record_approval(message_hash, caller).enqueue(
            &mut context,
        );

        message_hash
    }

    #[private]
    fn execute_remove_signer(message_hash: Field, target_signer: AztecAddress) {
        let mut opts = NoteGetterOptions::new();
        let _old = storage.signers.at(target_signer).pop_notes(opts.set_limit(1));
        storage.signers.at(target_signer).insert(ValueNote::new(0, target_signer)).discard();

        PrivateMultisig::at(context.this_address())._execute_remove_signer(message_hash).enqueue(
            &mut context,
        );
        
        PrivateMultisig::at(context.this_address())._set_signer_status(target_signer, false).enqueue(
            &mut context,
        );
    }

    #[internal]
    #[public]
    fn _execute_remove_signer(message_hash: Field) {
        let approval_count = storage.message_approval_count.at(message_hash).read();
        let threshold = storage.threshold.read();
        assert(approval_count as u32 >= threshold as u32, "Insufficient approvals");
        
        let count = storage.signer_count.read();
        assert(count as u32 > threshold as u32, "Would break threshold requirement");
        storage.signer_count.write(count - 1);
        storage.executed_intents.at(message_hash).write(true);
    }

    #[private]
    fn update_threshold(
        new_threshold: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        assert((new_threshold as u32 > 0), "Threshold must be > 0");

        let caller = context.msg_sender();
        let message_hash = poseidon2_hash([
            3 as Field,
            new_threshold,
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

        PrivateMultisig::at(context.this_address())._record_approval(message_hash, caller).enqueue(
            &mut context,
        );

        message_hash
    }

    #[private]
    fn execute_threshold_update(message_hash: Field, new_threshold: Field) {
        PrivateMultisig::at(context.this_address())._execute_threshold_update(message_hash, new_threshold).enqueue(
            &mut context,
        );
    }

    #[internal]
    #[public]
    fn _execute_threshold_update(message_hash: Field, new_threshold: Field) {
        let approval_count = storage.message_approval_count.at(message_hash).read();
        let threshold = storage.threshold.read();
        assert(approval_count as u32 >= threshold as u32, "Insufficient approvals");

        let signer_count = storage.signer_count.read();
        assert(new_threshold as u32 <= signer_count as u32, "Threshold exceeds signer count");

        storage.threshold.write(new_threshold);
        storage.executed_intents.at(message_hash).write(true);
    }

    #[private]
    fn approve_action(
        action_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        let caller = context.msg_sender();
        let message_hash = poseidon2_hash([
            4 as Field,
            action_hash,
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

        PrivateMultisig::at(context.this_address())._record_approval(message_hash, caller).enqueue(
            &mut context,
        );

        message_hash
    }

    #[private]
    fn execute_action_approval(message_hash: Field, action_hash: Field) {
        PrivateMultisig::at(context.this_address())._execute_action_approval(message_hash, action_hash).enqueue(
            &mut context,
        );
    }

    #[internal]
    #[public]
    fn _execute_action_approval(message_hash: Field, action_hash: Field) {
        let approval_count = storage.message_approval_count.at(message_hash).read();
        let threshold = storage.threshold.read();
        assert(approval_count as u32 >= threshold as u32, "Insufficient approvals");

        storage.approved_actions.at(action_hash).write(true);
        storage.executed_intents.at(message_hash).write(true);
    }

    #[internal]
    #[public]
    fn _record_approval(message_hash: Field, signer: AztecAddress) {
        assert(!storage.signer_has_approved.at(message_hash).at(signer).read(), "Already approved");
        assert(storage.signer_status.at(signer).read(), "Not an active signer");
        assert(!storage.executed_intents.at(message_hash).read(), "Already executed");

        storage.signer_has_approved.at(message_hash).at(signer).write(true);
        let count = storage.message_approval_count.at(message_hash).read();
        storage.message_approval_count.at(message_hash).write(count + 1);
    }

    #[public]
    fn get_threshold() -> Field {
        storage.threshold.read()
    }

    #[public]
    fn get_signer_count() -> Field {
        storage.signer_count.read()
    }

    #[public]
    fn is_signer_active(signer: AztecAddress) -> bool {
        storage.signer_status.at(signer).read()
    }

    #[public]
    fn get_approval_count(message_hash: Field) -> Field {
        storage.message_approval_count.at(message_hash).read()
    }

    #[public]
    fn has_signer_approved(message_hash: Field, signer: AztecAddress) -> bool {
        storage.signer_has_approved.at(message_hash).at(signer).read()
    }

    #[public]
    fn is_intent_executed(message_hash: Field) -> bool {
        storage.executed_intents.at(message_hash).read()
    }

    #[public]
    fn is_action_approved(action_hash: Field) -> bool {
        storage.approved_actions.at(action_hash).read()
    }
}