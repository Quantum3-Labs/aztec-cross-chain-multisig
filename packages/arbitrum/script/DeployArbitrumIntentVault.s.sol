// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumIntentVault.sol";

contract DeployArbitrumIntentVault is Script {
    function run() external {
        vm.startBroadcast();

        new ArbitrumIntentVault(
            payable(0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C), // wormhole
            23,                                                 // chainId_
            421614,                                             // evmChainId_
            1,                                                  // finality_
            0x781a68C3149d13D05a5F0C9E22C9D321d6f620E1          // donation contract
        );

        vm.stopBroadcast();
    }
}
