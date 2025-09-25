// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IDonation {
    function donate(uint256 amount) external;
}

library AddressAliasHelper {
    uint160 constant OFFSET = uint160(0x1111000000000000000000000000000000001111);
    function applyL1ToL2Alias(address l1Address) internal pure returns (address) {
        return address(uint160(l1Address) + OFFSET);
    }
}

contract ArbitrumIntentVault is Ownable {
    enum IntentType { TRANSFER, SWAP, BRIDGE, MULTISIG_EXECUTE, CUSTOM }

    address public immutable l1Portal;
    IDonation public donationContract;

    mapping(bytes32 => uint256) public intentAmounts;
    mapping(bytes32 => IntentType) public intentTypes;
    mapping(bytes32 => address) public intentTargets;
    mapping(bytes32 => bool) public processed;

    event IntentProcessed(bytes32 indexed txId, IntentType intentType, address target, uint256 amount);
    event IntentExecuted(bytes32 indexed txId, IntentType intentType, bool success);

    modifier onlyL1PortalAlias() {
        require(msg.sender == AddressAliasHelper.applyL1ToL2Alias(l1Portal), "not l1 portal alias");
        _;
    }

    constructor(address _l1Portal, address _donation) Ownable(msg.sender) {
        l1Portal = _l1Portal;
        donationContract = IDonation(_donation);
    }

    function setDonation(address d) external onlyOwner {
        donationContract = IDonation(d);
    }

    function handleFromL1(
        uint32 nonce,
        uint16 targetChain,
        address targetContract,
        uint128 amount,
        bytes32 recipient,
        uint8 intentType,
        bytes calldata data
    ) external onlyL1PortalAlias {
        bytes32 txId = keccak256(abi.encode(nonce, targetChain, targetContract, amount, recipient, intentType));
        require(!processed[txId], "already processed");
        processed[txId] = true;

        IntentType it = IntentType(intentType);
        intentAmounts[txId] = amount;
        intentTypes[txId] = it;
        intentTargets[txId] = targetContract;

        emit IntentProcessed(txId, it, targetContract, amount);
        bool ok = _executeIntent(txId, it, targetContract, amount, data);
        emit IntentExecuted(txId, it, ok);
    }

    function _executeIntent(
        bytes32,
        IntentType it,
        address target,
        uint256 amount,
        bytes calldata data
    ) internal returns (bool) {
        if (it == IntentType.MULTISIG_EXECUTE) {
            if (target == address(0)) return false;
            (bool s,) = target.call(data);
            return s;
        }
        if (it == IntentType.TRANSFER || it == IntentType.SWAP || it == IntentType.BRIDGE) {
            if (address(donationContract) == address(0)) return false;
            if (amount == 0) return true;
            donationContract.donate(amount);
            return true;
        }
        return false;
    }

    function getIntentData(bytes32 txId)
        external
        view
        returns (uint256 amount, IntentType intentType, address target)
    {
        amount = intentAmounts[txId];
        intentType = intentTypes[txId];
        target = intentTargets[txId];
    }
}
