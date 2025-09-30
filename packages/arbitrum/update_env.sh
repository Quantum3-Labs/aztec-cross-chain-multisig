#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}================================================${NC}"
echo -e "${YELLOW}📝 Updating .env with deployed addresses...${NC}"
echo -e "${BLUE}================================================${NC}\n"

update_env() {
    local key=$1
    local value=$2
    
    if [ -z "$value" ] || [ "$value" == "null" ]; then
        echo -e "${YELLOW}⚠️  No value found for ${key}, skipping...${NC}"
        return
    fi
    
    if grep -q "^${key}=" .env 2>/dev/null; then
        sed -i '' "s|^${key}=.*|${key}=${value}|" .env
        echo -e "${GREEN}✓ Updated: ${key}=${value}${NC}"
    else
        echo "${key}=${value}" >> .env
        echo -e "${GREEN}✓ Added: ${key}=${value}${NC}"
    fi
}

DONATION_JSON="broadcast/DeployDonation.s.sol/421614/run-latest.json"
if [ -f "$DONATION_JSON" ]; then
    echo -e "${BLUE}Reading Donation deployment...${NC}"
    DONATION=$(jq -r '.transactions[0].contractAddress' "$DONATION_JSON" 2>/dev/null)
    if [ -n "$DONATION" ] && [ "$DONATION" != "null" ]; then
        update_env "DONATION_ADDRESS" "$DONATION"
    fi
fi

VAULT_JSON="broadcast/DeployArbitrumIntentVault.s.sol/421614/run-latest.json"
if [ -f "$VAULT_JSON" ]; then
    echo -e "${BLUE}Reading Vault deployment...${NC}"
    VAULT=$(jq -r '.transactions[0].contractAddress' "$VAULT_JSON" 2>/dev/null)
    if [ -n "$VAULT" ] && [ "$VAULT" != "null" ]; then
        update_env "ARBITRUM_INTENT_VAULT" "$VAULT"
    fi
fi

echo -e "\n${GREEN}✅ .env updated successfully!${NC}"
echo -e "${BLUE}================================================${NC}\n"