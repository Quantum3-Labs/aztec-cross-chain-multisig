-include .env

.PHONY: setup deploy-donation deploy-vault register verify all clean

# Colors
GREEN := \033[0;32m
YELLOW := \033[1;33m
BLUE := \033[0;34m
NC := \033[0m

setup:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)🔧 Setting up environment...$(NC)"
	@echo "$(BLUE)================================================$(NC)"
	@mkdir -p script broadcast
	@chmod +x update_env.sh
	@echo "$(GREEN)✅ Setup complete!$(NC)\n"

deploy-donation:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)🚀 Step 1: Deploying Donation Contract$(NC)"
	@echo "$(BLUE)================================================$(NC)"
	@forge script script/DeployDonation.s.sol \
		--fork-url $(ARBITRUM_RPC) \
		--broadcast \
		-vvvv
	@echo ""
	@bash ./update_env.sh
	@echo "$(GREEN)✅ Step 1 Complete: Donation deployed!$(NC)\n"
	@sleep 2

deploy-vault:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)🚀 Step 2: Deploying ArbitrumIntentVault$(NC)"
	@echo "$(BLUE)================================================$(NC)"
	@forge script script/DeployArbitrumIntentVault.s.sol \
		--fork-url $(ARBITRUM_RPC) \
		--broadcast \
		-vvvv
	@echo ""
	@bash ./update_env.sh
	@echo "$(GREEN)✅ Step 2 Complete: Vault deployed!$(NC)\n"
	@sleep 2

register:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)📝 Step 3: Registering Aztec Emitter$(NC)"
	@echo "$(BLUE)================================================$(NC)"
	@forge script script/RegisterEmitter.s.sol \
		--fork-url $(ARBITRUM_RPC) \
		--broadcast \
		-vvvv
	@echo ""
	@echo "$(GREEN)✅ Step 3 Complete: Emitter registered!$(NC)\n"
	@sleep 2

verify:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)🔍 Step 4: Verifying Setup$(NC)"
	@echo "$(BLUE)================================================$(NC)"
	@forge script script/VerifySetup.s.sol \
		--fork-url $(ARBITRUM_RPC) \
		-vvvv
	@echo ""
	@echo "$(GREEN)✅ Step 4 Complete: Verification done!$(NC)\n"

clean:
	@echo "$(YELLOW)🧹 Cleaning build artifacts...$(NC)"
	@forge clean
	@rm -rf broadcast/ cache/ out/
	@echo "$(GREEN)✅ Clean complete!$(NC)\n"

all:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)🎯 Running Full Deployment Pipeline$(NC)"
	@echo "$(BLUE)================================================$(NC)\n"
	@$(MAKE) deploy-donation
	@$(MAKE) deploy-vault
	@$(MAKE) register
	@$(MAKE) verify
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(GREEN)🎉 All Steps Completed Successfully!$(NC)"
	@echo "$(BLUE)================================================$(NC)\n"

status:
	@echo "$(BLUE)================================================$(NC)"
	@echo "$(YELLOW)📊 Current Deployment Status$(NC)"
	@echo "$(BLUE)================================================$(NC)"
	@echo "DONATION_ADDRESS: $(DONATION_ADDRESS)"
	@echo "ARBITRUM_INTENT_VAULT: $(ARBITRUM_INTENT_VAULT)"
	@echo "AZTEC_ACCOUNT_ADDRESS: $(AZTEC_ACCOUNT_ADDRESS)"
	@echo "$(BLUE)================================================$(NC)\n"