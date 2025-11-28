// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/ArbitrumIntentVault.sol";

contract DeployMultisigProxy is Script {
    function run() external {
        uint256 deployerPrivateKey = uint256(
            0x40ff2cbeb0d3f3556fc8b047287eb05b7c8cf7abfd9840763e3c98dabf73c0da
        );
        // uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address wormholeAddress = 0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35;
        // address wormholeAddress = vm.envAddress("WORMHOLE_ADDRESS");
        uint16 aztecChainId = uint16(56);
        // uint16 aztecChainId = uint16(vm.envUint("AZTEC_CHAIN_ID"));
        address donationAddress = 0x5A53c5BEf870930E39A14090f8C922B731BeA142;
        // address donationAddress = vm.envAddress("DONATION_ADDRESS");

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
            421614, // Arbitrum Sepolia
            1, // finality
            donationAddress
        );

        // vault.registerEmitter(56, aztecEmitter); // 56 = Aztec Wormhole Chain ID

        vm.stopBroadcast();

        console.log("Multisig Proxy deployed at:", address(vault));
    }

    function _getNetworkConfig()
        internal
        view
        returns (
            address wormholeAddress,
            uint16 wormholeChainId,
            uint8 finality,
            bytes32 aztecEmitter
        )
    {
        if (block.chainid == 31337) {
            // Local Anvil - well-known addresses
            wormholeAddress = 0xC89Ce4735882C9F0f0FE26686c53074E09B0D550;
            wormholeChainId = 10003;
            finality = 2;
            aztecEmitter = 0x0f8a2300a7925c586135b1c142dc0b833f20d5c41ea6e815900d65d041e96cf5;
        } else if (block.chainid == 421614) {
            // Arbitrum Sepolia - can override via env vars
            wormholeAddress = vm.envOr(
                "WORMHOLE_ADDRESS",
                address(0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35)
            );
            wormholeChainId = uint16(
                vm.envOr("WORMHOLE_CHAIN_ID", uint256(10003))
            );
            finality = uint8(vm.envOr("FINALITY", uint256(2)));
            aztecEmitter = vm.envOr(
                "AZTEC_EMITTER_ADDRESS",
                bytes32(
                    0x0f8a2300a7925c586135b1c142dc0b833f20d5c41ea6e815900d65d041e96cf5
                )
            );
        } else {
            revert(
                string.concat(
                    "Unsupported chain ID: ",
                    vm.toString(block.chainid),
                    " (only local and testnet supported)"
                )
            );
        }
    }
}
