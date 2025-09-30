// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumIntentVault.sol";

contract DeployArbitrumIntentVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address wormholeAddress = vm.envAddress("WORMHOLE_ADDRESS");
        uint16 aztecChainId = uint16(vm.envUint("AZTEC_CHAIN_ID"));
        address donationAddress = vm.envAddress("DONATION_ADDRESS");
        
        console.log("=== Deploying ArbitrumIntentVault ===");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Wormhole:", wormholeAddress);
        console.log("Aztec Chain ID:", aztecChainId);
        console.log("Donation:", donationAddress);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        ArbitrumIntentVault vault = new ArbitrumIntentVault(
            payable(wormholeAddress),
            aztecChainId,
            421614,  // Arbitrum Sepolia
            1,       // finality
            donationAddress
        );

        vm.stopBroadcast();

        console.log("ArbitrumIntentVault deployed at:", address(vault));
    }
}