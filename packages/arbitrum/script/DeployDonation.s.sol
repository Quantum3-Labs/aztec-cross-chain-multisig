// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Donation.sol";

contract DeployDonation is Script {
    function run() external {
        vm.startBroadcast();
        new Donation(0x2dA2d9CCC37dA7A4103C67247D51b48FfcBe2296);
        vm.stopBroadcast();
    }
}
