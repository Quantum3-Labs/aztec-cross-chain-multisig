// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Donation
 * @dev Token contract that can receive deposits and process withdrawals
 */
contract Donation is ERC20, Ownable {
    address public receiver;
    
    event DonationMade(address indexed donor, uint256 amount);
    event WithdrawalProcessed(address indexed recipient, uint256 amount);
    event Deposited(address indexed depositor, uint256 amount);

    constructor(address _receiver) ERC20("ProverToken", "PTZK") Ownable(msg.sender) {
        receiver = _receiver;
        // Mint initial supply to contract for demo
        _mint(address(this), 1000000 * 10**18);
    }

    /**
     * @notice Deposit tokens to the contract
     */
    function deposit(uint256 amount) external {
        require(amount > 0, "Amount must be greater than zero");
        _transfer(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /**
     * @notice Donate tokens (mint new tokens to receiver)
     */
    function donate(uint256 amount) external {
        require(amount > 0, "Donation amount must be greater than zero");
        _mint(receiver, amount);
        emit DonationMade(receiver, amount);
    }

    /**
     * @notice Process withdrawal (transfer existing tokens)
     * @dev Called by ArbitrumIntentVault
     */
    function processWithdrawal(address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Amount must be greater than zero");
        require(balanceOf(address(this)) >= amount, "Insufficient balance");
        
        _transfer(address(this), recipient, amount);
        emit WithdrawalProcessed(recipient, amount);
    }

    /**
     * @notice Get contract balance
     */
    function getBalance() external view returns (uint256) {
        return balanceOf(address(this));
    }
}