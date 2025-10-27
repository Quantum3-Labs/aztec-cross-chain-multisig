# Test Scripts with Deployment Caching

This directory contains test scripts with deployment caching functionality to avoid redeploying contracts every time.

## Features

- **Deployment Caching**: Automatically caches deployment details in `deployment-cache.json`
- **Smart Cache Management**: Uses cached deployments when available, deploys fresh when needed
- **Command Line Options**: Control cache behavior with command line flags
- **Cache Validation**: Validates cached data integrity before use

## Usage

### Basic Usage
```bash
# Run with automatic cache detection
npm run test:my-contract
```

### Command Line Options

```bash
# Clear cache and deploy fresh
npm run test:my-contract --clear-cache
# or
npm run test:my-contract -c

# Force fresh deployment (ignore cache)
npm run test:my-contract --force-deploy
# or
npm run test:my-contract -f

# Show help
npm run test:my-contract --help
# or
npm run test:my-contract -h
```

## How It Works

1. **First Run**: Script deploys contracts and saves details to `deployment-cache.json`
2. **Subsequent Runs**: Script loads cached deployment data and recreates wallets
3. **Cache Validation**: Script validates cached data before use
4. **Fresh Deployment**: Deploys fresh when cache is invalid or cleared

## Cache File

The deployment cache is stored in `deployment-cache.json` and contains:
- Signer addresses and keys
- Deployer wallet information
- Multisig contract address
- Network information
- Timestamps

## Cache Management

- **Automatic**: Cache is used when valid, fresh deployment when invalid
- **Manual Clear**: Use `--clear-cache` to force fresh deployment
- **Force Deploy**: Use `--force-deploy` to ignore cache and deploy fresh

## Benefits

- **Faster Testing**: Skip deployment time on subsequent runs
- **Consistent State**: Use same deployment for multiple test runs
- **Development Efficiency**: Focus on testing logic rather than deployment setup
- **Flexible Control**: Choose when to use cache vs fresh deployment
