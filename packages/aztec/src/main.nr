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
    use dep::address_note::address_note::AddressNote;
    use dep::wormhole::Wormhole;

    global IS_VALID_SELECTOR: Field = 0xabf64ad4;

    #[storage]
    struct Storage<Context> {
        message_approvals: Map<Field, PrivateSet<AddressNote, Context>, Context>,
        signers: Map<AztecAddress, PrivateSet<ValueNote, Context>, Context>,
        signer_pubkeys_x: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_pubkeys_y: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        threshold: PrivateMutable<ValueNote, Context>,
        signer_count: PrivateMutable<ValueNote, Context>,
        executed_intents: Map<Field, PrivateSet<ValueNote, Context>, Context>,
        approved_actions: Map<Field, PublicMutable<bool, Context>, Context>,
        wormhole_contract: PrivateMutable<AddressNote, Context>,
        cross_chain_nonce: PublicMutable<u64, Context>,
    }

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Safety: get_auth_witness is required to retrieve signature from oracle
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

    #[contract_library_method]
    fn is_signer_active(address: AztecAddress, storage: Storage<&mut PrivateContext>) -> bool {
        let notes = storage.signers.at(address).get_notes(NoteGetterOptions::new().set_limit(1));
        
        if notes.len() == 0 {
            false
        } else {
            notes.get_unchecked(0).note.value() == 1
        }
    }

    #[contract_library_method]
    fn count_approvals(
        message_hash: Field,
        storage: Storage<&mut PrivateContext>,
    ) -> u32 {
        let approvals = storage.message_approvals.at(message_hash).get_notes(NoteGetterOptions::new());
        approvals.len()
    }

    #[contract_library_method]
    fn is_already_approved(
        message_hash: Field,
        signer: AztecAddress,
        storage: Storage<&mut PrivateContext>,
    ) -> bool {
        let approvals = storage.message_approvals.at(message_hash).get_notes(NoteGetterOptions::new());
        
        let mut found = false;
        let len = approvals.len();
        for i in 0..10 {
            if i < len {
                if approvals.get_unchecked(i).note.get_address() == signer {
                    found = true;
                }
            }
        }
        found
    }

    #[private]
    fn constructor(
        initial_signer: AztecAddress,
        initial_signer_pk_x: Field,
        initial_signer_pk_y: Field,
        initial_threshold: Field,
        wormhole_address: AztecAddress,
    ) {
        assert(initial_threshold as u32 > 0, "Threshold must be greater than 0");
        assert(!initial_signer.is_zero(), "Initial signer cannot be zero address");
        assert(!wormhole_address.is_zero(), "Wormhole address cannot be zero");

        let signer_note = ValueNote::new(1, initial_signer);
        storage.signers.at(initial_signer).insert(signer_note).discard();
        
        let pk_x_note = ValueNote::new(initial_signer_pk_x, initial_signer);
        storage.signer_pubkeys_x.at(initial_signer).initialize(pk_x_note).discard();
        
        let pk_y_note = ValueNote::new(initial_signer_pk_y, initial_signer);
        storage.signer_pubkeys_y.at(initial_signer).initialize(pk_y_note).discard();

        let threshold_note = ValueNote::new(initial_threshold, initial_signer);
        storage.threshold.initialize(threshold_note).discard();

        let count_note = ValueNote::new(1, initial_signer);
        storage.signer_count.initialize(count_note).discard();

        let wormhole_note = AddressNote::new(wormhole_address, initial_signer);
        storage.wormhole_contract.initialize(wormhole_note).discard();

        PrivateMultisig::at(context.this_address())
            .initialize_cross_chain_nonce()
            .enqueue(&mut context);
    }

    #[public]
    #[internal]
    fn initialize_cross_chain_nonce() {
        storage.cross_chain_nonce.write(0);
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
        assert(is_signer_active(caller, storage), "Not a signer");

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

        if !is_already_approved(message_hash, caller, storage) {
            let approval = AddressNote::new(caller, caller);
            storage.message_approvals.at(message_hash).insert(approval).discard();
        }

        message_hash
    }

    #[private]
    fn execute_add_signer(
        message_hash: Field,
        new_signer: AztecAddress,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
    ) {
        let approval_count = count_approvals(message_hash, storage);
        
        let threshold_note = storage.threshold.get_note();
        let threshold_value = threshold_note.note.value();
        assert(approval_count >= threshold_value as u32, "Insufficient approvals");

        assert(
            storage.signers.at(new_signer).get_notes(NoteGetterOptions::new().set_limit(1)).len() == 0,
            "Signer already exists",
        );

        let signer_note = ValueNote::new(1, new_signer);
        storage.signers.at(new_signer).insert(signer_note).discard();
        
        let pk_x_note = ValueNote::new(new_signer_pk_x, new_signer);
        storage.signer_pubkeys_x.at(new_signer).initialize(pk_x_note).discard();
        
        let pk_y_note = ValueNote::new(new_signer_pk_y, new_signer);
        storage.signer_pubkeys_y.at(new_signer).initialize(pk_y_note).discard();

        let old_count_note = storage.signer_count.get_note();
        let old_count_value = old_count_note.note.value();
        let new_count_value = old_count_value + 1;
        
        storage.signer_count.replace(ValueNote::new(new_count_value, context.msg_sender())).discard();

        let executed = ValueNote::new(1, context.msg_sender());
        storage.executed_intents.at(message_hash).insert(executed).discard();
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
        assert(is_signer_active(caller, storage), "Not a signer");

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

        if !is_already_approved(message_hash, caller, storage) {
            let approval = AddressNote::new(caller, caller);
            storage.message_approvals.at(message_hash).insert(approval).discard();
        }

        message_hash
    }

    #[private]
    fn execute_remove_signer(message_hash: Field, target_signer: AztecAddress) {
        let approval_count = count_approvals(message_hash, storage);
        
        let threshold_note = storage.threshold.get_note();
        let threshold_value = threshold_note.note.value();
        assert(approval_count >= threshold_value as u32, "Insufficient approvals");

        let _old = storage.signers.at(target_signer).pop_notes(NoteGetterOptions::new().set_limit(1));
        
        let inactive_note = ValueNote::new(0, target_signer);
        storage.signers.at(target_signer).insert(inactive_note).discard();

        let old_count_note = storage.signer_count.get_note();
        let old_count_value = old_count_note.note.value();
        let new_count_value = old_count_value - 1;
        
        assert(new_count_value as u32 >= threshold_value as u32, "Would break threshold");
        
        storage.signer_count.replace(ValueNote::new(new_count_value, context.msg_sender())).discard();
        storage.signer_count.initialize(ValueNote::new(new_count_value, context.msg_sender())).discard();

        let executed = ValueNote::new(1, context.msg_sender());
        storage.executed_intents.at(message_hash).insert(executed).discard();
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
        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

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

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        if !is_already_approved(message_hash, caller, storage) {
            let approval = AddressNote::new(caller, caller);
            storage.message_approvals.at(message_hash).insert(approval).discard();
        }

        message_hash
    }

    #[private]
    fn execute_change_threshold(message_hash: Field, new_threshold: Field) {
        let approval_count = count_approvals(message_hash, storage);
        
        let old_threshold_note = storage.threshold.get_note();
        let old_threshold_value = old_threshold_note.note.value();
        assert(approval_count >= old_threshold_value as u32, "Insufficient approvals");

        let count_note = storage.signer_count.get_note();
        let count_value = count_note.note.value();
        assert(new_threshold as u32 <= count_value as u32, "Threshold exceeds signers");
        assert(new_threshold as u32 > 0, "Threshold must be > 0");

        storage.threshold.replace(ValueNote::new(new_threshold, context.msg_sender())).discard();

        let executed = ValueNote::new(1, context.msg_sender());
        storage.executed_intents.at(message_hash).insert(executed).discard();
    }

    #[private]
    fn propose_transaction(
        to: AztecAddress,
        amount: Field,
        function_selector: Field,
        data_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        assert(!to.is_zero(), "Invalid destination address");

        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

        let message_hash = poseidon2_hash([
            5 as Field,
            to.to_field(),
            amount,
            function_selector,
            data_hash,
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        if !is_already_approved(message_hash, caller, storage) {
            let approval = AddressNote::new(caller, caller);
            storage.message_approvals.at(message_hash).insert(approval).discard();
        }

        message_hash
    }

    #[private]
    fn approve_transaction(
        message_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
    ) -> bool {
        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

        assert(
            !is_already_approved(message_hash, caller, storage),
            "Already approved",
        );

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        let approval = AddressNote::new(caller, caller);
        storage.message_approvals.at(message_hash).insert(approval).discard();

        let approval_count = count_approvals(message_hash, storage);
        
        let threshold_note = storage.threshold.get_note();
        let threshold_value = threshold_note.note.value();
        let threshold_reached = approval_count >= threshold_value as u32;
        
        if threshold_reached {
            let executed = ValueNote::new(1, context.msg_sender());
            storage.executed_intents.at(message_hash).insert(executed).discard();
        }

        threshold_reached
    }

    #[private]
    fn propose_action(
        target_contract: AztecAddress,
        action_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

        let message_hash = poseidon2_hash([
            4 as Field,
            target_contract.to_field(),
            action_hash,
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        if !is_already_approved(message_hash, caller, storage) {
            let approval = AddressNote::new(caller, caller);
            storage.message_approvals.at(message_hash).insert(approval).discard();
        }

        message_hash
    }

    #[private]
    fn approve_action(
        message_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
    ) {
        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

        assert(
            !is_already_approved(message_hash, caller, storage),
            "Already approved",
        );

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        let approval = AddressNote::new(caller, caller);
        storage.message_approvals.at(message_hash).insert(approval).discard();
    }

    #[private]
    fn finalize_action(message_hash: Field, action_hash: Field) {
        let approval_count = count_approvals(message_hash, storage);
        
        let threshold_note = storage.threshold.get_note();
        let threshold_value = threshold_note.note.value();
        assert(approval_count >= threshold_value as u32, "Insufficient approvals");

        PrivateMultisig::at(context.this_address())
            ._set_action_approved(action_hash)
            .enqueue(&mut context);

        let executed = ValueNote::new(1, context.msg_sender());
        storage.executed_intents.at(message_hash).insert(executed).discard();
    }

    #[internal]
    #[public]
    fn _set_action_approved(action_hash: Field) {
        storage.approved_actions.at(action_hash).write(true);
    }

    #[private]
    fn propose_cross_chain_intent(
        target_chain: Field,
        target_contract: AztecAddress,
        intent_type: Field,
        amount: Field,
        recipient: AztecAddress,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        assert(!target_contract.is_zero(), "Invalid target contract");
        assert(!recipient.is_zero(), "Invalid recipient");

        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

        let message_hash = poseidon2_hash([
            6 as Field,
            target_chain,
            target_contract.to_field(),
            intent_type,
            amount,
            recipient.to_field(),
            signer_nonce as Field,
            deadline as Field,
        ]);

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        if !is_already_approved(message_hash, caller, storage) {
            let approval = AddressNote::new(caller, caller);
            storage.message_approvals.at(message_hash).insert(approval).discard();
        }

        message_hash
    }

    #[private]
    fn approve_cross_chain_intent(
        message_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
    ) {
        let caller = context.msg_sender();
        assert(is_signer_active(caller, storage), "Not a signer");

        assert(
            !is_already_approved(message_hash, caller, storage),
            "Already approved",
        );

        assert(
            verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y),
            "Invalid signature",
        );

        let nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(nullifier);

        let approval = AddressNote::new(caller, caller);
        storage.message_approvals.at(message_hash).insert(approval).discard();
    }

    #[private]
    fn execute_cross_chain_intent(
        message_hash: Field,
        target_chain: Field,
        target_contract: AztecAddress,
        intent_type: Field,
        amount: Field,
        recipient: AztecAddress,
    ) {
        let approval_count = count_approvals(message_hash, storage);
        
        let threshold_note = storage.threshold.get_note();
        let threshold_value = threshold_note.note.value();
        assert(approval_count >= threshold_value as u32, "Insufficient approvals");

        let executed = storage.executed_intents.at(message_hash).get_notes(NoteGetterOptions::new());
        assert(executed.len() == 0, "Already executed");

        let wormhole_note = storage.wormhole_contract.get_note();
        let wormhole_addr = wormhole_note.note.get_address();
        assert(!wormhole_addr.is_zero(), "Wormhole not configured");

        let mut payload: [[u8; 31]; 8] = [[0; 31]; 8];
        
        let message_hash_bytes = message_hash.to_be_bytes::<32>();
        for i in 0..31 {
            payload[0][i] = message_hash_bytes[i + 1];
        }
        
        let target_chain_bytes = target_chain.to_be_bytes::<32>();
        for i in 0..31 {
            payload[1][i] = target_chain_bytes[i + 1];
        }
        
        let target_contract_bytes = target_contract.to_field().to_be_bytes::<32>();
        for i in 0..31 {
            payload[2][i] = target_contract_bytes[i + 1];
        }
        
        let intent_type_bytes = intent_type.to_be_bytes::<32>();
        for i in 0..31 {
            payload[3][i] = intent_type_bytes[i + 1];
        }
        
        let amount_bytes = amount.to_be_bytes::<32>();
        for i in 0..31 {
            payload[4][i] = amount_bytes[i + 1];
        }
        
        let recipient_bytes = recipient.to_field().to_be_bytes::<32>();
        for i in 0..31 {
            payload[5][i] = recipient_bytes[i + 1];
        }

        let nonce = 0;

        Wormhole::at(wormhole_addr)
            .publish_message_in_private(
                nonce,
                payload,
                0,
                1,
                context.msg_sender(),
                0
            )
            .call(&mut context);

        PrivateMultisig::at(context.this_address())
            ._increment_cross_chain_nonce()
            .enqueue(&mut context);

        let executed_note = ValueNote::new(1, context.msg_sender());
        storage.executed_intents.at(message_hash).insert(executed_note).discard();
    }

    #[internal]
    #[public]
    fn _increment_cross_chain_nonce() {
        let nonce = storage.cross_chain_nonce.read();
        storage.cross_chain_nonce.write(nonce + 1);
    }

    #[public]
    fn get_cross_chain_nonce() -> pub u64 {
        storage.cross_chain_nonce.read()
    }

    #[public]
    fn is_action_approved(action_hash: Field) -> pub bool {
        storage.approved_actions.at(action_hash).read()
    }

    #[private]
    fn is_signer(address: AztecAddress) -> bool {
        is_signer_active(address, storage)
    }

    #[private]
    fn get_threshold() -> Field {
        let note = storage.threshold.get_note();
        note.note.value()
    }

    #[private]
    fn get_signer_count() -> Field {
        let note = storage.signer_count.get_note();
        note.note.value()
    }

    #[private]
    fn get_approval_count(message_hash: Field) -> u32 {
        count_approvals(message_hash, storage)
    }

    #[private]
    fn is_executed(message_hash: Field) -> bool {
        let executed = storage.executed_intents.at(message_hash).get_notes(NoteGetterOptions::new());
        executed.len() > 0
    }

    #[private]
    fn get_signer_pubkey(signer: AztecAddress) -> (Field, Field) {
        let pk_x_note = storage.signer_pubkeys_x.at(signer).get_note();
        let pk_x = pk_x_note.note.value();
        
        let pk_y_note = storage.signer_pubkeys_y.at(signer).get_note();
        let pk_y = pk_y_note.note.value();
        
        (pk_x, pk_y)
    }
}