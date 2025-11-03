use dep::aztec::macros::aztec;

mod signature;

/*
Aztec Multisig Account contract that integrated with Wormhole connecting with Arbitrum
*/
#[aztec]
pub contract MultisigAccount {
    use crate::signature::Signature;
    use dep::aztec::{
        context::PrivateContext,
        macros::{functions::{external, initializer}, storage::storage},
        messages::message_delivery::MessageDelivery,
        protocol_types::{address::AztecAddress, traits::ToField},
        state_vars::{map::Map, PrivateImmutable, PrivateMutable},
    };
    use dep::schnorr;
    use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
    use dep::value_note::value_note::ValueNote;
    // use dep::wormhole::Wormhole;

    global ACCOUNT_MAX_SIGNERS: u32 = 8;

    #[storage]
    struct Storage<Context> {
        master_signer: PrivateImmutable<ValueNote, Context>,
        threshold: PrivateMutable<ValueNote, Context>,
        signer_count: PrivateMutable<ValueNote, Context>,
        is_signer: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_pubkeys_x: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        signer_pubkeys_y: Map<AztecAddress, PrivateMutable<ValueNote, Context>, Context>,
        executed_message_hashes: Map<Field, PrivateImmutable<ValueNote, Context>, Context>,
    }

    /*
        @dev Since we can't use dynamic array, we will use a fixed size array of 8 signers, it means that maximum number of signers is 8
    */
    #[initializer]
    #[external("private")]
    fn constructor(
        signers: [AztecAddress; ACCOUNT_MAX_SIGNERS],
        initial_threshold: u32,
        signers_pk_x: [Field; ACCOUNT_MAX_SIGNERS],
        signers_pk_y: [Field; ACCOUNT_MAX_SIGNERS],
    ) {
        assert_valid_initialization(signers, signers_pk_x, signers_pk_y, initial_threshold);

        let master = context.msg_sender().unwrap();
        storage.master_signer.initialize(ValueNote::new(master.to_field(), master)).emit(
            master,
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );
        // then store signers, pk_x, pk_y and threshold privately
        let threshold_note = ValueNote::new(initial_threshold as Field, master);
        // initialize threshold
        storage.threshold.initialize(threshold_note).emit(
            master,
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        // count valid signers
        let signer_count = count_valid_signers(signers);
        storage.signer_count.initialize(ValueNote::new(signer_count as Field, master)).emit(
            master,
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        // initialize signers and their public keys privately
        for i in 0..ACCOUNT_MAX_SIGNERS {
            let signer = signers[i];
            if !signer.is_zero() {
                storage
                    .is_signer
                    .at(signer)
                    .initialize(ValueNote::new(true.to_field(), signer))
                    .emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);

                storage
                    .signer_pubkeys_x
                    .at(signer)
                    .initialize(ValueNote::new(signers_pk_x[i], signer))
                    .emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);

                storage
                    .signer_pubkeys_y
                    .at(signer)
                    .initialize(ValueNote::new(signers_pk_y[i], signer))
                    .emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);
            }
        }
    }

    /*
        @dev We collect signatures offchain, and submit all at once
    */
    #[external("private")]
    fn add_signer(
        message_hash: Field,
        new_signer: AztecAddress,
        new_signer_pk_x: Field,
        new_signer_pk_y: Field,
        signatures: [Signature; ACCOUNT_MAX_SIGNERS],
    ) {
        let is_message_initialized = unsafe { is_message_initialized(message_hash) };
        let caller = context.msg_sender().unwrap();

        assert(!new_signer.is_zero(), "Cannot add zero address as signer");
        assert((new_signer_pk_x != 0) & (new_signer_pk_y != 0), "Invalid public key");
        assert(!is_message_initialized, "Message hash already executed");
        assert_is_master(caller, storage);
        assert_valid_signatures(caller, message_hash, signatures, storage);

        // check if is already a signer
        let is_already_initialized = unsafe { is_signer_initialized(new_signer) };

        if is_already_initialized {
            // check is already a signer
            let is_already_signer = unsafe { is_address_signer(new_signer) };
            assert(!is_already_signer, "Signer already exists");
        }

        // add signer to signer count
        let signer_count: u32 = storage.signer_count.get_note().content.note.value() as u32;

        // signer count should be less than or equal to ACCOUNT_MAX_SIGNERS
        assert(
            signer_count < ACCOUNT_MAX_SIGNERS,
            "Signer count must be less than or equal to the maximum number of signers",
        );

        storage.signer_count.replace(|_| ValueNote::new((signer_count + 1) as Field, caller)).emit(
            caller,
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );

        storage
            .is_signer
            .at(new_signer)
            .initialize_or_replace(|_| ValueNote::new(true.to_field(), new_signer))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);

        storage
            .signer_pubkeys_x
            .at(new_signer)
            .initialize_or_replace(|_| ValueNote::new(new_signer_pk_x, new_signer))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);

        storage
            .signer_pubkeys_y
            .at(new_signer)
            .initialize_or_replace(|_| ValueNote::new(new_signer_pk_y, new_signer))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);

        // write message hash to executed_message_hashes
        storage
            .executed_message_hashes
            .at(message_hash)
            .initialize(ValueNote::new(true.to_field(), caller))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
    }

    #[external("private")]
    fn remove_signer(
        message_hash: Field,
        target_signer: AztecAddress,
        signatures: [Signature; ACCOUNT_MAX_SIGNERS],
    ) {
        let caller = context.msg_sender().unwrap();
        let is_already_signer = unsafe { is_address_signer(target_signer) };
        let is_message_initialized = unsafe { is_message_initialized(message_hash) };

        assert(!target_signer.is_zero(), "Cannot remove zero address as signer");
        assert_is_master(caller, storage);
        assert_valid_signatures(caller, message_hash, signatures, storage);
        assert(is_already_signer, "Signer does not exist");
        assert(!is_message_initialized, "Message hash already executed");

        // need to know after removing signer, if threshold is met
        let signer_count_note = storage.signer_count.get_note();
        let mut signer_count: u32 = signer_count_note.content.note.value() as u32;
        signer_count_note.emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
        // signer count > 0
        assert(signer_count > 0, "No signers to remove");
        signer_count -= 1;
        // get threshold
        let threshold_note = storage.threshold.get_note();
        let threshold = threshold_note.content.note.value();
        threshold_note.emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
        assert(signer_count >= threshold as u32, "Insufficient signatures after removing signer");

        // verify new signer is not already a signer
        // this will throw error if signer is already a signer, because initialize can only be called once
        storage
            .is_signer
            .at(target_signer)
            .replace(|_| ValueNote::new(false.to_field(), target_signer))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);

        storage
            .signer_pubkeys_x
            .at(target_signer)
            .replace(|_| ValueNote::new(0 as Field, target_signer))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);

        storage
            .signer_pubkeys_y
            .at(target_signer)
            .replace(|_| ValueNote::new(0 as Field, target_signer))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
    }

    #[external("private")]
    fn change_threshold(
        message_hash: Field,
        new_threshold: u32,
        signatures: [Signature; ACCOUNT_MAX_SIGNERS],
    ) {
        let caller = context.msg_sender().unwrap();
        let is_message_initialized = unsafe { is_message_initialized(message_hash) };

        assert(new_threshold > 0, "New threshold must be greater than 0");
        assert(
            new_threshold <= ACCOUNT_MAX_SIGNERS,
            "New threshold must be less than or equal to the maximum number of signers",
        );
        assert_is_master(caller, storage);
        assert_valid_signatures(caller, message_hash, signatures, storage);
        assert(!is_message_initialized, "Message hash already executed");

        // threshold must be less than or equal to signer count
        let signer_count_note = storage.signer_count.get_note();
        let signer_count = signer_count_note.content.note.value() as u32;
        signer_count_note.emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
        assert(
            new_threshold <= signer_count,
            "New threshold must be less than or equal to the signer count",
        );

        // new threshold should not be the same with old threshold
        let old_threshold_note = storage.threshold.get_note();
        let old_threshold = old_threshold_note.content.note.value();
        old_threshold_note.emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
        assert(
            new_threshold != old_threshold as u32,
            "New threshold must be different from the old threshold",
        );

        storage.threshold.replace(|_| ValueNote::new(new_threshold as Field, caller)).emit(
            caller,
            MessageDelivery.CONSTRAINED_ONCHAIN,
        );
    }

    /**

    */
    #[external("private")]
    fn execute_cross_chain_intent(
        message_hash: Field,
        target_chain: Field,
        target_contract: AztecAddress,
        intent_type: Field,
        amount: Field,
        recipient: AztecAddress,
        wormhole_address: AztecAddress,
        signatures: [Signature; ACCOUNT_MAX_SIGNERS],
    ) {
        let is_message_initialized = unsafe { is_message_initialized(message_hash) };
        let caller = context.msg_sender().unwrap();

        assert(!is_message_initialized, "Message hash already executed");
        assert_is_master(caller, storage);
        assert_valid_signatures(caller, message_hash, signatures, storage);

        // Construct payload: 8 Fields x 31 bytes = 248 bytes
        // [action=6, target_chain, target_contract, intent_type, amount, recipient, nonce, deadline]
        let mut payload: [[u8; 31]; 8] = [[0; 31]; 8];

        // Field 0: action = 6
        let action_bytes = (6 as Field).to_be_bytes::<32>();
        for i in 0..31 {
            payload[0][i] = action_bytes[i + 1];
        }

        // Field 1: target_chain
        let target_chain_bytes = target_chain.to_be_bytes::<32>();
        for i in 0..31 {
            payload[1][i] = target_chain_bytes[i + 1];
        }

        // Field 2: target_contract
        let target_contract_bytes = target_contract.to_field().to_be_bytes::<32>();
        for i in 0..31 {
            payload[2][i] = target_contract_bytes[i + 1];
        }

        // Field 3: intent_type
        let intent_type_bytes = intent_type.to_be_bytes::<32>();
        for i in 0..31 {
            payload[3][i] = intent_type_bytes[i + 1];
        }

        // Field 4: amount
        let amount_bytes = amount.to_be_bytes::<32>();
        for i in 0..31 {
            payload[4][i] = amount_bytes[i + 1];
        }

        // Field 5: recipient
        let recipient_bytes = recipient.to_field().to_be_bytes::<32>();
        for i in 0..31 {
            payload[5][i] = recipient_bytes[i + 1];
        }

        // Field 6: nonce (0 for now)
        let nonce: Field = 0;
        let nonce_bytes = nonce.to_be_bytes::<32>();
        for i in 0..31 {
            payload[6][i] = nonce_bytes[i + 1];
        }

        // Field 7: deadline (0 for now)
        let deadline: Field = 0;
        let deadline_bytes = deadline.to_be_bytes::<32>();
        for i in 0..31 {
            payload[7][i] = deadline_bytes[i + 1];
        }

        // Publish to Wormhole
        // Wormhole::at(wormhole_address)
        //     .publish_message_in_private(0, payload, 0, 1, context.msg_sender(), 0)
        //     .call(&mut context);

        storage
            .executed_message_hashes
            .at(message_hash)
            .initialize(ValueNote::new(true.to_field(), caller))
            .emit(caller, MessageDelivery.CONSTRAINED_ONCHAIN);
    }

    #[contract_library_method]
    fn assert_valid_signatures(
        master: AztecAddress,
        message_hash: Field,
        signatures: [Signature; ACCOUNT_MAX_SIGNERS],
        storage: Storage<&mut PrivateContext>,
    ) {
        let mut count = 0;
        let mut seen_owners: [AztecAddress; ACCOUNT_MAX_SIGNERS] =
            [AztecAddress::zero(); ACCOUNT_MAX_SIGNERS];
        let mut seen_count = 0;

        for i in 0..ACCOUNT_MAX_SIGNERS {
            let signature = signatures[i];
            // extract signature owner and signature
            let owner = signature.owner;
            let signature = signature.signature;

            // if owner or signature is zero, skip
            if !owner.is_zero() {
                let is_duplicate = seen_owners.any(|seen_owner| seen_owner == owner);
                assert(!is_duplicate, "Duplicate signature from same owner");

                seen_owners[seen_count] = owner;
                seen_count += 1;

                // verify signature owner is signer
                assert_is_signer(master, owner, storage);

                let pubkey_x_note = storage.signer_pubkeys_x.at(owner).get_note();
                let pubkey_x = pubkey_x_note.content.note.value();
                // emit pubkey_x
                pubkey_x_note.emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);

                let pubkey_y_note = storage.signer_pubkeys_y.at(owner).get_note();
                let pubkey_y = pubkey_y_note.content.note.value();
                // emit pubkey_y
                pubkey_y_note.emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);

                assert_valid_schnorr_signature(message_hash, signature, pubkey_x, pubkey_y);

                count += 1;
            }
        }

        // if seen count == 0, means no valid signatures were found
        assert(seen_count > 0, "No valid signatures found");

        // read threshold from storage
        let threshold_note = storage.threshold.get_note();
        let threshold = threshold_note.content.note.value();
        threshold_note.emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);
        assert(count >= threshold as u32, "Insufficient signatures");
    }

    #[contract_library_method]
    fn assert_valid_initialization(
        signers: [AztecAddress; ACCOUNT_MAX_SIGNERS],
        signers_pk_x: [Field; ACCOUNT_MAX_SIGNERS],
        signers_pk_y: [Field; ACCOUNT_MAX_SIGNERS],
        threshold: u32,
    ) {
        let count = count_valid_signers(signers);
        assert(count >= threshold, "Invalid threshold");
        assert(count <= ACCOUNT_MAX_SIGNERS, "Invalid threshold");
        assert(count > 0, "Invalid threshold");

        // Check for duplicate addresses
        for i in 0..ACCOUNT_MAX_SIGNERS {
            for j in (i + 1)..ACCOUNT_MAX_SIGNERS {
                let signer_i = signers[i];
                let signer_j = signers[j];
                if !signer_i.is_zero() & !signer_j.is_zero() {
                    assert(signer_i != signer_j, f"Duplicate signer address: {signer_i}");
                }
            }
        }

        // loop through signers, pk_x and pk_y
        // whenever signer is not zero, check if pk_x and pk_y are not zero
        // whenever signer is zero, check if pk_x and pk_y are zero
        for i in 0..ACCOUNT_MAX_SIGNERS {
            let signer = signers[i];
            let pk_x = signers_pk_x[i];
            let pk_y = signers_pk_y[i];
            if !signer.is_zero() {
                assert(pk_x != 0, f"Invalid pk_x for signer {signer}");
                assert(pk_y != 0, f"Invalid pk_y for signer {signer}");
            } else {
                assert(pk_x == 0, f"Invalid pk_x for signer {signer}");
                assert(pk_y == 0, f"Invalid pk_y for signer {signer}");
            }
        }
    }

    #[contract_library_method]
    fn count_valid_signers(signers: [AztecAddress; ACCOUNT_MAX_SIGNERS]) -> u32 {
        let mut count = 0;
        for signer in signers {
            if !signer.is_zero() {
                count += 1;
            }
        }
        count
    }

    #[contract_library_method]
    fn assert_valid_schnorr_signature(
        message_hash: Field,
        signature: [u8; 64],
        pubkey_x: Field,
        pubkey_y: Field,
    ) {
        let pub_key = EmbeddedCurvePoint { x: pubkey_x, y: pubkey_y, is_infinite: false };
        let is_valid =
            schnorr::verify_signature(pub_key, signature, message_hash.to_be_bytes::<32>());
        assert(is_valid, "Invalid signature");
    }

    #[contract_library_method]
    fn assert_is_signer(
        master: AztecAddress,
        caller: AztecAddress,
        storage: Storage<&mut PrivateContext>,
    ) {
        let is_caller_signer_note = storage.is_signer.at(caller).get_note();
        let is_caller_signer = is_caller_signer_note.content.note.value();
        is_caller_signer_note.emit(master, MessageDelivery.CONSTRAINED_ONCHAIN);
        assert(is_caller_signer == true.to_field(), "Caller is not a signer");
    }

    #[contract_library_method]
    fn assert_is_master(caller: AztecAddress, storage: Storage<&mut PrivateContext>) {
        let master_signer: Field = storage.master_signer.get_note().value();
        assert(master_signer == caller.to_field(), "Caller is not the master signer");
    }

    #[external("utility")]
    unconstrained fn is_signer_initialized(signer: AztecAddress) -> bool {
        storage.is_signer.at(signer).is_initialized()
    }

    #[external("utility")]
    unconstrained fn is_address_signer(signer: AztecAddress) -> bool {
        storage.is_signer.at(signer).view_note().value() == true.to_field()
    }

    #[external("utility")]
    unconstrained fn get_threshold() -> Field {
        storage.threshold.view_note().value()
    }

    #[external("utility")]
    unconstrained fn is_message_initialized(message_hash: Field) -> bool {
        storage.executed_message_hashes.at(message_hash).is_initialized()
    }

}
