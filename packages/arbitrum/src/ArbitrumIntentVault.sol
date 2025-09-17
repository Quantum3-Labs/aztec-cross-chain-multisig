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
        require(payload.length >= 96, "Payload too short");

        bytes32 txId;
        assembly {
            txId := mload(add(payload, 32))
        }
        require(txId != bytes32(0), "Invalid txId");
        require(_state.arbitrumMessages[txId] == 0, "Already processed");

        uint256 intentTypeRaw;
        address targetAddress;
        uint256 amount;

        assembly {
            intentTypeRaw := mload(add(payload, 64))
            let addressData := mload(add(payload, 96))
            targetAddress := shr(96, addressData)
            amount := mload(add(payload, 128))
        }

        IntentType intentType = IntentType(intentTypeRaw);

        _state.arbitrumMessages[txId] = amount;
        intentAmounts[txId] = amount;
        intentTypes[txId] = intentType;
        intentTargets[txId] = targetAddress;

        emit IntentProcessed(txId, intentType, targetAddress, amount);

        bool success = _executeIntent(
            txId,
            intentType,
            targetAddress,
            amount,
            payload
        );
        emit IntentExecuted(txId, intentType, success);
    }

    function _executeIntent(
        bytes32 txId,
        IntentType intentType,
        address target,
        uint256 amount,
        bytes memory payload
    ) internal returns (bool) {
        if (intentType == IntentType.TRANSFER) {
            return _handleTransfer(target, amount);
        } else if (intentType == IntentType.SWAP) {
            return _handleSwap(txId, target, amount, payload);
        } else if (intentType == IntentType.MULTISIG_EXECUTE) {
            return _handleMultisigExecute(txId, target, payload);
        } else if (intentType == IntentType.BRIDGE) {
            return _handleBridge(txId, target, amount);
        }
        return false;
    }

    function _handleTransfer(
        address target,
        uint256 amount
    ) internal returns (bool) {
        if (amount > 0 && address(donationContract()) != address(0)) {
            donationContract().donate(amount);
            return true;
        }
        return false;
    }

    function _handleSwap(
        bytes32 txId,
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
        bytes32 txId,
        address target,
        bytes memory payload
    ) internal returns (bool) {
        if (payload.length > 160 && target != address(0)) {
            bytes memory callData = BytesLib.slice(
                payload,
                160,
                payload.length - 160
            );
            (bool success, ) = target.call(callData);
            return success;
        }
        return false;
    }

    function _handleBridge(
        bytes32 txId,
        address target,
        uint256 amount
    ) internal returns (bool) {
        if (amount > 0) {
            donationContract().donate(amount);
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

    function registerEmitter(
        uint16 chainId_,
        bytes32 emitterAddress_
    ) external onlyOwner {
        require(emitterAddress_ != bytes32(0), "Invalid emitter");
        _state.vaultImplementations[chainId_] = emitterAddress_;
    }
}
