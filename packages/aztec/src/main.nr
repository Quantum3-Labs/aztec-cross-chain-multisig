use dep::aztec::macros::aztec;

#[aztec]
pub contract PrivateMultisigContract {
    use dep::aztec::{
        authwit::{account::AccountActions, entrypoint::{app::AppPayload, fee::FeePayload}},
        context::PrivateContext,
        macros::{
            functions::{initializer, internal, noinitcheck, private, public},
            storage::storage,
        },
        oracle::auth_witness::get_auth_witness,
        protocol_types::{
            abis::function_selector::FunctionSelector,
            address::AztecAddress,
            hash::poseidon2_hash,
            traits::{FromField, Hash, ToField},
        },
        state_vars::{Map, PublicMutable},
    };

    // Transaction intent structure (only map intent, no execution on Aztec)
    struct TransactionIntent {
        to: AztecAddress,
        amount: u128,
        function_selector: Field,
        data_hash: Field,
        nonce: u32,
        deadline: u64,
    }

    impl Hash for TransactionIntent {
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

    // Management operation types
    struct ManagementIntent {
        operation_type: Field, // 1=add_signer, 2=remove_signer, 3=change_threshold
        target_address: AztecAddress,
        pubkey_x: Field,
        pubkey_y: Field,
        new_threshold: Field,
        nonce: u32,
        deadline: u64,
    }

    impl Hash for ManagementIntent {
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
        message_approval_counts: Map<Field, PublicMutable<Field, Context>, Context>,
        authorized_signers: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        threshold: PublicMutable<Field, Context>,
        signer_count: PublicMutable<Field, Context>,
        transaction_nonce: PublicMutable<Field, Context>,
        executed_messages: Map<Field, PublicMutable<Field, Context>, Context>,
        signer_pubkeys_x: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        signer_pubkeys_y: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        signer_nonces: Map<AztecAddress, PublicMutable<Field, Context>, Context>,
        message_signer_approvals: Map<Field, Map<AztecAddress, PublicMutable<Field, Context>, Context>, Context>,
        management_approval_counts: Map<Field, PublicMutable<Field, Context>, Context>,
        management_signer_approvals: Map<Field, Map<AztecAddress, PublicMutable<Field, Context>, Context>, Context>,
        executed_management_operations: Map<Field, PublicMutable<Field, Context>, Context>,
        temp_execution_result: PublicMutable<Field, Context>,
    }

    #[initializer]
    #[public]
    fn constructor(
        initial_signer: AztecAddress,
        initial_signer_pk_x: Field,
        initial_signer_pk_y: Field,
        initial_threshold: u8,
    ) {
        assert(initial_threshold > 0, "Threshold must be greater than 0");
        assert(!initial_signer.is_zero(), "Initial signer cannot be zero address");

        storage.threshold.write(initial_threshold as Field);
        storage.signer_count.write(1);
        storage.transaction_nonce.write(0);

        storage.authorized_signers.at(initial_signer).write(1);
        storage.signer_pubkeys_x.at(initial_signer).write(initial_signer_pk_x);
        storage.signer_pubkeys_y.at(initial_signer).write(initial_signer_pk_y);
        storage.signer_nonces.at(initial_signer).write(0);
    }

    // ========== ACCOUNT INTERFACE ==========

    #[private]
    #[noinitcheck]
    fn entrypoint(app: AppPayload, fee: FeePayload, cancellable: bool) {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.entrypoint(app, fee, cancellable);
    }

    #[private]
    #[noinitcheck]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    #[contract_library_method]
    fn is_valid_impl(_context: &mut PrivateContext, outer_hash: Field) -> bool {
        // Safety: get_auth_witness is safe to use for signature verification
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };

        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 {
            signature[i] = witness[i] as u8;
        }

        _validate_signature_format(signature, outer_hash)
    }

    // ========== SIGNATURE VERIFICATION ==========

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
        let pub_key = std::embedded_curve_ops::EmbeddedCurvePoint {
            x: pubkey_x,
            y: pubkey_y,
            is_infinite: false,
        };
        schnorr::verify_signature(pub_key, signature, message_hash.to_be_bytes::<32>())
    }

    // ========== 1. ADD SIGNER - PRIVATE ==========

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

        let management_intent = ManagementIntent {
            operation_type: 1, // add_signer
            target_address: new_signer,
            pubkey_x: new_signer_pk_x,
            pubkey_y: new_signer_pk_y,
            new_threshold: 0,
            nonce: signer_nonce + 1000,
            deadline,
        };

        let message_hash = management_intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field, 1]);
        context.push_nullifier(proposal_nullifier);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("add_signer_internal(Field,Field,Field,Field,Field,u32,Field,Field)"),
            [message_hash, caller.to_field(), new_signer.to_field(), new_signer_pk_x, new_signer_pk_y, signer_nonce as Field, signer_pk_x, signer_pk_y],
        );

        message_hash
    }

    #[public]
    #[internal]
    fn add_signer_internal(
        message_hash: Field,
        caller: Field,
        new_signer: Field,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
        signer_nonce: u32,
        expected_pk_x: Field,
        expected_pk_y: Field,
    ) {
        let caller_addr = AztecAddress::from_field(caller);
        let new_signer_addr = AztecAddress::from_field(new_signer);

        assert(storage.authorized_signers.at(caller_addr).read() == 1, "Not authorized signer");
        assert(storage.signer_nonces.at(caller_addr).read() as u32 == signer_nonce, "Invalid nonce");
        assert(storage.authorized_signers.at(new_signer_addr).read() == 0, "Signer already exists");
        assert(storage.executed_management_operations.at(message_hash).read() == 0, "Already executed");

        // Verify the provided public key matches stored public key
        let stored_pk_x = storage.signer_pubkeys_x.at(caller_addr).read();
        let stored_pk_y = storage.signer_pubkeys_y.at(caller_addr).read();
        assert(stored_pk_x == expected_pk_x, "Public key mismatch");
        assert(stored_pk_y == expected_pk_y, "Public key mismatch");

        storage.management_approval_counts.at(message_hash).write(1);
        storage.management_signer_approvals.at(message_hash).at(caller_addr).write(1);

        let current_threshold = storage.threshold.read();
        if (1 as u32) >= (current_threshold as u32) {
            // Execute add signer
            let current_count = storage.signer_count.read();
            storage.signer_count.write(current_count + 1);
            storage.authorized_signers.at(new_signer_addr).write(1);
            storage.signer_pubkeys_x.at(new_signer_addr).write(new_signer_pk_x);
            storage.signer_pubkeys_y.at(new_signer_addr).write(new_signer_pk_y);
            storage.signer_nonces.at(new_signer_addr).write(0);
            storage.executed_management_operations.at(message_hash).write(1);
        }

        storage.signer_nonces.at(caller_addr).write((signer_nonce + 1) as Field);
    }

    // ========== 2. REMOVE SIGNER - PRIVATE ==========

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

        let management_intent = ManagementIntent {
            operation_type: 2, // remove_signer
            target_address: target_signer,
            pubkey_x: 0,
            pubkey_y: 0,
            new_threshold: 0,
            nonce: signer_nonce + 1000,
            deadline,
        };

        let message_hash = management_intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field, 2]);
        context.push_nullifier(proposal_nullifier);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("remove_signer_internal(Field,Field,Field,u32,Field,Field)"),
            [message_hash, caller.to_field(), target_signer.to_field(), signer_nonce as Field, signer_pk_x, signer_pk_y],
        );

        message_hash
    }

    #[public]
    #[internal]
    fn remove_signer_internal(
        message_hash: Field,
        caller: Field,
        target_signer: Field,
        signer_nonce: u32,
        expected_pk_x: Field,
        expected_pk_y: Field,
    ) {
        let caller_addr = AztecAddress::from_field(caller);
        let target_addr = AztecAddress::from_field(target_signer);

        assert(storage.authorized_signers.at(caller_addr).read() == 1, "Not authorized signer");
        assert(storage.signer_nonces.at(caller_addr).read() as u32 == signer_nonce, "Invalid nonce");
        assert(storage.authorized_signers.at(target_addr).read() == 1, "Target is not a signer");
        assert(storage.executed_management_operations.at(message_hash).read() == 0, "Already executed");

        let current_count = storage.signer_count.read();
        assert((current_count as u32) > 1, "Cannot remove last signer");

        // Verify the provided public key matches stored public key
        let stored_pk_x = storage.signer_pubkeys_x.at(caller_addr).read();
        let stored_pk_y = storage.signer_pubkeys_y.at(caller_addr).read();
        assert(stored_pk_x == expected_pk_x, "Public key mismatch");
        assert(stored_pk_y == expected_pk_y, "Public key mismatch");

        storage.management_approval_counts.at(message_hash).write(1);
        storage.management_signer_approvals.at(message_hash).at(caller_addr).write(1);

        let current_threshold = storage.threshold.read();
        if (1 as u32) >= (current_threshold as u32) {
            // Execute remove signer
            storage.signer_count.write(current_count - 1);
            storage.authorized_signers.at(target_addr).write(0);
            storage.signer_pubkeys_x.at(target_addr).write(0);
            storage.signer_pubkeys_y.at(target_addr).write(0);
            storage.signer_nonces.at(target_addr).write(0);
            storage.executed_management_operations.at(message_hash).write(1);

            // Adjust threshold if needed
            let new_count = current_count - 1;
            if (current_threshold as u32) > (new_count as u32) {
                storage.threshold.write(new_count);
            }
        }

        storage.signer_nonces.at(caller_addr).write((signer_nonce + 1) as Field);
    }

    // ========== 3. CHANGE THRESHOLD - PRIVATE ==========

    #[private]
    fn change_threshold(
        new_threshold: u8,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
        deadline: u64,
    ) -> Field {
        assert(new_threshold > 0, "Threshold must be greater than 0");
        assert(deadline > 0, "Invalid deadline");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();

        let management_intent = ManagementIntent {
            operation_type: 3, // change_threshold
            target_address: AztecAddress::zero(),
            pubkey_x: 0,
            pubkey_y: 0,
            new_threshold: new_threshold as Field,
            nonce: signer_nonce + 1000,
            deadline,
        };

        let message_hash = management_intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field, 3]);
        context.push_nullifier(proposal_nullifier);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("change_threshold_internal(Field,Field,u8,u32,Field,Field)"),
            [message_hash, caller.to_field(), new_threshold as Field, signer_nonce as Field, signer_pk_x, signer_pk_y],
        );

        message_hash
    }

    #[public]
    #[internal]
    fn change_threshold_internal(
        message_hash: Field,
        caller: Field,
        new_threshold: u8,
        signer_nonce: u32,
        expected_pk_x: Field,
        expected_pk_y: Field,
    ) {
        let caller_addr = AztecAddress::from_field(caller);

        assert(storage.authorized_signers.at(caller_addr).read() == 1, "Not authorized signer");
        assert(storage.signer_nonces.at(caller_addr).read() as u32 == signer_nonce, "Invalid nonce");
        assert(storage.executed_management_operations.at(message_hash).read() == 0, "Already executed");

        let current_count = storage.signer_count.read();
        assert((new_threshold as u32) <= (current_count as u32), "Threshold cannot exceed signer count");

        // Verify the provided public key matches stored public key
        let stored_pk_x = storage.signer_pubkeys_x.at(caller_addr).read();
        let stored_pk_y = storage.signer_pubkeys_y.at(caller_addr).read();
        assert(stored_pk_x == expected_pk_x, "Public key mismatch");
        assert(stored_pk_y == expected_pk_y, "Public key mismatch");

        storage.management_approval_counts.at(message_hash).write(1);
        storage.management_signer_approvals.at(message_hash).at(caller_addr).write(1);

        let current_threshold = storage.threshold.read();
        if (1 as u32) >= (current_threshold as u32) {
            // Execute threshold change
            storage.threshold.write(new_threshold as Field);
            storage.executed_management_operations.at(message_hash).write(1);
        }

        storage.signer_nonces.at(caller_addr).write((signer_nonce + 1) as Field);
    }

    // ========== 4. PROPOSE TRANSACTION - PRIVATE (Intent Only) ==========

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

        let intent = TransactionIntent {
            to,
            amount,
            function_selector,
            data_hash,
            nonce: signer_nonce + 1000,
            deadline,
        };

        let message_hash = intent.hash();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let proposal_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field, 4]);
        context.push_nullifier(proposal_nullifier);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("propose_transaction_internal(Field,Field,u32,Field,Field)"),
            [message_hash, caller.to_field(), signer_nonce as Field, signer_pk_x, signer_pk_y],
        );

        message_hash
    }

    #[public]
    #[internal]
    fn propose_transaction_internal(
        message_hash: Field,
        caller: Field,
        signer_nonce: u32,
        expected_pk_x: Field,
        expected_pk_y: Field,
    ) {
        let caller_addr = AztecAddress::from_field(caller);

        assert(storage.authorized_signers.at(caller_addr).read() == 1, "Not authorized signer");
        assert(storage.signer_nonces.at(caller_addr).read() as u32 == signer_nonce, "Invalid nonce");
        assert(storage.executed_messages.at(message_hash).read() == 0, "Message already executed");

        // Verify the provided public key matches stored public key
        let stored_pk_x = storage.signer_pubkeys_x.at(caller_addr).read();
        let stored_pk_y = storage.signer_pubkeys_y.at(caller_addr).read();
        assert(stored_pk_x == expected_pk_x, "Public key mismatch");
        assert(stored_pk_y == expected_pk_y, "Public key mismatch");

        storage.message_approval_counts.at(message_hash).write(1);
        storage.message_signer_approvals.at(message_hash).at(caller_addr).write(1);

        let current_threshold = storage.threshold.read();
        if (1 as u32) >= (current_threshold as u32) {
            storage.executed_messages.at(message_hash).write(1);
            storage.temp_execution_result.write(1);
        } else {
            storage.temp_execution_result.write(0);
        }

        let current_tx_nonce = storage.transaction_nonce.read();
        storage.transaction_nonce.write(current_tx_nonce + 1);
        storage.signer_nonces.at(caller_addr).write((signer_nonce + 1) as Field);
    }

    // ========== 5. APPROVE TRANSACTION - PRIVATE (Auto Execute) ==========

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

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let approval_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field, 5]);
        context.push_nullifier(approval_nullifier);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("approve_transaction_internal(Field,Field,u32,Field,Field)"),
            [message_hash, caller.to_field(), signer_nonce as Field, signer_pk_x, signer_pk_y],
        );
    }

    #[public]
    #[internal]
    fn approve_transaction_internal(
        message_hash: Field,
        caller: Field,
        signer_nonce: u32,
        expected_pk_x: Field,
        expected_pk_y: Field,
    ) {
        let caller_addr = AztecAddress::from_field(caller);

        assert(storage.authorized_signers.at(caller_addr).read() == 1, "Not authorized signer");
        assert(storage.signer_nonces.at(caller_addr).read() as u32 == signer_nonce, "Invalid nonce");
        assert(storage.executed_messages.at(message_hash).read() == 0, "Already executed");
        assert(
            storage.message_signer_approvals.at(message_hash).at(caller_addr).read() == 0,
            "Already approved by this signer",
        );

        // Verify the provided public key matches stored public key
        let stored_pk_x = storage.signer_pubkeys_x.at(caller_addr).read();
        let stored_pk_y = storage.signer_pubkeys_y.at(caller_addr).read();
        assert(stored_pk_x == expected_pk_x, "Public key mismatch");
        assert(stored_pk_y == expected_pk_y, "Public key mismatch");

        let current_approvals = storage.message_approval_counts.at(message_hash).read();
        storage.message_approval_counts.at(message_hash).write(current_approvals + 1);
        storage.message_signer_approvals.at(message_hash).at(caller_addr).write(1);

        let current_threshold = storage.threshold.read();
        let should_execute = ((current_approvals + 1) as u32) >= (current_threshold as u32);

        if should_execute {
            storage.executed_messages.at(message_hash).write(1);
            storage.temp_execution_result.write(1);
        } else {
            storage.temp_execution_result.write(0);
        }

        storage.signer_nonces.at(caller_addr).write((signer_nonce + 1) as Field);
    }

    // ========== APPROVE MANAGEMENT OPERATIONS ==========

    #[private]
    fn approve_management_operation(
        message_hash: Field,
        signature: [u8; 64],
        signer_nonce: u32,
        signer_pk_x: Field,
        signer_pk_y: Field,
    ) {
        assert(message_hash != 0, "Invalid message hash");
        assert((signer_pk_x != 0) & (signer_pk_y != 0), "Invalid signer public key");

        let caller = context.msg_sender();

        let signature_valid = verify_schnorr_signature(message_hash, signature, signer_pk_x, signer_pk_y);
        assert(signature_valid, "Invalid Schnorr signature");

        let approval_nullifier = poseidon2_hash([caller.to_field(), message_hash, signer_nonce as Field, 6]);
        context.push_nullifier(approval_nullifier);

        context.call_public_function(
            context.this_address(),
            FunctionSelector::from_signature("approve_management_operation_internal(Field,Field,u32,Field,Field)"),
            [message_hash, caller.to_field(), signer_nonce as Field, signer_pk_x, signer_pk_y],
        );
    }

    #[public]
    #[internal]
    fn approve_management_operation_internal(
        message_hash: Field,
        caller: Field,
        signer_nonce: u32,
        expected_pk_x: Field,
        expected_pk_y: Field,
    ) {
        let caller_addr = AztecAddress::from_field(caller);

        assert(storage.authorized_signers.at(caller_addr).read() == 1, "Not authorized signer");
        assert(storage.signer_nonces.at(caller_addr).read() as u32 == signer_nonce, "Invalid nonce");
        assert(storage.executed_management_operations.at(message_hash).read() == 0, "Already executed");
        assert(
            storage.management_signer_approvals.at(message_hash).at(caller_addr).read() == 0,
            "Already approved by this signer",
        );

        // Verify the provided public key matches stored public key
        let stored_pk_x = storage.signer_pubkeys_x.at(caller_addr).read();
        let stored_pk_y = storage.signer_pubkeys_y.at(caller_addr).read();
        assert(stored_pk_x == expected_pk_x, "Public key mismatch");
        assert(stored_pk_y == expected_pk_y, "Public key mismatch");

        let current_approvals = storage.management_approval_counts.at(message_hash).read();
        storage.management_approval_counts.at(message_hash).write(current_approvals + 1);
        storage.management_signer_approvals.at(message_hash).at(caller_addr).write(1);

        let current_threshold = storage.threshold.read();
        let should_execute = ((current_approvals + 1) as u32) >= (current_threshold as u32);

        if should_execute {
            storage.executed_management_operations.at(message_hash).write(1);
            storage.temp_execution_result.write(1);
        } else {
            storage.temp_execution_result.write(0);
        }

        storage.signer_nonces.at(caller_addr).write((signer_nonce + 1) as Field);
    }

    // ========== UTILITY FUNCTIONS ==========

    #[public]
    fn get_signer_info(signer: AztecAddress) -> (bool, Field, Field, Field) {
        let is_authorized = storage.authorized_signers.at(signer).read() == 1;
        let pubkey_x = storage.signer_pubkeys_x.at(signer).read();
        let pubkey_y = storage.signer_pubkeys_y.at(signer).read();
        let nonce = storage.signer_nonces.at(signer).read();

        (is_authorized, pubkey_x, pubkey_y, nonce)
    }

    #[public]
    fn get_multisig_config() -> (Field, Field, Field) {
        let threshold = storage.threshold.read();
        let signer_count = storage.signer_count.read();
        let tx_nonce = storage.transaction_nonce.read();

        (threshold, signer_count, tx_nonce)
    }

    #[public]
    fn is_signer(address: AztecAddress) -> bool {
        storage.authorized_signers.at(address).read() == 1
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
    fn get_transaction_nonce() -> Field {
        storage.transaction_nonce.read()
    }

    #[public]
    fn is_message_executed(message_hash: Field) -> bool {
        storage.executed_messages.at(message_hash).read() == 1
    }

    #[public]
    fn get_approval_count(message_hash: Field) -> Field {
        storage.message_approval_counts.at(message_hash).read()
    }

    #[public]
    fn get_signer_pubkey(signer: AztecAddress) -> [Field; 2] {
        let x = storage.signer_pubkeys_x.at(signer).read();
        let y = storage.signer_pubkeys_y.at(signer).read();
        [x, y]
    }

    #[public]
    fn get_signer_nonce(signer: AztecAddress) -> Field {
        storage.signer_nonces.at(signer).read()
    }

    #[public]
    fn has_signer_approved(message_hash: Field, signer: AztecAddress) -> bool {
        storage.message_signer_approvals.at(message_hash).at(signer).read() == 1
    }

    #[public]
    fn is_message_ready_for_execution(message_hash: Field) -> bool {
        let approval_count = storage.message_approval_counts.at(message_hash).read();
        let threshold = storage.threshold.read();
        (approval_count as u32) >= (threshold as u32)
    }

    #[public]
    fn get_management_approval_count(message_hash: Field) -> Field {
        storage.management_approval_counts.at(message_hash).read()
    }

    #[public]
    fn has_signer_approved_management(message_hash: Field, signer: AztecAddress) -> bool {
        storage.management_signer_approvals.at(message_hash).at(signer).read() == 1
    }

    #[public]
    fn is_management_operation_executed(message_hash: Field) -> bool {
        storage.executed_management_operations.at(message_hash).read() == 1
    }

    #[public]
    fn is_management_operation_ready_for_execution(message_hash: Field) -> bool {
        let approval_count = storage.management_approval_counts.at(message_hash).read();
        let threshold = storage.threshold.read();
        (approval_count as u32) >= (threshold as u32)
    }

    #[public]
    fn get_temp_execution_result() -> Field {
        storage.temp_execution_result.read()
    }
}