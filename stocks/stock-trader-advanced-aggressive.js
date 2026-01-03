/** stock-trader-aggressive.js
 * Extremely aggressive auto‑balancing stock trader.
 *
 * Strategy:
 * - Uses ALL available capital aggressively
 * - Forecast‑weighted allocation with strong tilt
 * - Up to 25% of total capital per stock
 * - Fast rebalancing every cycle
 * - Quick exits on forecast weakness
 * - Supports shorts (if available)
 *
 * Usage:
 *   run stock-trader-aggressive.js [max-stocks] [profit-target] [stop-loss] [refresh-ms]
 */

const COMMISSION = 100000;
const EXIT_THRESHOLD = 0.01;        // Exit if forecast too close to neutral
const LONG_THRESHOLD = 0.52;        // Enter long earlier
const SHORT_THRESHOLD = 0.48;       // Enter short earlier
const MAX_POSITION_FRACTION = 0.25; // Aggressive: up to 25% of capital per stock

/** Fallback formatter */
function fmt(ns, v, f) {
  try { return ns.nFormat(v, f); }
  catch { return v.toFixed(2); }
}

/** @param {NS} ns */
export async function main(ns) {
  // Parse args
  const maxStocks    = Number(ns.args[0] ?? 12);
  const profitTarget = Number(ns.args[1] ?? 0.20);
  const stopLoss     = Number(ns.args[2] ?? 0.12);
  const refreshRate  = Number(ns.args[3] ?? 4000);

  if (!ns.stock.hasWSEAccount() || !ns.stock.hasTIXAPIAccess()) {
    ns.tprint("ERROR: TIX API Access required.");
    return;
  }
  if (!ns.stock.has4SDataTIXAPI()) {
    ns.tprint("ERROR: 4S Market Data TIX API required.");
    return;
  }

  let canShort = typeof ns.stock.buyShort === "function";

  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();

  ns.tprint("══════════════════════════════════════════════════════════════");
  ns.tprint(" AGGRESSIVE STOCK TRADER – STARTING");
  ns.tprint("══════════════════════════════════════════════════════════════");
  ns.tprint(`Max Stocks: ${maxStocks}`);
  ns.tprint(`Profit Target: ${(profitTarget * 100).toFixed(1)}%`);
  ns.tprint(`Stop Loss: ${(stopLoss * 100).toFixed(1)}%`);
  ns.tprint(`Shorts: ${canShort ? "ENABLED" : "DISABLED"}`);
  ns.tprint(`Refresh: ${refreshRate}ms`);
  ns.tprint("══════════════════════════════════════════════════════════════\n");

  let realizedProfit = 0;
  let trades = 0;
  let best = 0;
  let worst = 0;

  while (true) {
    const symbols = ns.stock.getSymbols();

    // 1) EXIT LOGIC
    for (const sym of symbols) {
      const [longShares, longPrice, shortShares, shortPrice] = ns.stock.getPosition(sym);
      const forecast = ns.stock.getForecast(sym);
      const ask = ns.stock.getAskPrice(sym);
      const bid = ns.stock.getBidPrice(sym);

      // LONG EXIT
      if (longShares > 0) {
        const gross = (bid - longPrice) * longShares;
        const net = gross - 2 * COMMISSION;
        const pct = net / (longShares * longPrice);

        const exit =
          pct >= profitTarget ||
          pct <= -stopLoss ||
          forecast < 0.5 + EXIT_THRESHOLD;

        if (exit) {
          const sale = ns.stock.sellStock(sym, longShares);
          if (sale > 0) {
            realizedProfit += net;
            trades++;
            best = Math.max(best, net);
            worst = Math.min(worst, net);
            ns.print(`✓ EXIT LONG ${sym} | P/L ${fmt(ns, net, "$0.00a")} | ${(pct * 100).toFixed(2)}%`);
          }
        }
      }

      // SHORT EXIT
      if (shortShares > 0 && canShort) {
        const gross = (shortPrice - ask) * shortShares;
        const net = gross - 2 * COMMISSION;
        const pct = net / (shortShares * shortPrice);

        const exit =
          pct >= profitTarget ||
          pct <= -stopLoss ||
          forecast > 0.5 - EXIT_THRESHOLD;

        if (exit) {
          try {
            const sale = ns.stock.sellShort(sym, shortShares);
            if (sale > 0) {
              realizedProfit += net;
              trades++;
              best = Math.max(best, net);
              worst = Math.min(worst, net);
              ns.print(`✓ EXIT SHORT ${sym} | P/L ${fmt(ns, net, "$0.00a")} | ${(pct * 100).toFixed(2)}%`);
            }
          } catch {
            canShort = false;
            ns.tprint("⚠ Shorts disabled due to API restriction.");
          }
        }
      }
    }

    // 2) CAPITAL CALCULATION
    const portfolioValue = calcPortfolioValue(ns);
    const cash = ns.getServerMoneyAvailable("home");
    const totalCap = portfolioValue + cash;

    // 3) SORT SYMBOLS BY FORECAST STRENGTH
    const sorted = [...symbols].sort((a, b) =>
      Math.abs(ns.stock.getForecast(b) - 0.5) -
      Math.abs(ns.stock.getForecast(a) - 0.5)
    );

    const targets = sorted.slice(0, maxStocks);

    // 4) REBALANCE
    for (const sym of targets) {
      const forecast = ns.stock.getForecast(sym);
      const [longShares, longPrice, shortShares, shortPrice] = ns.stock.getPosition(sym);

      const bullish = forecast > LONG_THRESHOLD;
      const bearish = forecast < SHORT_THRESHOLD;

      // Compute aggressive target allocation
      const targetValue = aggressiveTarget(ns, sym, totalCap, maxStocks, forecast);
      const capped = Math.min(targetValue, totalCap * MAX_POSITION_FRACTION);

      if (bullish) {
        await rebalanceLong(ns, sym, longShares, capped, cash);
      } else if (bearish && canShort) {
        await rebalanceShort(ns, sym, shortShares, capped, cash);
      }
    }

    // 5) SUMMARY
    printSummary(ns, realizedProfit, trades, best, worst);

    await ns.sleep(refreshRate);
  }
}

