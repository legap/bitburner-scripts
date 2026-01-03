/** stock-trader-advanced.js
 * Auto‑balancing advanced stock trader.
 *
 * Usage:
 *   run stocks/stock-trader-advanced.js [max-stocks] [total-capital] [profit-target] [stop-loss] [refresh-rate-ms]
 *
 * Example:
 *   run stocks/stock-trader-advanced.js 15 3000000000000000 0.25 0.15 6000
 */

const LONG_THRESHOLD = 0.55;    // Enter/maintain long if forecast > 55%
const SHORT_THRESHOLD = 0.45;   // Enter/maintain short if forecast < 45% (if shorts enabled)
const EXIT_THRESHOLD = 0.02;    // Exit if forecast too close to neutral
const COMMISSION = 100000;      // Per transaction
const MAX_POSITION_FRACTION = 0.10; // Max 10% of capital per stock (safety cap)

/** Fallback formatter if ns.nFormat isn’t available */
function formatMoney(ns, v, f) {
  try {
    return ns.nFormat(v, f);
  } catch (e) {
    const units = ['', 'k', 'm', 'b', 't', 'q', 'Q', 's', 'S', 'o', 'n'];
    let i = 0;
    let n = Math.abs(v);
    while (n >= 1000 && i < units.length - 1) {
      n /= 1000;
      i++;
    }
    const decimals =
      f.includes('.000') ? 3 :
        f.includes('.00') ? 2 : 0;
    return (v < 0 ? '-$' : '$') + n.toFixed(decimals) + units[i];
  }
}

