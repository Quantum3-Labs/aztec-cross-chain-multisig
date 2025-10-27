// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumIntentVault.sol";
import "../src/Donation.sol";

contract VerifySetup is Script {
    function run() external view {
        address vaultAddress = vm.envAddress("ARBITRUM_INTENT_VAULT");
        address donationAddress = vm.envAddress("DONATION_ADDRESS");
        uint16 aztecChainId = uint16(vm.envUint("AZTEC_CHAIN_ID"));
        bytes32 expectedEmitter = vm.envBytes32("AZTEC_ACCOUNT_ADDRESS");
        
        console.log("=== Verifying Deployment ===\n");
        
        // Verify Donation
        Donation donation = Donation(donationAddress);
        console.log("1. Donation Contract");
        console.log("   Address:", donationAddress);
        console.log("   Receiver:", donation.receiver());
        console.log("   Token:", donation.name(), donation.symbol());
        console.log("");
        
        // Verify Vault
        ArbitrumIntentVault vault = ArbitrumIntentVault(vaultAddress);
        console.log("2. ArbitrumIntentVault");
        console.log("   Address:", vaultAddress);
        console.log("   Wormhole:", address(vault.wormhole()));
        console.log("   Chain ID:", vault.chainId());
        console.log("   EVM Chain ID:", vault.evmChainId());
        console.log("   Donation:", address(vault.donationContract()));
        console.log("");
        
        // Verify Emitter Registration
        bytes32 registeredEmitter = vault.vaultContracts(aztecChainId);
        console.log("3. Emitter Registration");
        console.log("   Aztec Chain ID:", aztecChainId);
        console.log("   Expected Emitter:");
        console.logBytes32(expectedEmitter);
        console.log("   Registered Emitter:");
        console.logBytes32(registeredEmitter);
        console.log("");
        
        if (registeredEmitter == expectedEmitter && registeredEmitter != bytes32(0)) {
            console.log("Status: VERIFIED");
        } else if (registeredEmitter == bytes32(0)) {
            console.log("Status: NOT REGISTERED - Run 'make register'");
        } else {
            console.log("Status: MISMATCH - Registration incorrect!");
        }
    }
}