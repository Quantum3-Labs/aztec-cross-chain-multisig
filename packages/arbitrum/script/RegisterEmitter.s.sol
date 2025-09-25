// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "forge-std/console2.sol";

interface IIntentVault {
    function registerEmitter(uint16 chainId_, bytes32 emitterAddress_) external;
    function vaultContracts(uint16 chainId_) external view returns (bytes32);
    function vaultImplementations(uint16 chainId_) external view returns (bytes32);
}

contract RegisterEmitter is Script {
    function run() external {
        address vault = vm.envAddress("ARBITRUM_INTENT_VAULT");
        address portal = vm.envAddress("PORTAL");
        uint16 aztecChainId = uint16(vm.envUint("AZTEC_CHAIN_ID"));

        bytes32 emitterB32 = bytes32(uint256(uint160(portal)));

        vm.startBroadcast();
        IIntentVault(vault).registerEmitter(aztecChainId, emitterB32);
        vm.stopBroadcast();

        bytes32 got;
        try IIntentVault(vault).vaultContracts(aztecChainId) returns (bytes32 v) {
            got = v;
        } catch {
            got = IIntentVault(vault).vaultImplementations(aztecChainId);
        }

        console2.log("ARBITRUM_INTENT_VAULT", vault);
        console2.log("PORTAL", portal);
        console2.log("AZTEC_CHAIN_ID", aztecChainId);
        console2.logBytes32(got);
    }
}
