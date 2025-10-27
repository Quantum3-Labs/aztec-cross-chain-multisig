// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";
import {Portal} from "../src/Portal.sol";

contract DeployPortal is Script {
    function run() external {
        address inbox = vm.envAddress("ARB_INBOX");
        address l2Target = vm.envAddress("ARBITRUM_INTENT_VAULT");
        vm.startBroadcast();
        Portal p = new Portal(inbox, l2Target);
        vm.stopBroadcast();
        console2.log("Portal", address(p));
        console2.log("ARB_INBOX", inbox);
        console2.log("L2_TARGET", l2Target);
    }
}
