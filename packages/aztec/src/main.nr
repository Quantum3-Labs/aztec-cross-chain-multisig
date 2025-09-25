use dep::aztec::macros::aztec;

#[aztec]
pub contract MultiSchnorrPortalAccount {
    use dep::aztec::{
        authwit::{
            account::AccountActions,
            entrypoint::{app::AppPayload, fee::FeePayload},
        },
        context::PrivateContext,
        macros::{
            functions::{initializer, noinitcheck, private, public, view},
            storage::storage,
        },
        oracle::auth_witness::get_auth_witness,
        state_vars::{Map, PublicMutable, PublicImmutable},
        protocol_types::{address::EthAddress, traits::ToField},
        hash::pedersen_hash,
    };

    use dep::std::embedded_curve_ops::EmbeddedCurvePoint;
    // Removed: use dep::std::schnorr; (could not resolve 'schnorr' in path)

    #[storage]
    struct Storage<Context> {
        pk_x: Map<u8, PublicImmutable<Field, Context>, Context>,
        pk_y: Map<u8, PublicImmutable<Field, Context>, Context>,
        threshold: PublicImmutable<u8, Context>,
        portal_address: PublicImmutable<EthAddress, Context>,
        l1_emitter: PublicImmutable<EthAddress, Context>,
        cross_chain_nonce: PublicMutable<u32, Context>,
        approvals: Map<Field, PublicMutable<u8, Context>, Context>,
        cross_chain_approvals: Map<Field, Map<u8, PublicMutable<bool, Context>, Context>, Context>,
        cross_chain_approval_count: Map<Field, PublicMutable<u8, Context>, Context>,
        executed_cross_chain: Map<Field, PublicMutable<bool, Context>, Context>,
        inbound_seen: Map<u64, PublicMutable<bool, Context>, Context>,
    }

    #[public]
    #[initializer]
    fn constructor(
        pk1_x: Field, pk1_y: Field,
        pk2_x: Field, pk2_y: Field,
        pk3_x: Field, pk3_y: Field,
        m: u8,
        portal: EthAddress,
        l1_emitter: EthAddress,
    ) {
        assert(m > 0, "Threshold must be > 0");
        assert(m <= 3, "Threshold cannot exceed 3");
        storage.pk_x.at(1).initialize(pk1_x);
        storage.pk_y.at(1).initialize(pk1_y);
        storage.pk_x.at(2).initialize(pk2_x);
        storage.pk_y.at(2).initialize(pk2_y);
        storage.pk_x.at(3).initialize(pk3_x);
        storage.pk_y.at(3).initialize(pk3_y);
        storage.threshold.initialize(m);
        storage.portal_address.initialize(portal);
        storage.l1_emitter.initialize(l1_emitter);
        storage.cross_chain_nonce.write(0);
    }

    #[private]
    #[noinitcheck]
    fn entrypoint(app: AppPayload, fee: FeePayload, cancellable: bool) {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.entrypoint(app, fee, cancellable);
    }

    #[private]
    #[noinitcheck]
    #[view]
    fn verify_private_authwit(inner_hash: Field) -> Field {
        let actions = AccountActions::init(&mut context, is_valid_impl);
        actions.verify_private_authwit(inner_hash)
    }

    #[contract_library_method]
    fn is_valid_impl(context: &mut PrivateContext, outer_hash: Field) -> bool {
        let state = Storage::init(context);
        // Safety: get_auth_witness is provided by the Aztec kernel and returns the signature witness for this outer_hash.
        let witness: [Field; 64] = unsafe { get_auth_witness(outer_hash) };
        let mut signature: [u8; 64] = [0; 64];
        for i in 0..64 { signature[i] = witness[i] as u8; }
        let mut valid: u8 = 0u8;
        for signer_index in 1..4 {
            let pk_x: Field = state.pk_x.at(signer_index).read();
            let pk_y: Field = state.pk_y.at(signer_index).read();
            if (pk_x != Field::from(0)) & (pk_y != Field::from(0)) {
                let pub_key = EmbeddedCurvePoint { x: pk_x, y: pk_y, is_infinite: false };
                if schnorr::verify_signature(pub_key, signature, outer_hash.to_be_bytes::<32>()) {
                    valid = valid + 1u8;
                }
            }
        }
        let m: u8 = state.threshold.read();
        valid >= m
    }

    #[public]
    fn propose_cross_chain_tx(
        target_chain: u16,
        target_contract: EthAddress,
        amount: u128,
        recipient: Field,
        intent_type: u8,
        signer_index: u8,
    ) -> pub Field {
        assert((signer_index >= 1) & (signer_index <= 3), "Invalid signer index");
        assert(intent_type <= 4, "Invalid intent type");
        assert(target_chain > 0, "Invalid target chain");
        let current_nonce: u32 = storage.cross_chain_nonce.read();
        let new_nonce: u32 = current_nonce + 1u32;
        storage.cross_chain_nonce.write(new_nonce);
        let tx_hash = pedersen_hash([
            new_nonce as Field,
            target_chain as Field,
            target_contract.to_field(),
            amount as Field,
            recipient,
            intent_type as Field,
        ], 0);
        storage.cross_chain_approval_count.at(tx_hash).write(1u8);
        storage.cross_chain_approvals.at(tx_hash).at(signer_index).write(true);
        storage.executed_cross_chain.at(tx_hash).write(false);
        tx_hash
    }

    #[public]
    fn approve_cross_chain_tx(tx_hash: Field, signer_index: u8) {
        assert((signer_index >= 1) & (signer_index <= 3), "Invalid signer index");
        let already_approved = storage.cross_chain_approvals.at(tx_hash).at(signer_index).read();
        assert(!already_approved, "Already approved");
        let already_executed = storage.executed_cross_chain.at(tx_hash).read();
        assert(!already_executed, "Already executed");
        storage.cross_chain_approvals.at(tx_hash).at(signer_index).write(true);
        let current_count: u8 = storage.cross_chain_approval_count.at(tx_hash).read();
        storage.cross_chain_approval_count.at(tx_hash).write(current_count + 1u8);
    }

    #[private]
    fn emit_cross_chain_tx(
        nonce: u32,
        target_chain: u16,
        target_contract: EthAddress,
        amount: u128,
        recipient: Field,
        intent_type: u8,
    ) -> Field {
        let tx_hash = pedersen_hash([
            nonce as Field,
            target_chain as Field,
            target_contract.to_field(),
            amount as Field,
            recipient,
            intent_type as Field,
        ], 0);
        let portal = storage.portal_address.read();
        let content_commitment = pedersen_hash([
            nonce as Field,
            target_chain as Field,
            target_contract.to_field(),
            amount as Field,
            recipient,
            intent_type as Field,
        ], 1);
        context.message_portal(portal, content_commitment);
        tx_hash
    }

    #[public]
    fn execute_cross_chain_tx(
        nonce: u32,
        target_chain: u16,
        target_contract: EthAddress,
        amount: u128,
        recipient: Field,
        intent_type: u8,
    ) -> pub bool {
        let tx_hash = pedersen_hash([
            nonce as Field,
            target_chain as Field,
            target_contract.to_field(),
            amount as Field,
            recipient,
            intent_type as Field,
        ], 0);
        let already_executed = storage.executed_cross_chain.at(tx_hash).read();
        assert(!already_executed, "Already executed");
        let approval_count: u8 = storage.cross_chain_approval_count.at(tx_hash).read();
        let threshold: u8 = storage.threshold.read();
        assert(approval_count >= threshold, "Not enough approvals");
        storage.executed_cross_chain.at(tx_hash).write(true);
        true
    }

    #[public]
    fn handle_cross_chain_message(
        emitter_chain: u16,
        emitter_address: Field,
        sequence: u64,
        payload: Field,
    ) -> pub bool {
        assert(emitter_chain > 0, "Invalid emitter chain");
        let expected = storage.l1_emitter.read();
        assert(expected.to_field() == emitter_address, "Invalid emitter");
        let seen = storage.inbound_seen.at(sequence).read();
        assert(!seen, "Replay");
        storage.inbound_seen.at(sequence).write(true);
        let _p = payload;
        true
    }

    #[public]
    fn get_threshold() -> pub u8 { storage.threshold.read() }

    #[public]
    fn get_pk(i: u8) -> pub (Field, Field) {
        assert((i >= 1) & (i <= 3), "Invalid key index");
        (storage.pk_x.at(i).read(), storage.pk_y.at(i).read())
    }

    #[public]
    fn get_cross_chain_nonce() -> pub u32 { storage.cross_chain_nonce.read() }

    #[public]
    fn get_cross_chain_approval_count(tx_hash: Field) -> pub u8 {
        storage.cross_chain_approval_count.at(tx_hash).read()
    }

    #[public]
    fn has_approved_cross_chain(tx_hash: Field, signer_index: u8) -> pub bool {
        storage.cross_chain_approvals.at(tx_hash).at(signer_index).read()
    }

    #[public]
    fn is_cross_chain_executed(tx_hash: Field) -> pub bool {
        storage.executed_cross_chain.at(tx_hash).read()
    }

    #[public]
    fn get_portal_address() -> pub EthAddress { storage.portal_address.read() }

    #[public]
    fn get_l1_emitter() -> pub EthAddress { storage.l1_emitter.read() }
}
