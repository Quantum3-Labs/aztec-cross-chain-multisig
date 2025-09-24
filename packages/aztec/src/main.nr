use dep::aztec::macros::aztec;

#[aztec]
pub contract MultiSchnorrAccount {
    use aztec::{
        macros::{functions::{initializer, public}, storage::storage},
        state_vars::{Map, PublicMutable, PublicImmutable},
        protocol_types::address::EthAddress,
        hash::pedersen_hash,
    };

    global IS_VALID_SELECTOR: Field = 0xabf64ad4;

    #[storage]
    struct Storage<Context> {
        // Original multisig storage
        pk_x: Map<u8, PublicMutable<Field, Context>, Context>,
        pk_y: Map<u8, PublicMutable<Field, Context>, Context>,
        threshold: PublicMutable<u8, Context>,
        approvals: Map<Field, PublicMutable<u8, Context>, Context>,
        
        // Cross-chain infrastructure
        portal_address: PublicImmutable<EthAddress, Context>,
        wormhole_emitter: PublicImmutable<EthAddress, Context>,
        
        // Cross-chain transaction tracking
        cross_chain_nonce: PublicMutable<u32, Context>,
        cross_chain_approvals: Map<Field, Map<u8, PublicMutable<bool, Context>, Context>, Context>,
        cross_chain_approval_count: Map<Field, PublicMutable<u8, Context>, Context>,
        executed_cross_chain: Map<Field, PublicMutable<bool, Context>, Context>,
    }

    #[public]
    #[initializer]
    fn constructor(
        pk1_x: Field, pk1_y: Field,
        pk2_x: Field, pk2_y: Field,
        pk3_x: Field, pk3_y: Field,
        m: u8,
        portal: EthAddress,
        wormhole_emitter: EthAddress,
    ) {
        // Original multisig setup
        storage.pk_x.at(1).write(pk1_x);
        storage.pk_y.at(1).write(pk1_y);
        storage.pk_x.at(2).write(pk2_x);
        storage.pk_y.at(2).write(pk2_y);
        storage.pk_x.at(3).write(pk3_x);
        storage.pk_y.at(3).write(pk3_y);
        storage.threshold.write(m);
        
        // Cross-chain setup
        storage.portal_address.initialize(portal);
        storage.wormhole_emitter.initialize(wormhole_emitter);
        storage.cross_chain_nonce.write(0);
    }

    // Original multisig functions
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

    // CROSS-CHAIN MULTISIG FUNCTIONS

    #[public]
    fn propose_cross_chain_tx(
        target_chain: u16,
        target_contract: [u8; 32],
        amount: u128,
        recipient: [u8; 32],
        payload: [u8; 64],
        signer_index: u8,
    ) -> Field {
        // Validate signer index
        assert(signer_index >= 1, "Signer index too low");
        assert(signer_index <= 3, "Signer index too high");
        
        // Increment nonce for this transaction
        let current_nonce = storage.cross_chain_nonce.read();
        let new_nonce = current_nonce + 1;
        storage.cross_chain_nonce.write(new_nonce);
        
        // Create unique transaction hash
        let tx_hash = pedersen_hash([
            new_nonce as Field,
            target_chain as Field,
            bytes32_to_field(target_contract),
            amount as Field,
            bytes32_to_field(recipient),
            bytes64_to_field(payload),
        ], 0);
        
        // Initialize approval tracking
        storage.cross_chain_approval_count.at(tx_hash).write(1);
        storage.cross_chain_approvals.at(tx_hash).at(signer_index).write(true);
        storage.executed_cross_chain.at(tx_hash).write(false);
        
        tx_hash
    }

    #[public]
    fn approve_cross_chain_tx(tx_hash: Field, signer_index: u8) {
        // Validate signer index
        assert(signer_index >= 1, "Signer index too low");
        assert(signer_index <= 3, "Signer index too high");
        
        // Check if already approved by this signer
        let already_approved = storage.cross_chain_approvals.at(tx_hash).at(signer_index).read();
        assert(!already_approved, "Already approved by this signer");
        
        // Check if already executed
        let already_executed = storage.executed_cross_chain.at(tx_hash).read();
        assert(!already_executed, "Transaction already executed");
        
        // Add approval
        storage.cross_chain_approvals.at(tx_hash).at(signer_index).write(true);
        let current_count = storage.cross_chain_approval_count.at(tx_hash).read();
        storage.cross_chain_approval_count.at(tx_hash).write(current_count + 1);
    }

    #[public]
    fn execute_cross_chain_tx(
        nonce: u32,
        target_chain: u16,
        target_contract: [u8; 32],
        amount: u128,
        recipient: [u8; 32],
        payload: [u8; 64],
    ) -> bool {
        // Recreate transaction hash
        let tx_hash = pedersen_hash([
            nonce as Field,
            target_chain as Field,
            bytes32_to_field(target_contract),
            amount as Field,
            bytes32_to_field(recipient),
            bytes64_to_field(payload),
        ], 0);
        
        // Check if already executed
        let already_executed = storage.executed_cross_chain.at(tx_hash).read();
        assert(!already_executed, "Transaction already executed");
        
        // Check if enough approvals
        let approval_count = storage.cross_chain_approval_count.at(tx_hash).read();
        let threshold = storage.threshold.read();
        assert(approval_count >= threshold, "Insufficient approvals");
        
        // Mark as executed
        storage.executed_cross_chain.at(tx_hash).write(true);
        
        // Prepare Wormhole message
        let wormhole_payload = encode_cross_chain_message(
            target_chain,
            target_contract,
            amount,
            recipient,
            payload,
            nonce,
        );
        
        // Send to portal for Wormhole emission
        let portal = storage.portal_address.read();
        context.message_portal(portal, wormhole_payload);
        
        true
    }

    #[public]
    fn handle_cross_chain_message(
        _emitter_chain: u16,
        emitter_address: [u8; 32],
        _sequence: u64,
        payload: [u8; 128],
    ) -> bool {
        // Verify emitter
        let trusted_emitter = storage.wormhole_emitter.read();
        let emitter_eth_address = bytes32_to_eth_address(emitter_address);
        assert(emitter_eth_address.eq(trusted_emitter), "Untrusted emitter");
        
        // Decode and process message
        let (action, target_addr, amount, data) = decode_cross_chain_message(payload);
        
        // Handle different action types
        if action == 1 {
            // Token transfer
            handle_incoming_transfer(target_addr, amount);
        } else if action == 2 {
            // Contract call
            handle_incoming_call(target_addr, data);
        }
        
        true
    }

    // UTILITY FUNCTIONS

    #[public]
    fn encode_cross_chain_message(
        target_chain: u16,
        target_contract: [u8; 32],
        amount: u128,
        recipient: [u8; 32],
        payload: [u8; 64],
        nonce: u32,
    ) -> Field {
        pedersen_hash([
            target_chain as Field,
            bytes32_to_field(target_contract),
            amount as Field,
            bytes32_to_field(recipient),
            bytes64_to_field(payload),
            nonce as Field,
        ], 1)
    }

    #[public]
    fn decode_cross_chain_message(payload: [u8; 128]) -> (u8, Field, u128, Field) {
        // Simplified decoding - in reality this would parse the byte array
        let action = payload[0];
        let target_addr = bytes_to_field(payload, 1, 32);
        let amount = bytes_to_u128(payload, 33, 16);
        let data = bytes_to_field(payload, 49, 32);
        
        (action, target_addr, amount, data)
    }

    #[public]
    fn handle_incoming_transfer(target: Field, amount: u128) {
        // Handle incoming cross-chain transfer
        // This would interact with token contracts
        let _ = target;
        let _ = amount;
    }

    #[public]
    fn handle_incoming_call(target: Field, data: Field) {
        // Handle incoming cross-chain contract calls
        let _ = target;
        let _ = data;
    }

    // Helper functions for byte conversions
    #[public]
    fn bytes32_to_field(bytes: [u8; 32]) -> Field {
        let mut result: Field = 0;
        for i in 0..32 {
            result = result * 256 + (bytes[i] as Field);
        }
        result
    }

    #[public]
    fn bytes64_to_field(bytes: [u8; 64]) -> Field {
        // Take first 32 bytes for Field conversion
        let mut result: Field = 0;
        for i in 0..31 { // Use 31 to avoid overflow
            result = result * 256 + (bytes[i] as Field);
        }
        result
    }

    #[public]
    fn bytes32_to_eth_address(bytes: [u8; 32]) -> EthAddress {
        // Take last 20 bytes as Ethereum address
        let mut addr_bytes: [u8; 20] = [0; 20];
        for i in 0..20 {
            addr_bytes[i] = bytes[i + 12];
        }
        EthAddress::from_field(bytes20_to_field(addr_bytes))
    }

    #[public]
    fn bytes20_to_field(bytes: [u8; 20]) -> Field {
        let mut result: Field = 0;
        for i in 0..20 {
            result = result * 256 + (bytes[i] as Field);
        }
        result
    }

    #[public]
    fn bytes_to_field(bytes: [u8; 128], offset: u32, length: u32) -> Field {
        let mut result: Field = 0;
        for i in 0..length {
            if (offset + i) < 128 {
                result = result * 256 + (bytes[offset + i] as Field);
            }
        }
        result
    }

    #[public]
    fn bytes_to_u128(bytes: [u8; 128], offset: u32, length: u32) -> u128 {
        let mut result: u128 = 0;
        for i in 0..length {
            if (offset + i) < 128 {
                if i < 16 {
                    result = result * 256 + (bytes[offset + i] as u128);
                }
            }
        }
        result
    }

    // VIEW FUNCTIONS

    #[public]
    fn get_threshold() -> u8 {
        storage.threshold.read()
    }

    #[public]
    fn get_pk(i: u8) -> (Field, Field) {
        (storage.pk_x.at(i).read(), storage.pk_y.at(i).read())
    }

    #[public]
    fn get_cross_chain_nonce() -> u32 {
        storage.cross_chain_nonce.read()
    }

    #[public]
    fn get_cross_chain_approval_count(tx_hash: Field) -> u8 {
        storage.cross_chain_approval_count.at(tx_hash).read()
    }

    #[public]
    fn has_approved_cross_chain(tx_hash: Field, signer_index: u8) -> bool {
        storage.cross_chain_approvals.at(tx_hash).at(signer_index).read()
    }

    #[public]
    fn is_cross_chain_executed(tx_hash: Field) -> bool {
        storage.executed_cross_chain.at(tx_hash).read()
    }

    #[public]
    fn get_portal_address() -> EthAddress {
        storage.portal_address.read()
    }

    #[public]
    fn get_wormhole_emitter() -> EthAddress {
        storage.wormhole_emitter.read()
    }
}