// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IInbox {
    function createRetryableTicket(
        address to,
        uint256 l2CallValue,
        uint256 maxSubmissionCost,
        address excessFeeRefundAddress,
        address callValueRefundAddress,
        uint256 gasLimit,
        uint256 maxFeePerGas,
        bytes calldata data
    ) external payable returns (uint256);
}

contract Portal {
    address public owner;
    address public inbox;
    address public l2Target;

    event Forwarded(uint256 ticketId);

    modifier onlyOwner() {
        require(msg.sender == owner, "!owner");
        _;
    }

    constructor(address _inbox, address _l2Target) {
        owner = msg.sender;
        inbox = _inbox;
        l2Target = _l2Target;
    }

    function setParams(address _inbox, address _l2Target) external onlyOwner {
        inbox = _inbox;
        l2Target = _l2Target;
    }

    function forwardToArbitrum(
        uint32 nonce,
        uint16 targetChain,
        address targetContract,
        uint128 amount,
        bytes32 recipient,
        uint8 intentType,
        bytes calldata data,
        uint256 maxSubmissionCost,
        uint256 gasLimit,
        uint256 maxFeePerGas,
        address refund
    ) external payable returns (uint256 ticketId) {
        bytes memory callData = abi.encodeWithSignature(
            "handleFromL1(uint32,uint16,address,uint128,bytes32,uint8,bytes)",
            nonce,
            targetChain,
            targetContract,
            amount,
            recipient,
            intentType,
            data
        );
        ticketId = IInbox(inbox).createRetryableTicket{value: msg.value}(
            l2Target,
            0,
            maxSubmissionCost,
            refund,
            refund,
            gasLimit,
            maxFeePerGas,
            callData
        );
        emit Forwarded(ticketId);
    }
}
