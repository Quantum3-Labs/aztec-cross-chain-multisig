// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./BridgeToken.sol";

contract Donation is BridgeToken {
    address public receiver;
    event DonationMade(address donor, uint256 amount);

    constructor(address _receiver) BridgeToken("ProverToken", "PTZK", 1000000000000000000000) {
        receiver = _receiver;
    }

    function donate(uint256 amount) external {
        require(amount > 0, "Donation amount must be greater than zero");
        _mint(receiver, amount);
        emit DonationMade(receiver, amount);
    }
}
