// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "wormhole/src/testing/helpers/BytesLib.sol";
import "./VaultGetters.sol";

contract ArbitrumIntentVault is VaultGetters {
    using BytesLib for bytes;

    enum IntentType {
        TRANSFER,
        SWAP,
        BRIDGE,
        MULTISIG_EXECUTE,
        CUSTOM
    }

    mapping(bytes32 => uint256) public intentAmounts;
    mapping(bytes32 => IntentType) public intentTypes;
    mapping(bytes32 => address) public intentTargets;
    mapping(bytes32 => address) public intentRecipients;

    event IntentProcessed(
        bytes32 indexed txId,
        uint16 targetChain,
        address targetContract,
        IntentType intentType,
        uint256 amount,
        address recipient
    );

    event IntentExecuted(
        bytes32 indexed txId,
        IntentType intentType,
        bool success
    );

    constructor(
        address payable wormholeAddr,
        uint16 chainId_,
        uint256 evmChainId_,
        uint8 finality_,
        address donationContractAddr
    )
        VaultGetters(
            wormholeAddr,
            chainId_,
            evmChainId_,
            finality_,
            donationContractAddr
        )
    {}

    function verifyAndProcessIntent(bytes memory encodedVm) external {
        bytes memory payload = _verify(encodedVm);
        _processIntentPayload(payload);
    }

    function _verify(
        bytes memory encodedVm
    ) internal view returns (bytes memory) {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole()
            .parseAndVerifyVM(encodedVm);
        require(valid, reason);

        bytes32 registeredEmitter = vaultContracts(vm.emitterChainId);
        require(registeredEmitter == vm.emitterAddress, "Invalid emitter");

        return vm.payload;
    }

    function _processIntentPayload(bytes memory payload) internal {
        require(payload.length >= 186, "Payload too short");

        // Parse according to Aztec payload structure:
        // [0] message_hash (31 bytes)
        // [1] target_chain (31 bytes)
        // [2] target_contract (31 bytes)
        // [3] intent_type (31 bytes)
        // [4] amount (31 bytes)
        // [5] recipient (31 bytes)

        bytes32 messageHash = bytes32(bytes.concat(bytes1(0), BytesLib.slice(payload, 0, 31)));
        
        uint16 targetChain = uint16(uint256(bytes32(bytes.concat(bytes1(0), BytesLib.slice(payload, 31, 31)))));
        
        bytes memory targetContractBytes = BytesLib.slice(payload, 62 + 11, 20);
        address targetContract = address(uint160(bytes20(targetContractBytes)));
        
        uint256 intentTypeRaw = uint256(bytes32(bytes.concat(bytes1(0), BytesLib.slice(payload, 93, 31))));
        
        uint256 amount = uint256(bytes32(bytes.concat(bytes1(0), BytesLib.slice(payload, 124, 31))));
        
        bytes memory recipientBytes = BytesLib.slice(payload, 155 + 11, 20);
        address recipient = address(uint160(bytes20(recipientBytes)));

        require(messageHash != bytes32(0), "Invalid message hash");
        require(_state.arbitrumMessages[messageHash] == 0, "Already processed");
        require(targetChain == chainId(), "Wrong chain");

        IntentType intentType = IntentType(intentTypeRaw);

        _state.arbitrumMessages[messageHash] = amount;
        intentAmounts[messageHash] = amount;
        intentTypes[messageHash] = intentType;
        intentTargets[messageHash] = targetContract;
        intentRecipients[messageHash] = recipient;

        emit IntentProcessed(messageHash, targetChain, targetContract, intentType, amount, recipient);

        bool success = _executeIntent(
            messageHash,
            intentType,
            targetContract,
            recipient,
            amount,
            payload
        );
        emit IntentExecuted(messageHash, intentType, success);
    }

    function _executeIntent(
        bytes32 messageHash,
        IntentType intentType,
        address target,
        address recipient,
        uint256 amount,
        bytes memory payload
    ) internal returns (bool) {
        if (intentType == IntentType.TRANSFER) {
            return _handleTransfer(recipient, amount);
        } else if (intentType == IntentType.SWAP) {
            return _handleSwap(messageHash, target, amount, payload);
        } else if (intentType == IntentType.MULTISIG_EXECUTE) {
            return _handleMultisigExecute(messageHash, target, payload);
        } else if (intentType == IntentType.BRIDGE) {
            return _handleBridge(messageHash, recipient, amount);
        }
        return false;
    }

    function _handleTransfer(
        address recipient,
        uint256 amount
    ) internal returns (bool) {
        if (amount > 0 && address(donationContract()) != address(0)) {
            donationContract().donate(amount);
            return true;
        }
        return false;
    }

    function _handleSwap(
        bytes32 messageHash,
        address target,
        uint256 amount,
        bytes memory payload
    ) internal returns (bool) {
        if (amount > 0) {
            donationContract().donate(amount);
            return true;
        }
        return false;
    }

    function _handleMultisigExecute(
        bytes32 messageHash,
        address target,
        bytes memory payload
    ) internal returns (bool) {
        if (payload.length > 186 && target != address(0)) {
            bytes memory callData = BytesLib.slice(
                payload,
                186,
                payload.length - 186
            );
            (bool success, ) = target.call(callData);
            return success;
        }
        return false;
    }

    function _handleBridge(
        bytes32 messageHash,
        address recipient,
        uint256 amount
    ) internal returns (bool) {
        if (amount > 0) {
            donationContract().donate(amount);
            return true;
        }
        return false;
    }

    function getIntentData(
        bytes32 messageHash
    )
        external
        view
        returns (uint256 amount, IntentType intentType, address target, address recipient)
    {
        amount = intentAmounts[messageHash];
        intentType = intentTypes[messageHash];
        target = intentTargets[messageHash];
        recipient = intentRecipients[messageHash];
    }

    function registerEmitter(
        uint16 chainId_,
        bytes32 emitterAddress_
    ) external onlyOwner {
        require(emitterAddress_ != bytes32(0), "Invalid emitter");
        _state.vaultImplementations[chainId_] = emitterAddress_;
    }
}