// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumIntentVault.sol";

contract DeployArbitrumIntentVault is Script {
    function run() external {
        vm.startBroadcast();

        ArbitrumIntentVault vault = new ArbitrumIntentVault(
            payable(0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35), // Wormhole on Arbitrum Sepolia 
            56,                                                    // Aztec chainId in Wormhole (not 23!)
            421614,                                               // Arbitrum Sepolia EVM chainId
            1,                                                    // finality
            0x781a68C3149d13D05a5F0C9E22C9D321d6f620E1           // donation contract (already deployed)
        );

        console.log("ArbitrumIntentVault deployed at:", address(vault));

        vm.stopBroadcast();
    }
}