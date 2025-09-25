// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {ArbitrumIntentVault} from "../src/ArbitrumIntentVault.sol";

contract DeployArbitrumIntentVault is Script {
    function run() external {
        address l1Portal = vm.envAddress("SEPOLIA_PORTAL");
        address donation = vm.envAddress("DONATION_ADDRESS");
        vm.startBroadcast();
        ArbitrumIntentVault v = new ArbitrumIntentVault(l1Portal, donation);
        vm.stopBroadcast();
        console2.log("ArbitrumIntentVault", address(v));
        console2.log("L1_PORTAL", l1Portal);
        console2.log("DONATION", donation);
    }
}
