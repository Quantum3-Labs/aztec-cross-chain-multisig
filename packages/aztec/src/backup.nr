use dep::aztec::macros::aztec;

#[aztec]
pub contract PrivateMultisig {
    use dep::aztec::{
        authwit::{account::AccountActions, entrypoint::{app::AppPayload, fee::FeePayload}},
        context::PrivateContext,
        macros::{
            functions::{private},
            storage::storage,
        },
        oracle::auth_witness::get_auth_witness,
        protocol_types::{
            address::AztecAddress,
            hash::poseidon2_hash,
            traits::ToField,
        },
        state_vars::{Map, PrivateMutable, PrivateSet},
        note::note_getter_options::NoteGetterOptions,
    };
    use dep::value_note::value_note::ValueNote;

    global MAX_SIGNERS: u32 = 20;

    struct TransactionIntent {
        to: AztecAddress,
        amount: u128,
        function_selector: Field,
        data_hash: Field,
        nonce: u32,
        deadline: u64,
    }

    impl TransactionIntent {
        fn hash(self) -> Field {
            poseidon2_hash([
                self.to.to_field(),
                self.amount as Field,
                self.function_selector,
                self.data_hash,
                self.nonce as Field,
                self.deadline as Field,
            ])
        }
    }

    struct ManagementIntent {
        operation_type: Field,
        target_address: AztecAddress,
        pubkey_x: Field,
        pubkey_y: Field,
        new_threshold: Field,
        nonce: u32,
        deadline: u64,
    }

    impl ManagementIntent {
        fn hash(self) -> Field {
            poseidon2_hash([
                self.operation_type,
                self.target_address.to_field(),
                self.pubkey_x,
                self.pubkey_y,
                self.new_threshold,
                self.nonce as Field,
                self.deadline as Field,
            ])
        }
    }

    #[storage]
    struct Storage<Context> {
        message_approvals: Map<Field, Map<AztecAddress, PrivateSet<ValueNote, Context>, Context>, Context>,
        signers: Map<AztecAddress, PrivateSet<ValueNote, Context>, Context>,
        threshold: PrivateMutable<ValueNote, Context>,
        signer_pubkeys_x: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_pubkeys_y: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_count: PrivateMutable<ValueNote, Context>,
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

        let has_sufficient_non_zero = non_zero_bytes >= 32;
        let message_not_zero = message_hash != 0;

        signature_valid & has_sufficient_non_zero & message_not_zero
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

        let threshold_note = ValueNote::new(initial_threshold, deployer);
        storage.threshold.initialize(threshold_note).discard();

        let signer_note = ValueNote::new(1, initial_signer);
        storage.signers.at(initial_signer).insert(signer_note).discard();

        let pk_x_note = ValueNote::new(initial_signer_pk_x, initial_signer);
        storage.signer_pubkeys_x.at(initial_signer).initialize(pk_x_note).discard();

        let pk_y_note = ValueNote::new(initial_signer_pk_y, initial_signer);
        storage.signer_pubkeys_y.at(initial_signer).initialize(pk_y_note).discard();

        let count_note = ValueNote::new(1, deployer);
        storage.signer_count.initialize(count_note).discard();
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
        assert(deadline > 0, "Invalid deadline");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();

        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(caller).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Caller is not a signer");
        let signer_note = signer_notes.get(0);
        assert(signer_note.note.value() == 1, "Caller is not an active signer");

        let management_intent = ManagementIntent {
            operation_type: 1,
            target_address: new_signer,
            pubkey_x: new_signer_pk_x,
            pubkey_y: new_signer_pk_y,
            new_threshold: 0,
            nonce: signer_nonce,
            deadline,
        };

        let message_hash = management_intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(proposal_nullifier);

        let approval_note = ValueNote::new(1, caller);
        storage.message_approvals.at(message_hash).at(caller).insert(approval_note).discard();

        message_hash
    }

    #[private]
    fn execute_add_signer(
        message_hash: Field,
        new_signer: AztecAddress,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
        approved_signers: [AztecAddress; 20],
        num_approved: u32,
    ) {
        assert(num_approved <= MAX_SIGNERS, "Too many signers");
        
        let mut approval_count = 0;
        for i in 0..20 {
            if i < num_approved {
                let mut options = NoteGetterOptions::new();
                let approvals = storage.message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(options.set_limit(1));
                
                if approvals.len() > 0 {
                    let approval_note = approvals.get(0);
                    if approval_note.note.value() == 1 {
                        approval_count += 1;
                    }
                }
            }
        }
        
        let threshold_note = storage.threshold.get_note();
        assert(
            approval_count >= threshold_note.note.value() as u32,
            "Insufficient approvals to execute"
        );

        let mut options = NoteGetterOptions::new();
        let existing = storage.signers.at(new_signer).get_notes(options.set_limit(1));
        assert(existing.len() == 0, "Signer already exists");

        let signer_note = ValueNote::new(1, new_signer);
        storage.signers.at(new_signer).insert(signer_note).discard();

        let pk_x_note = ValueNote::new(new_signer_pk_x, new_signer);
        storage.signer_pubkeys_x.at(new_signer).initialize(pk_x_note).discard();

        let pk_y_note = ValueNote::new(new_signer_pk_y, new_signer);
        storage.signer_pubkeys_y.at(new_signer).initialize(pk_y_note).discard();

        let deployer = context.msg_sender();
        let count_note = storage.signer_count.get_note();
        let new_count = count_note.note.value() + 1;
        let new_count_note = ValueNote::new(new_count, deployer);
        storage.signer_count.replace(new_count_note).discard();
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
        assert(!target_signer.is_zero(), "Cannot remove zero address");
        assert(deadline > 0, "Invalid deadline");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();
        assert(caller != target_signer, "Cannot remove yourself");

        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(caller).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Caller is not a signer");
        let signer_note = signer_notes.get(0);
        assert(signer_note.note.value() == 1, "Caller is not an active signer");

        let management_intent = ManagementIntent {
            operation_type: 2,
            target_address: target_signer,
            pubkey_x: 0,
            pubkey_y: 0,
            new_threshold: 0,
            nonce: signer_nonce,
            deadline,
        };

        let message_hash = management_intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(proposal_nullifier);

        let approval_note = ValueNote::new(1, caller);
        storage.message_approvals.at(message_hash).at(caller).insert(approval_note).discard();

        message_hash
    }

    #[private]
    fn execute_remove_signer(
        message_hash: Field,
        target_signer: AztecAddress,
        approved_signers: [AztecAddress; 20],
        num_approved: u32,
    ) {
        assert(num_approved <= MAX_SIGNERS, "Too many signers");
        
        let mut approval_count = 0;
        for i in 0..20 {
            if i < num_approved {
                let mut options = NoteGetterOptions::new();
                let approvals = storage.message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(options.set_limit(1));
                
                if approvals.len() > 0 {
                    let approval_note = approvals.get(0);
                    if approval_note.note.value() == 1 {
                        approval_count += 1;
                    }
                }
            }
        }
        
        let threshold_note = storage.threshold.get_note();
        assert(
            approval_count >= threshold_note.note.value() as u32,
            "Insufficient approvals to execute"
        );

        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(target_signer).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Target is not a signer");
        let signer_note = signer_notes.get(0);
        assert(signer_note.note.value() == 1, "Target is not an active signer");

        let count_note = storage.signer_count.get_note();
        let new_count = count_note.note.value() - 1;
        let threshold_value = threshold_note.note.value();
        assert(new_count as u32 >= threshold_value as u32, "Cannot remove signer: would break threshold");

        let mut options = NoteGetterOptions::new();
        let _old_notes = storage.signers.at(target_signer).pop_notes(options.set_limit(1));
        
        let removed_note = ValueNote::new(0, target_signer);
        storage.signers.at(target_signer).insert(removed_note).discard();

        let deployer = context.msg_sender();
        let new_count_note = ValueNote::new(new_count, deployer);
        storage.signer_count.replace(new_count_note).discard();
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
        assert(new_threshold as u32 > 0, "Threshold must be greater than 0");
        assert(deadline > 0, "Invalid deadline");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();

        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(caller).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Caller is not a signer");
        let signer_note = signer_notes.get(0);
        assert(signer_note.note.value() == 1, "Caller is not an active signer");

        let management_intent = ManagementIntent {
            operation_type: 3,
            target_address: AztecAddress::zero(),
            pubkey_x: 0,
            pubkey_y: 0,
            new_threshold,
            nonce: signer_nonce,
            deadline,
        };

        let message_hash = management_intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(proposal_nullifier);

        let approval_note = ValueNote::new(1, caller);
        storage.message_approvals.at(message_hash).at(caller).insert(approval_note).discard();

        message_hash
    }

    #[private]
    fn execute_change_threshold(
        message_hash: Field,
        new_threshold: Field,
        approved_signers: [AztecAddress; 20],
        num_approved: u32,
    ) {
        assert(num_approved <= MAX_SIGNERS, "Too many signers");
        
        let mut approval_count = 0;
        for i in 0..20 {
            if i < num_approved {
                let mut options = NoteGetterOptions::new();
                let approvals = storage.message_approvals
                    .at(message_hash)
                    .at(approved_signers[i])
                    .get_notes(options.set_limit(1));
                
                if approvals.len() > 0 {
                    let approval_note = approvals.get(0);
                    if approval_note.note.value() == 1 {
                        approval_count += 1;
                    }
                }
            }
        }
        
        let old_threshold_note = storage.threshold.get_note();
        assert(
            approval_count >= old_threshold_note.note.value() as u32,
            "Insufficient approvals to execute"
        );

        let count_note = storage.signer_count.get_note();
        let count_value = count_note.note.value();
        assert(
            new_threshold as u32 <= count_value as u32,
            "Threshold cannot exceed number of signers"
        );
        assert(new_threshold as u32 > 0, "Threshold must be greater than 0");

        let deployer = context.msg_sender();
        let new_threshold_note = ValueNote::new(new_threshold, deployer);
        storage.threshold.replace(new_threshold_note).discard();
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
        assert(!to.is_zero(), "Invalid destination address");
        assert(deadline > 0, "Invalid deadline");
        assert(amount > 0, "Amount must be greater than 0");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();

        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(caller).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Caller is not a signer");
        let signer_note = signer_notes.get(0);
        assert(signer_note.note.value() == 1, "Caller is not an active signer");

        let intent = TransactionIntent {
            to,
            amount,
            function_selector,
            data_hash,
            nonce: signer_nonce,
            deadline,
        };

        let message_hash = intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(proposal_nullifier);

        let approval_note = ValueNote::new(1, caller);
        storage.message_approvals.at(message_hash).at(caller).insert(approval_note).discard();

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
        assert(message_hash != 0, "Invalid message hash");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();

        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(caller).get_notes(signer_options.set_limit(1));
        assert(signer_notes.len() > 0, "Caller is not a signer");
        let signer_note = signer_notes.get(0);
        assert(signer_note.note.value() == 1, "Caller is not an active signer");

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let mut approval_options = NoteGetterOptions::new();
        let existing_approvals = storage.message_approvals.at(message_hash).at(caller).get_notes(approval_options.set_limit(1));
        assert(existing_approvals.len() == 0, "Already approved by this signer");

        let approval_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field]);
        context.push_nullifier(approval_nullifier);

        let approval_note = ValueNote::new(1, caller);
        storage.message_approvals.at(message_hash).at(caller).insert(approval_note).discard();
    }

    #[private]
    fn get_threshold() -> Field {
        let threshold_note = storage.threshold.get_note();
        threshold_note.note.value()
    }

    #[private]
    fn get_signer_count() -> Field {
        let count_note = storage.signer_count.get_note();
        count_note.note.value()
    }

    #[private]
    fn is_signer(address: AztecAddress) -> bool {
        let mut signer_options = NoteGetterOptions::new();
        let signer_notes = storage.signers.at(address).get_notes(signer_options.set_limit(1));
        
        if signer_notes.len() == 0 {
            false
        } else {
            let signer_note = signer_notes.get(0);
            signer_note.note.value() == 1
        }
    }
}