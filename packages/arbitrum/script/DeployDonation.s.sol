// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Donation.sol";

contract DeployDonation is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address donationReceiver = vm.envAddress("DONATION_RECEIVER");
        
        console.log("=== Deploying Donation Contract ===");
        console.log("Deployer:", vm.addr(deployerPrivateKey));
        console.log("Receiver:", donationReceiver);
        console.log("");
        
        vm.startBroadcast(deployerPrivateKey);
        
        Donation donation = new Donation(donationReceiver);
        
        vm.stopBroadcast();
        
        console.log("Donation deployed at:", address(donation));
        console.log("Token Name: ProverToken");
        console.log("Token Symbol: PTZK");
    }
}