/** Aggressive target allocation */
function aggressiveTarget(ns, sym, totalCap, maxStocks, forecast) {
  const base = totalCap / maxStocks;

  // Aggressive tilt:
  // Weak forecast → 0.3x
  // Strong forecast → 2.0x
  const strength = Math.abs(forecast - 0.5) * 2; // 0–1
  const tilt = 0.3 + strength * 1.7;             // 0.3–2.0

  return base * tilt;
}

/** @param {NS} ns */
async function rebalanceLong(ns, sym, current, targetValue, cash) {
  const price = ns.stock.getAskPrice(sym);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  if (targetShares < 0) return;

  if (targetShares > current) {
    let buy = targetShares - current;
    buy = Math.min(buy, Math.floor((cash - COMMISSION) / price));
    if (buy > 0) {
      const p = ns.stock.buyStock(sym, buy);
      if (p > 0) ns.print(`↑ BUY ${sym} ${buy} @ ${fmt(ns, p, "$0.00a")}`);
    }
  } else if (targetShares < current) {
    const sell = current - targetShares;
    if (sell > 0) {
      const p = ns.stock.sellStock(sym, sell);
      if (p > 0) ns.print(`↓ SELL ${sym} ${sell} @ ${fmt(ns, p, "$0.00a")}`);
    }
  }
}

/** @param {NS} ns */
async function rebalanceShort(ns, sym, current, targetValue, cash) {
  if (!ns.stock.buyShort) return;
  const price = ns.stock.getAskPrice(sym);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  if (targetShares < 0) return;

  if (targetShares > current) {
    let amt = targetShares - current;
    amt = Math.min(amt, Math.floor((cash - COMMISSION) / price));
    if (amt > 0) {
      const p = ns.stock.buyShort(sym, amt);
      if (p > 0) ns.print(`↑ SHORT ${sym} ${amt} @ ${fmt(ns, p, "$0.00a")}`);
    }
  } else if (targetShares < current) {
    const amt = current - targetShares;
    if (amt > 0) {
      const p = ns.stock.sellShort(sym, amt);
      if (p > 0) ns.print(`↓ COVER ${sym} ${amt} @ ${fmt(ns, p, "$0.00a")}`);
    }
  }
}

/** @param {NS} ns */
function calcPortfolioValue(ns) {
  let total = 0;
  for (const sym of ns.stock.getSymbols()) {
    const [l, , s] = ns.stock.getPosition(sym);
    const ask = ns.stock.getAskPrice(sym);
    const bid = ns.stock.getBidPrice(sym);
    if (l > 0) total += l * bid;
    if (s > 0) total += s * ask;
  }
  return total;
}

/** @param {NS} ns */
function printSummary(ns, realized, trades, best, worst) {
  const pv = calcPortfolioValue(ns);
  const cash = ns.getServerMoneyAvailable("home");
  const total = pv + cash;

  ns.print("\n══════════════════════════════════════════════════════");
  ns.print(`Total Capital : ${fmt(ns, total, "$0.00a")}`);
  ns.print(`Portfolio     : ${fmt(ns, pv, "$0.00a")}`);
  ns.print(`Cash          : ${fmt(ns, cash, "$0.00a")}`);
  ns.print("──────────────────────────────────────────────────────");
  ns.print(`Realized P/L  : ${fmt(ns, realized, "$0.00a")}`);
  ns.print(`Trades        : ${trades}`);
  ns.print(`Best Trade    : ${fmt(ns, best, "$0.00a")}`);
  ns.print(`Worst Trade   : ${fmt(ns, worst, "$0.00a")}`);
  ns.print("══════════════════════════════════════════════════════");
}