/** @param {NS} ns */
export async function main(ns) {
  // Validate API access
  if (!ns.stock.hasWSEAccount() || !ns.stock.hasTIXAPIAccess()) {
    ns.tprint("ERROR: You need TIX API Access! ($5 billion from WSE)");
    return;
  }

  if (!ns.stock.has4SDataTIXAPI()) {
    ns.tprint("ERROR: You need 4S Market Data TIX API! ($1 billion)");
    return;
  }

  // Parse parameters safely
  const maxStocks     = Number(ns.args[0] ?? 10);      // Max distinct tickers to hold
  const desiredCap    = Number(ns.args[1] ?? 50e9);    // Not enforced hard, used as guideline/log
  const profitTarget  = Number(ns.args[2] ?? 0.15);    // Net profit %
  const stopLoss      = Number(ns.args[3] ?? 0.10);    // Net loss %
  const refreshRate   = Number(ns.args[4] ?? 6000);    // ms

  if (!Number.isFinite(maxStocks) || maxStocks <= 0) {
    ns.tprint("ERROR: max-stocks must be a positive number.");
    return;
  }
  if (profitTarget <= 0 || profitTarget > 1) {
    ns.tprint("ERROR: Profit target must be between 0 and 1 (e.g., 0.15 for 15%).");
    return;
  }
  if (stopLoss <= 0 || stopLoss > 1) {
    ns.tprint("ERROR: Stop loss must be between 0 and 1 (e.g., 0.10 for 10%).");
    return;
  }

  // Short support detection
  let canShort = typeof ns.stock.buyShort === "function" &&
    typeof ns.stock.sellShort === "function";

  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();

  const startingCash = ns.getServerMoneyAvailable("home");
  const startingPortfolio = calculatePortfolioValue(ns);
  const startingCapital = startingCash + startingPortfolio;

  ns.tprint(`${"═".repeat(70)}`);
  ns.tprint(`ADVANCED STOCK TRADER - AUTO-BALANCED`);
  ns.tprint(`${"═".repeat(70)}`);
  ns.tprint(`Max Different Stocks : ${maxStocks}`);
  ns.tprint(`Desired Total Capital: ${formatMoney(ns, desiredCap, "$0.00a")}`);
  ns.tprint(`Starting Capital     : ${formatMoney(ns, startingCapital, "$0.00a")}`);
  ns.tprint(`Short Positions      : ${canShort ? "ENABLED" : "DISABLED"}`);
  if (!canShort) ns.tprint(`  Note: Trading long positions only.`);
  ns.tprint(`Long Threshold       : ${(LONG_THRESHOLD * 100).toFixed(1)}%`);
  if (canShort) ns.tprint(`Short Threshold      : ${(SHORT_THRESHOLD * 100).toFixed(1)}%`);
  ns.tprint(`Profit Target        : +${(profitTarget * 100).toFixed(1)}%`);
  ns.tprint(`Stop Loss            : -${(stopLoss * 100).toFixed(1)}%`);
  ns.tprint(`Refresh Rate         : ${refreshRate}ms`);
  ns.tprint(`${"═".repeat(70)}\n`);

  let cycleCount = 0;
  let totalRealizedProfit = 0;
  let tradesExecuted = 0;
  let biggestWin = 0;
  let biggestLoss = 0;

  while (true) {
    cycleCount++;
    ns.print(`\n${"─".repeat(70)}`);
    ns.print(`Cycle ${cycleCount} - ${new Date().toLocaleTimeString()}`);
    ns.print(`${"─".repeat(70)}`);

    const symbols = ns.stock.getSymbols();

    // 1) Exit logic (profit target, stop loss, bad forecast)
    let actionsThisCycle = 0;
    for (const symbol of symbols) {
      const forecast = ns.stock.getForecast(symbol);
      const [longShares, longPrice, shortShares, shortPrice] = ns.stock.getPosition(symbol);
      const askPrice = ns.stock.getAskPrice(symbol);
      const bidPrice = ns.stock.getBidPrice(symbol);

      // Long exits
      if (longShares > 0) {
        const grossProfit = (bidPrice - longPrice) * longShares;
        const netProfit = grossProfit - 2 * COMMISSION;
        const netReturnPct = netProfit / (longShares * longPrice);
        const hitProfitTarget = netReturnPct >= profitTarget;
        const hitStopLoss = netReturnPct <= -stopLoss;
        const badForecast = forecast < (0.5 + EXIT_THRESHOLD);
        const shouldExit = hitProfitTarget || hitStopLoss || badForecast;

        if (shouldExit) {
          const salePrice = ns.stock.sellStock(symbol, longShares);
          if (salePrice > 0) {
            const realized = (salePrice - longPrice) * longShares - 2 * COMMISSION;
            totalRealizedProfit += realized;
            tradesExecuted++;
            actionsThisCycle++;
            if (realized > biggestWin) biggestWin = realized;
            if (realized < biggestLoss) biggestLoss = realized;

            const reason = hitProfitTarget ? "PROFIT TARGET" :
              hitStopLoss ? "STOP LOSS" : "FORECAST";
            ns.print(`✓ EXIT LONG ${symbol}: ${formatMoney(ns, longShares, "0.0a")} @ ${formatMoney(ns, salePrice, "$0.00a")}`);
            ns.print(`  Reason: ${reason} | Net Return: ${(netReturnPct * 100).toFixed(2)}% | Profit: ${formatMoney(ns, realized, "$0.00a")}`);
          }
        }
      }

      // Short exits
      if (shortShares > 0 && canShort) {
        const grossProfit = (shortPrice - askPrice) * shortShares;
        const netProfit = grossProfit - 2 * COMMISSION;
        const netReturnPct = netProfit / (shortShares * shortPrice);
        const hitProfitTarget = netReturnPct >= profitTarget;
        const hitStopLoss = netReturnPct <= -stopLoss;
        const badForecast = forecast > (0.5 - EXIT_THRESHOLD);
        const shouldExit = hitProfitTarget || hitStopLoss || badForecast;

        if (shouldExit) {
          try {
            const salePrice = ns.stock.sellShort(symbol, shortShares);
            if (salePrice > 0) {
              const realized = (shortPrice - salePrice) * shortShares - 2 * COMMISSION;
              totalRealizedProfit += realized;
              tradesExecuted++;
              actionsThisCycle++;
              if (realized > biggestWin) biggestWin = realized;
              if (realized < biggestLoss) biggestLoss = realized;

              const reason = hitProfitTarget ? "PROFIT TARGET" :
                hitStopLoss ? "STOP LOSS" : "FORECAST";
              ns.print(`✓ EXIT SHORT ${symbol}: ${formatMoney(ns, shortShares, "0.0a")} @ ${formatMoney(ns, salePrice, "$0.00a")}`);
              ns.print(`  Reason: ${reason} | Net Return: ${(netReturnPct * 100).toFixed(2)}% | Profit: ${formatMoney(ns, realized, "$0.00a")}`);
            }
          } catch (e) {
            canShort = false;
            ns.tprint(`⚠ Short positions not available (requires BitNode-8 or Source-File 8 Level 2). Disabling shorts.`);
          }
        }
      }
    }

    // 2) Auto-balancing & entry logic
    const portfolioValue = calculatePortfolioValue(ns);
    const cash = ns.getServerMoneyAvailable("home");
    const totalCapital = portfolioValue + cash;

    const symbolsSorted = [...ns.stock.getSymbols()].sort((a, b) => {
      // Sort by forecast strength, strongest first
      const fa = ns.stock.getForecast(a);
      const fb = ns.stock.getForecast(b);
      return Math.abs(fb - 0.5) - Math.abs(fa - 0.5);
    });

    // Count active positions to enforce maxStocks
    let currentPositions = 0;
    const activeMap = new Map();
    for (const symbol of symbolsSorted) {
      const [l, , s] = ns.stock.getPosition(symbol);
      if (l > 0 || s > 0) {
        currentPositions++;
        activeMap.set(symbol, true);
      }
    }

    // Auto-balance only among top N by forecast
    const candidates = symbolsSorted.slice(0, maxStocks);

    for (const symbol of candidates) {
      const forecast = ns.stock.getForecast(symbol);
      const [longShares, longPrice, shortShares, shortPrice] = ns.stock.getPosition(symbol);
      const havePosition = longShares > 0 || shortShares > 0;

      // If forecast too close to neutral, target zero position
      const tooNeutral = Math.abs(forecast - 0.5) < EXIT_THRESHOLD;

      if (tooNeutral) {
        // Fully exit & let exit logic handle profit/loss; here we just skip adding
        continue;
      }

      const isBullish = forecast > 0.5;
      const isBearish = forecast < 0.5;

      // Determine target value for this symbol
      const targetValue = getTargetAllocationForSymbol(
        ns,
        symbol,
        totalCapital,
        maxStocks,
        forecast
      );

      // Cap per-stock exposure for safety
      const maxPerStock = totalCapital * MAX_POSITION_FRACTION;
      const cappedTargetValue = Math.min(targetValue, maxPerStock);

      // LONG side
      if (isBullish && !canShort) {
        // Long-only environment
        await rebalanceLongPosition(ns, symbol, longShares, cappedTargetValue, cash);
      } else if (isBullish && canShort) {
        // Prefer long if bullish
        await rebalanceLongPosition(ns, symbol, longShares, cappedTargetValue, cash);
        // Optionally close shorts here if any remain by exit logic
      } else if (isBearish && canShort) {
        // Bearish with shorts available
        await rebalanceShortPosition(ns, symbol, shortShares, cappedTargetValue, cash);
      }

      // If we had no position but now built one, count it
      const [newLong, , newShort] = ns.stock.getPosition(symbol);
      if (!havePosition && (newLong > 0 || newShort > 0)) {
        currentPositions++;
        activeMap.set(symbol, true);
      }

      if (currentPositions >= maxStocks) break;
    }

    if (actionsThisCycle === 0) {
      ns.print("No forced exits this cycle (profit/stop/forecast).");
    }

    displayAdvancedSummary(ns, totalRealizedProfit, tradesExecuted, biggestWin, biggestLoss);

    await ns.sleep(refreshRate);
  }
}

