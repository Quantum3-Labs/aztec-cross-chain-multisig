// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumIntentVault.sol";

contract RegisterEmitter is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address vaultAddress = vm.envAddress("ARBITRUM_INTENT_VAULT");
        uint16 aztecChainId = uint16(vm.envUint("AZTEC_CHAIN_ID"));
        bytes32 aztecAccountAddress = vm.envBytes32("AZTEC_ACCOUNT_ADDRESS");
        
        console.log("=== Registering Aztec Emitter ===");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Vault:", vaultAddress);
        console.log("Aztec Chain ID:", aztecChainId);
        console.log("Aztec Account:");
        console.logBytes32(aztecAccountAddress);
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);

        ArbitrumIntentVault vault = ArbitrumIntentVault(vaultAddress);
        vault.registerEmitter(aztecChainId, aztecAccountAddress);

        vm.stopBroadcast();
        
        console.log("Emitter registered successfully!");
    }
}