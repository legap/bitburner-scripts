# BitNode Multiplier Fix - Testing Guide

**Version**: 1.8.17  
**Date**: November 25, 2025  
**Purpose**: Verify smart-batcher.js works correctly in all BitNodes

---

## Quick Test Procedure

### Prerequisites

1. Download updated scripts:

   ```bash
   run bitburner-update.js --batch
   ```

2. Check if you have Formulas.exe:
   ```bash
   ls | grep Formulas
   ```
   - If you don't have it: `buy Formulas.exe` (highly recommended for 100% accuracy)

### Test 1: Verify Script Shows BitNode Awareness

```bash
run batch/smart-batcher.js joesguns --dry
```

**Expected Output** (With Formulas.exe):

```
═══════════════════════════════════════════════════════════════
  SMART BATCHER: joesguns
═══════════════════════════════════════════════════════════════

📊 Timing Analysis:
  Hack Time:   X.XXs
  Grow Time:   X.XXs
  Weaken Time: X.XXs (longest)
  Batch Window: X.XXs

⚖️  Optimal Thread Ratios:
  Hack:   X.X% (base: X)
  Grow:   X.X% (base: X)
  Weaken: X.X% (base: X)

🎯 Target: Hack 5.0% of server money per batch
  Money per hack thread: $XXX.XXm
  Weaken per thread: 0.XXXX security      <-- Should show dynamic value
  Calculation method: ✓ Formulas.exe (BitNode-aware)  <-- Key indicator
  Timing efficiency: XX.X%
```

**Expected Output** (WITHOUT Formulas.exe):

```
⚠️  WARNING: Formulas.exe not found!
  Thread ratios are estimated and may not be accurate in BitNodes
  with different ServerGrowthRate or ServerWeakenRate multipliers.
  For optimal results in all BitNodes, install Formulas.exe first.
```

### Test 2: Monitor Server Money Stability

**Step 1: Prepare the target**

```bash
run batch/smart-batcher.js joesguns
```

**Step 2: Wait for server to reach max money and min security** (~5-10 minutes)

- Check status: `run analysis/production-monitor.js joesguns`
- Look for: "Money: 100%" and "Security: min"

**Step 3: Monitor for 30 minutes**

```bash
run analysis/production-monitor.js joesguns
```

**Expected Results**:

- ✅ **Money stays at 100%** (or 98-100% with minor fluctuation)
- ✅ **Security stays at minimum** (e.g., 15.00 for joesguns)
- ✅ **Income rate is positive and stable**

**Failure Indicators** (Old Bug):

- ❌ Money depletes below 95% over time
- ❌ Money continues dropping instead of recovering
- ❌ Security drifts away from minimum

### Test 3: BitNode 2 Specific Test

**Only if you're in BitNode 2** (ServerGrowthRate = 0.8):

1. Reset the target server (if possible):

   ```bash
   # Use bit_flum3 or similar to reset
   ```

2. Deploy fresh batch:

   ```bash
   run batch/batch-manager.js joesguns 0.05 1.25 home --quiet
   ```

3. Monitor for 10+ cycles:
   ```bash
   # Watch the logs
   # Money should NOT deplete
   # Security should NOT increase
   ```

**Expected**: Money stays at maximum, security stays at minimum

---

## Detailed Testing Scenarios

### Scenario A: BitNode 1 (Vanilla)

**Multipliers**: ServerGrowthRate = 1.0, ServerWeakenRate = 1.0  
**Expected**: Works perfectly (always has)  
**Weaken per thread**: 0.0500 security

### Scenario B: BitNode 2 (Rise of the Underworld)

**Multipliers**: ServerGrowthRate = 0.8, ServerWeakenRate = varies  
**Expected**: Works perfectly NOW (was broken before v1.8.17)  
**Weaken per thread**: ~0.0400 security (20% weaker)

### Scenario C: BitNode 8 (Ghost of Wall Street)