/** @param {NS} ns */
function calculatePortfolioValue(ns) {
  const symbols = ns.stock.getSymbols();
  let totalValue = 0;

  for (const symbol of symbols) {
    const [longShares, , shortShares] = ns.stock.getPosition(symbol);
    const askPrice = ns.stock.getAskPrice(symbol);
    const bidPrice = ns.stock.getBidPrice(symbol);

    if (longShares > 0) {
      totalValue += longShares * bidPrice;
    }
    if (shortShares > 0) {
      totalValue += shortShares * askPrice;
    }
  }

  return totalValue;
}

/**
 * Compute target allocation for a symbol:
 * - Equal-weight base: totalCapital / maxStocks
 * - Tilt by forecast strength: 0.5–1.5x
 * @param {NS} ns
 */
function getTargetAllocationForSymbol(ns, symbol, totalCapital, maxStocks, forecast) {
  const base = totalCapital / maxStocks;

  // Strength: 0 (neutral) to 0.5 (extreme)
  const strength = Math.abs(forecast - 0.5);
  // Tilt: 0.5x at very weak, 1.5x at very strong
  const tilt = 0.5 + (strength * 2);

  return base * tilt;
}

/** @param {NS} ns */
async function rebalanceLongPosition(ns, symbol, currentShares, targetValue, cash) {
  const price = ns.stock.getAskPrice(symbol);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  if (targetShares < 0) return;

  if (targetShares > currentShares) {
    let toBuy = targetShares - currentShares;
    // Ensure we can afford it
    const maxAffordable = Math.floor((cash - COMMISSION) / price);
    toBuy = Math.max(0, Math.min(toBuy, maxAffordable));
    if (toBuy <= 0) return;

    const boughtPrice = ns.stock.buyStock(symbol, toBuy);
    if (boughtPrice > 0) {
      ns.print(`✓ BALANCE BUY LONG ${symbol}: ${formatMoney(ns, toBuy, "0.0a")} @ ${formatMoney(ns, boughtPrice, "$0.00a")}`);
    }
  } else if (targetShares < currentShares) {
    const toSell = currentShares - targetShares;
    if (toSell <= 0) return;

    const salePrice = ns.stock.sellStock(symbol, toSell);
    if (salePrice > 0) {
      ns.print(`✓ BALANCE SELL LONG ${symbol}: ${formatMoney(ns, toSell, "0.0a")} @ ${formatMoney(ns, salePrice, "$0.00a")}`);
    }
  }
}

