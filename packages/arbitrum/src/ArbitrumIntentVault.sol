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
    mapping(bytes32 => uint64) public intentNonces;
    mapping(bytes32 => uint64) public intentDeadlines;

    event IntentProcessed(
        bytes32 indexed messageHash,
        uint16 targetChain,
        address targetContract,
        IntentType intentType,
        uint256 amount,
        address recipient,
        uint64 nonce,
        uint64 deadline
    );

    event IntentExecuted(
        bytes32 indexed messageHash,
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
        // Aztec sends 8 Fields × 31 bytes = 248 bytes
        // [action, targetChain, targetContract, intentType, amount, recipient, nonce, deadline]
        require(payload.length >= 248, "Payload too short");

        // Parse fields (each is 31 bytes, padded left with 0x00)
        uint256 action = uint256(bytes32(bytes.concat(bytes1(0), payload.slice(0, 31))));
        require(action == 6, "Invalid action"); // Must be CROSS_CHAIN_INTENT
        
        uint16 targetChain = uint16(uint256(bytes32(bytes.concat(bytes1(0), payload.slice(31, 31)))));
        
        // targetContract: 31 bytes -> extract last 20 bytes for address
        address targetContract = address(uint160(bytes20(payload.slice(43, 20))));
        
        uint256 intentTypeRaw = uint256(bytes32(bytes.concat(bytes1(0), payload.slice(62, 31))));
        IntentType intentType = IntentType(intentTypeRaw);
        
        uint256 amount = uint256(bytes32(bytes.concat(bytes1(0), payload.slice(93, 31))));
        
        // recipient: 31 bytes -> extract last 20 bytes for address
        address recipient = address(uint160(bytes20(payload.slice(136, 20))));
        
        uint64 nonce = uint64(uint256(bytes32(bytes.concat(bytes1(0), payload.slice(155, 31)))));
        
        uint64 deadline = uint64(uint256(bytes32(bytes.concat(bytes1(0), payload.slice(186, 31)))));

        // Compute message hash from Aztec data
        bytes32 messageHash = keccak256(abi.encodePacked(
            action,
            targetChain,
            targetContract,
            intentTypeRaw,
            amount,
            recipient,
            nonce,
            deadline
        ));

        require(messageHash != bytes32(0), "Invalid message hash");
        require(_state.arbitrumMessages[messageHash] == 0, "Already processed");
        require(targetChain == chainId(), "Wrong chain");
        require(block.timestamp <= deadline, "Intent expired");

        // Store intent data
        _state.arbitrumMessages[messageHash] = amount;
        intentAmounts[messageHash] = amount;
        intentTypes[messageHash] = intentType;
        intentTargets[messageHash] = targetContract;
        intentRecipients[messageHash] = recipient;
        intentNonces[messageHash] = nonce;
        intentDeadlines[messageHash] = deadline;

        emit IntentProcessed(
            messageHash,
            targetChain,
            targetContract,
            intentType,
            amount,
            recipient,
            nonce,
            deadline
        );

        // Execute intent
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
        if (amount > 0 && address(donationContract()) != address(0) && recipient != address(0)) {
            (bool success, ) = address(donationContract()).call(
                abi.encodeWithSignature("processWithdrawal(address,uint256)", recipient, amount)
            );
            return success;
        }
        return false;
    }

    function _handleSwap(
        bytes32,
        address,
        uint256 amount,
        bytes memory
    ) internal returns (bool) {
        if (amount > 0) {
            donationContract().donate(amount);
            return true;
        }
        return false;
    }

    function _handleMultisigExecute(
        bytes32,
        address target,
        bytes memory payload
    ) internal returns (bool) {
        // callData starts after 248 bytes of header
        if (payload.length > 248 && target != address(0)) {
            bytes memory callData = BytesLib.slice(
                payload,
                248,
                payload.length - 248
            );
            (bool success, ) = target.call(callData);
            return success;
        }
        return false;
    }

    function _handleBridge(
        bytes32,
        address,
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
        returns (
            uint256 amount,
            IntentType intentType,
            address target,
            address recipient,
            uint64 nonce,
            uint64 deadline
        )
    {
        amount = intentAmounts[messageHash];
        intentType = intentTypes[messageHash];
        target = intentTargets[messageHash];
        recipient = intentRecipients[messageHash];
        nonce = intentNonces[messageHash];
        deadline = intentDeadlines[messageHash];
    }

    function registerEmitter(
        uint16 chainId_,
        bytes32 emitterAddress_
    ) external onlyOwner {
        require(emitterAddress_ != bytes32(0), "Invalid emitter");
        _state.vaultImplementations[chainId_] = emitterAddress_;
    }
}