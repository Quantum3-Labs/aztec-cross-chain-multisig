// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "wormhole/src/testing/helpers/BytesLib.sol";
import "./VaultGetters.sol";

contract ArbitrumIntentVault is VaultGetters {
    using BytesLib for bytes;

    enum IntentType {
        NONE,
        TRANSFER
    }

    mapping(bytes32 => uint256) public intentAmounts;
    mapping(bytes32 => IntentType) public intentTypes;
    mapping(bytes32 => address) public intentTargets;

    event EmitterRegistered(uint16 indexed chainId, bytes32 emitterAddress);
    event IntentProcessed(
        bytes32 indexed txId,
        IntentType intentType,
        address target,
        uint256 amount
    );
    event IntentExecuted(
        bytes32 indexed txId,
        IntentType intentType,
        bool success
    );
    event PayloadDebug(bytes32 payload);
    event DebugUint256(uint256 amount);
    event DebugAddress(address recipient);

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

    function registerEmitter(
        uint16 chainId_,
        bytes32 emitterAddress_
    ) external onlyOwner {
        require(
            emitterAddress_ != bytes32(0),
            "Emitter address cannot be zero"
        );

        _state.registeredEmitters[chainId_] = emitterAddress_;

        emit EmitterRegistered(chainId_, emitterAddress_);
    }

    function verify(bytes memory encodedVm) external {
        bytes memory payload = _verify(encodedVm);
        _processIntentPayload(payload);
    }

    function _verify(
        bytes memory encodedVm
    ) internal view returns (bytes memory) {
        // Parse and verify the VAA through Wormhole
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole()
            .parseAndVerifyVM(encodedVm);

        // Ensure the VAA signature is valid
        require(valid, reason);

        return vm.payload;
    }

    function _processIntentPayload(bytes memory payload) internal {
        require(!isFork(), "Invalid fork: expected chainID mismatch");
        // Payload structure: 32-byte chunks
        // [txId (32), action (32), target_chain (32), target_contract (32), intent_type (32), amount (32), recipient (32), ...]
        require(payload.length >= 127, "Payload too short");

        bytes32 txId;
        assembly {
            txId := mload(add(payload, 32))
        }
        emit PayloadDebug(txId);

        // extract target chain
        bytes32 targetChain;
        assembly {
            targetChain := mload(add(payload, 64))
            targetChain := shr(8, targetChain)
        }
        uint256 targetChainId = uint256(targetChain);
        require(targetChainId == block.chainid, "Invalid target chain");

        // extract target contract
        bytes32 targetContract;
        assembly {
            targetContract := mload(add(payload, 96))
            targetContract := shr(12, targetContract)
            targetContract := shl(92, targetContract)
        }
        // turn target contract to address
        address targetContractAddress = address(
            uint160(bytes20(targetContract))
        );
        emit DebugAddress(targetContractAddress);
        emit DebugAddress(address(this));
        require(
            targetContractAddress == address(this),
            "Invalid target contract"
        );

        // extract intent type
        bytes32 intentType;
        assembly {
            intentType := mload(add(payload, 127))
            intentType := shr(16, intentType)
        }
        IntentType intentTypeEnum = IntentType(uint256(intentType));

        // extract amount
        bytes32 amount;
        assembly {
            amount := mload(add(payload, 160))
            amount := shr(8, amount)
        }
        uint256 amountUint = uint256(amount);
        require(amountUint > 0, "Invalid amount");

        // extract recipient
        bytes32 recipient;
        assembly {
            recipient := mload(add(payload, 192))
            recipient := shr(16, recipient)
            recipient := shl(96, recipient)
        }
        // turn bytes32 to address
        address recipientAddress = address(bytes20(recipient));
        require(recipientAddress != address(0), "Invalid recipient");

        _state.arbitrumMessages[txId] = amountUint;
        intentAmounts[txId] = amountUint;
        intentTypes[txId] = intentTypeEnum;
        intentTargets[txId] = recipientAddress;

        emit IntentProcessed(
            txId,
            intentTypeEnum,
            recipientAddress,
            amountUint
        );

        bool success = _executeIntent(
            intentTypeEnum,
            recipientAddress,
            amountUint
        );
        emit IntentExecuted(txId, intentTypeEnum, success);
    }

    function _executeIntent(
        IntentType intentType,
        address target,
        uint256 amount
    ) internal returns (bool) {
        if (intentType == IntentType.TRANSFER) {
            return _handleTransfer(target, amount);
        }
        return false;
    }

    function _handleTransfer(
        address target,
        uint256 amount
    ) internal returns (bool) {
        if (amount > 0) {
            // transfer eth to target
            donationContract().donate(amount, target);
            return true;
        }
        return false;
    }

    function getIntentData(
        bytes32 txId
    )
        external
        view
        returns (uint256 amount, IntentType intentType, address target)
    {
        amount = intentAmounts[txId];
        intentType = intentTypes[txId];
        target = intentTargets[txId];
    }

    function verifyAuthorizedEmitter(
        IWormhole.VM memory vm
    ) internal view returns (bool) {
        // Check if the emitter is registered for this chain
        bytes32 registeredEmitter = getRegisteredEmitter(vm.emitterChainId);

        // Return true if the emitter matches the registered one
        return registeredEmitter == vm.emitterAddress;
    }
}