/** @param {NS} ns */
async function rebalanceShortPosition(ns, symbol, currentShares, targetValue, cash) {
  if (typeof ns.stock.buyShort !== "function" || typeof ns.stock.sellShort !== "function") return;
  const price = ns.stock.getAskPrice(symbol);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  if (targetShares < 0) return;

  if (targetShares > currentShares) {
    let toShort = targetShares - currentShares;
    const maxAffordable = Math.floor((cash - COMMISSION) / price);
    toShort = Math.max(0, Math.min(toShort, maxAffordable));
    if (toShort <= 0) return;

    try {
      const shortPrice = ns.stock.buyShort(symbol, toShort);
      if (shortPrice > 0) {
        ns.print(`✓ BALANCE OPEN/ADD SHORT ${symbol}: ${formatMoney(ns, toShort, "0.0a")} @ ${formatMoney(ns, shortPrice, "$0.00a")}`);
      }
    } catch (e) {
      ns.print(`Shorting failed for ${symbol}, disabling shorts.`);
    }
  } else if (targetShares < currentShares) {
    const toCover = currentShares - targetShares;
    if (toCover <= 0) return;

    try {
      const coverPrice = ns.stock.sellShort(symbol, toCover);
      if (coverPrice > 0) {
        ns.print(`✓ BALANCE REDUCE SHORT ${symbol}: ${formatMoney(ns, toCover, "0.0a")} @ ${formatMoney(ns, coverPrice, "$0.00a")}`);
      }
    } catch (e) {
      ns.print(`Cover short failed for ${symbol}.`);
    }
  }
}

/** @param {NS} ns */
function displayAdvancedSummary(ns, totalProfit, tradesExecuted, biggestWin, biggestLoss) {
  const symbols = ns.stock.getSymbols();
  let portfolioValue = 0;
  let invested = 0;
  let longPositions = 0;
  let shortPositions = 0;

  for (const symbol of symbols) {
    const [longShares, longPrice, shortShares, shortPrice] = ns.stock.getPosition(symbol);
    const askPrice = ns.stock.getAskPrice(symbol);
    const bidPrice = ns.stock.getBidPrice(symbol);

    if (longShares > 0) {
      longPositions++;
      portfolioValue += longShares * bidPrice;
      invested += longShares * longPrice;
    }
    if (shortShares > 0) {
      shortPositions++;
      portfolioValue += shortShares * askPrice;
      invested += shortShares * shortPrice;
    }
  }

  const cash = ns.getServerMoneyAvailable("home");
  const totalCapital = portfolioValue + cash;
  const unrealizedProfit = portfolioValue - invested;

  ns.print(`\n${"═".repeat(70)}`);
  ns.print(`PORTFOLIO SUMMARY`);
  ns.print(`${"─".repeat(70)}`);
  ns.print(`Positions       : ${longPositions} long / ${shortPositions} short`);
  ns.print(`Portfolio Value : ${formatMoney(ns, portfolioValue, "$0.00a")}`);
  ns.print(`Available Cash  : ${formatMoney(ns, cash, "$0.00a")}`);
  ns.print(`Total Capital   : ${formatMoney(ns, totalCapital, "$0.00a")}`);
  ns.print(`${"─".repeat(70)}`);
  ns.print(`Unrealized P/L  : ${formatMoney(ns, unrealizedProfit, "$0.00a")} (${invested > 0 ? ((unrealizedProfit / invested) * 100).toFixed(2) : "0.00"}%)`);
  ns.print(`Realized P/L    : ${formatMoney(ns, totalProfit, "$0.00a")}`);
  ns.print(`Total Trades    : ${tradesExecuted}`);
  if (tradesExecuted > 0) {
    ns.print(`Best Trade      : ${biggestWin > 0 ? formatMoney(ns, biggestWin, "$0.00a") : "$0.00 (no profitable trades yet)"}`);
    ns.print(`Worst Trade     : ${formatMoney(ns, biggestLoss, "$0.00a")}`);
  }
  ns.print(`${"═".repeat(70)}`);
}
