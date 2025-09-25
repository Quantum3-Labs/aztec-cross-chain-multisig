// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {Donation} from "../src/Donation.sol";

contract DeployDonation is Script {
    function run() external {
        address receiver = vm.envAddress("DONATION_RECEIVER");
        vm.startBroadcast();
        Donation d = new Donation(receiver);
        vm.stopBroadcast();
        console2.log("DONATION", address(d));
        console2.log("RECEIVER", receiver);
    }
}
