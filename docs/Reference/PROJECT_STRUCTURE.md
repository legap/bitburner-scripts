# Project Structure

This document outlines the organized structure of the Bitburner script collection.

## 📁 Directory Structure

```
bitburner-scripts/
├── README.md                           # Main project documentation
├── PROJECT_STRUCTURE.md               # This file
├── core/                              # Core attack scripts
│   ├── attack-hack.js                 # Basic hack operation
│   ├── attack-grow.js                 # Basic grow operation
│   └── attack-weaken.js               # Basic weaken operation
├── batch/                             # Batch management scripts
│   ├── smart-batcher.js ⭐            # Optimal timing-based ratios (490x faster!)
│   ├── simple-batcher.js              # Deploy helpers across servers
│   ├── batch-manager.js ⭐            # Auto-deploy smart-batcher with rooting
│   └── home-batcher.js                # Home server batch operations
├── analysis/                          # Analysis and monitoring
│   ├── profit-scan.js                 # Find profitable targets
│   └── production-monitor.js          # Monitor money generation
├── utils/                             # Utility scripts
│   ├── global-kill.js                 # Kill all scripts globally
│   ├── list-procs.js                  # List running processes
│   ├── list-pservs.js                 # List purchased servers
│   ├── server-info.js                 # Display server information
│   └── estimate-production.js         # Estimate production rates
├── deploy/                             # Deployment scripts
│   ├── auto-expand.js                 # Root and deploy to all servers
│   ├── purchase-server-8gb.js         # Buy 8GB servers
│   ├── replace-pservs-no-copy.js      # Replace purchased servers
│   ├── deploy-hack-joesguns.js        # Deploy joesguns hack script
│   ├── hack-joesguns.js               # Alternative joesguns hack script
│   └── hack-n00dles.js                # Early game hack script
├── config/                            # Configuration files
│   └── default-targets.js             # Predefined target lists
└── docs/                              # Documentation
    ├── GETTING_STARTED.md             # Getting started guide
    └── SCRIPT_REFERENCE.md            # Complete script reference
```

## 🎯 Script Categories

### Core Attack Scripts (`core/`)

Basic attack operations that form the foundation of all batch operations:

- **attack-hack.js** - Performs hack operations
- **attack-grow.js** - Performs grow operations
- **attack-weaken.js** - Performs weaken operations

### Batch Management (`batch/`)

Advanced batch operations for deploying and managing attack scripts:

- **smart-batcher.js** ⭐ - Optimal timing-based ratios (490x performance!)
- **simple-batcher.js** - Deploy attack helpers across all servers (basic)
- **batch-manager.js** ⭐ - Auto-deploy smart-batcher with rooting & intelligent quiet mode
- **home-batcher.js** - Home server batch operations

### Analysis & Monitoring (`analysis/`)

Tools for analyzing performance and finding optimal targets:

- **profit-scan.js** - Find most profitable targets
- **profit-scan-flex.js** ⭐ - Enhanced with realistic batch calculations
- **production-monitor.js** - Monitor money generation rate

### Utilities (`utils/`)

General utility scripts for system management:

- **global-kill.js** - Kill all scripts globally
- **list-procs.js** - List running processes
- **list-pservs.js** - List purchased servers
- **server-info.js** - Display server information
- **estimate-production.js** ⭐ - Realistic batch-cycle-aware estimates

### Deployment (`deploy/`)

Scripts for deploying and managing server operations:

- **auto-expand.js** - Root and deploy to all servers
- **purchase-server-8gb.js** - Buy 8GB servers
- **replace-pservs-no-copy.js** - Replace purchased servers
- **deploy-hack-joesguns.js** - Deploy joesguns hack script
- **hack-joesguns.js** - Alternative joesguns hack script
- **hack-n00dles.js** - Early game hack script

### Configuration (`config/`)

Configuration files for predefined settings:

- **default-targets.js** - Predefined target lists for different game stages

### Documentation (`docs/`)

Comprehensive documentation:

- **GETTING_STARTED.md** - Getting started guide
- **SCRIPT_REFERENCE.md** - Complete script reference

## 🔄 Workflow Integration

### ⭐ Recommended Workflow (490x Performance!)

1. **Analysis**: Use `profit-scan-flex.js` to find targets with realistic estimates
2. **Estimation**: Use `estimate-production.js` to calculate expected income
3. **Deployment**: Use `smart-batcher.js` for optimal ratios ($2.09m/s)
   - **Or**: Use `batch-manager.js --quiet` for automated deployment + auto-rooting
4. **Monitoring**: Use `production-monitor.js` to verify results

### Basic Workflow

1. **Analysis**: Use `profit-scan.js` to find targets
2. **Deployment**: Use `simple-batcher.js` to deploy attacks
3. **Monitoring**: Use `production-monitor.js` to track progress

### Advanced Workflow

1. **Server Management**: Use `purchase-server-8gb.js` to buy servers
2. **Batch Management**: Use `batch-manager.js --quiet` for automated smart-batcher deployment with auto-rooting
3. **System Monitoring**: Use `list-procs.js` and `list-pservs.js` for status

### Troubleshooting Workflow

1. **System Check**: Use `list-procs.js` to see what's running
2. **Reset**: Use `global-kill.js` to stop all operations
3. **Restart**: Use `smart-batcher.js` or `simple-batcher.js` to restart operations

## 📊 Script Dependencies

### Required Dependencies

All batch operations require these core scripts:

- `attack-hack.js`
- `attack-grow.js`
- `attack-weaken.js`

### Optional Dependencies

Some deployment scripts use these alternatives:

- `hack-joesguns.js` - Alternative hack script
- `hack-n00dles.js` - Early game hack script

### Configuration Dependencies

Some scripts can import configuration:

- `config/default-targets.js` - Target lists and settings

## 🚀 Quick Start Paths

### Early Game

```
core/ → analysis/ → deploy/
```

### Mid Game

```
batch/ → utils/ → deploy/
```

### Late Game

```
batch/ → utils/ → analysis/ → deploy/
```

## 📝 Maintenance

### Regular Tasks

- Monitor production with `analysis/production-monitor.js`
- Check system status with `utils/list-procs.js`
- Find better targets with `analysis/profit-scan.js`

### Optimization Tasks

- Use `utils/estimate-production.js` for planning
- Use `utils/server-info.js` for detailed analysis
- Use `deploy/purchase-server-8gb.js` for expansion

### Troubleshooting Tasks

- Use `utils/global-kill.js` to reset
- Use `utils/list-pservs.js` to check servers
- Use `utils/server-info.js` for diagnostics

---

This structure provides a clear organization for all scripts while maintaining easy access to common operations and
comprehensive documentation for advanced usage.
