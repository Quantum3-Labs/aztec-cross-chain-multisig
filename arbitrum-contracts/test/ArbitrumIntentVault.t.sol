// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";
import "../src/ArbitrumIntentVault.sol";
import "../src/Donation.sol";
import "wormhole/src/testing/helpers/BytesLib.sol";

contract ArbitrumIntentVaultTest is Test {
    using BytesLib for bytes;
    ArbitrumIntentVault public vault;
    bytes public etherscanInput;

    function setUp() public {
        vault = new ArbitrumIntentVault(
            payable(0x6b9C8671cdDC8dEab9c719bB87cBd3e782bA6a35),
            56,
            421614,
            1,
            address(0x099eE5B61972498d7D14EF5AC443443aD72B7123)
        );

        etherscanInput = hex"000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000be0ffa496e2373bd9f51f2757ef36ae314715f59e7344bcbab44c6a7fa478141b70000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000066eee0000000000000000000000010ced3d98d221c97b47ac45fcd46e53c96d26d70000000000000000000000000000000000000000000000000000000000000000000b000000000000000000000035340673e33ef796b9a2d00db8b6a549205aabe40000";
    }

    function testDecodeEtherscanInput() public {
        vault._processIntentPayload(etherscanInput);
    }
}