**Multipliers**: ServerGrowthRate = 0.0 (zero!)  
**Expected**: Formulas handles edge case gracefully  
**Note**: Manual hacking only in this BitNode (scripts can't grow money)

---

## Verification Checklist

Use this checklist to verify the fix:

### Pre-Deployment Checks

- [ ] Downloaded version 1.8.17 scripts
- [ ] Formulas.exe installed (recommended) OR aware of estimation mode
- [ ] Target server is hackable (have required hacking skill)
- [ ] Have at least 64GB RAM available (for decent thread count)

### Post-Deployment Checks (First 5 Minutes)

- [ ] Script shows "Calculation method: ✓ Formulas.exe (BitNode-aware)"
- [ ] No errors during script deployment
- [ ] All servers show successful script starts
- [ ] Weaken per thread shows dynamic value (not hardcoded 0.0500)

### Stability Checks (30 Minutes)

- [ ] Server money stays at 95-100% of maximum
- [ ] Server security stays at minimum level
- [ ] No continuous downward trend in money
- [ ] No continuous upward trend in security
- [ ] Income rate is positive and stable

### Long-Term Checks (2+ Hours)

- [ ] Server money consistently at maximum
- [ ] No manual intervention required
- [ ] Income matches expected production estimates
- [ ] System runs autonomously without degradation

---

## Common Issues and Solutions

### Issue: Weaken per thread shows "0.0500" (hardcoded value)

**Cause**: Running old version of smart-batcher.js

**Solution**:

```bash
# Re-download the latest version
run bitburner-update.js --batch

# Verify version shows 1.8.17 in CHANGELOG
cat scripts/CHANGELOG.md | head -20
```

### Issue: Money still depleting over time

**Possible Causes**:

1. Don't have Formulas.exe (estimation mode may be slightly inaccurate)
2. Other scripts competing for server resources
3. Server not fully prepped (not at max money yet)

**Solutions**:

**Solution 1: Install Formulas.exe**

```bash
buy Formulas.exe
# Then kill and restart batch system
run utils/global-kill.js
run batch/smart-batcher.js joesguns
```

**Solution 2: Check for competing scripts**

```bash
# List all running processes
run utils/list-procs.js

# Kill everything
run utils/global-kill.js

# Redeploy just smart-batcher
run batch/smart-batcher.js joesguns
```

**Solution 3: Wait for full prep**

```bash
# Monitor prep status
run analysis/production-monitor.js joesguns

# Wait until:
# - Money: 100%
# - Security: min
# Then test stability again
```

### Issue: Script shows "WARNING: Formulas.exe not found"

**Expected Behavior**: This is just a warning, not an error

**Impact**:

- Script will use enhanced estimation mode
- Should work reasonably well but may have minor drift (2-5%)
- For 100% accuracy in all BitNodes, install Formulas.exe

**Solution** (Optional but recommended):

```bash
buy Formulas.exe
```

### Issue: Can't afford Formulas.exe

**Workaround**: Enhanced estimation mode

**What to expect**:

- BitNode 1: Works perfectly (estimation accurate)
- BitNode 2-3: Minor drift possible (5-10% over long periods)
- BitNode 8: Won't work (growth disabled in this BitNode)
- Others: Generally stable but not perfect

**Recommendation**:

- Save up for Formulas.exe ($5 billion typically)
- It's worth the investment for multi-BitNode stability

---

## Performance Benchmarks

### Expected Thread Ratios by BitNode

**BitNode 1** (Vanilla - ServerGrowthRate = 1.0):

```
Optimal Thread Ratios:
  Hack:   4.0% (base: 1)
  Grow:   87.0% (base: 22)
  Weaken: 9.0% (base: 2)
```

**BitNode 2** (ServerGrowthRate = 0.8):

```
Optimal Thread Ratios:
  Hack:   3.5% (base: 1)
  Grow:   89.0% (base: 28)    <-- More grow threads needed
  Weaken: 7.5% (base: 2)
```

**Note**: Exact ratios depend on target server's growth parameter and timing

### Expected Weaken Values by BitNode

| BitNode | ServerWeakenRate | Weaken per Thread | Note            |
| ------- | ---------------- | ----------------- | --------------- |
| BN1     | 1.0 (100%)       | 0.0500            | Vanilla         |
| BN2     | 0.8 (80%)        | 0.0400            | Weaker weaken   |
| BN3     | 0.8 (80%)        | 0.0400            | Weaker weaken   |
| BN5     | 1.0 (100%)       | 0.0500            | Normal          |
| BN8     | N/A              | N/A               | Growth disabled |

---

## Reporting Issues

If you encounter problems after applying this fix, please report with:

### Required Information

1. **Bitburner Version**: (e.g., v2.8.1 Steam, v3.0.0 Web)
2. **BitNode**: (e.g., BitNode 2)
3. **Script Version**: (check scripts/CHANGELOG.md first line)
4. **Formulas.exe Status**: (do you have it?)
5. **Target Server**: (e.g., joesguns)

### Symptoms to Report

- Current server money percentage
- Current server security level
- Expected vs actual thread ratios (from script output)
- Weaken per thread value shown
- Calculation method shown (Formulas vs Estimation)

### How to Report

1. Create GitHub issue: https://github.com/r3c0n75/bitburner-scripts/issues
2. Include all required information above
3. Include script output (copy/paste terminal output)
4. Include screenshot of server status if possible

---

## Success Criteria

Your system is working correctly if:

✅ **Script Output**:

- Shows "Calculation method: ✓ Formulas.exe (BitNode-aware)" (if you have Formulas.exe)
- Shows dynamic weaken value (not 0.0500 in all BitNodes)
- No errors during deployment
- Thread ratios calculated successfully

✅ **Server Stability**:

- Money stays at 95-100% of maximum
- Security stays at minimum level
- No continuous degradation over time
- System runs autonomously for hours without intervention

✅ **Income Production**:

- Positive income rate
- Income matches estimated production
- No sudden drops or spikes
- Consistent performance over time

---

## Additional Resources

- **BITNODE_MULTIPLIER_FIX.md**: Complete technical documentation
- **CHANGELOG.md**: Version history and all changes
- **SCRIPT_REFERENCE.md**: Smart-batcher.js usage guide
- **Official Bitburner Docs**: https://bitburner.readthedocs.io/

---

**Document Version**: 1.0  
**Last Updated**: November 25, 2025  
**Status**: ✅ Production-Ready Testing Guide
