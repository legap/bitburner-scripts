/** stock-trader-smart-aggressive.js
 * Smart‑aggressive auto‑balancing stock trader with:
 * - Forecast strength
 * - Momentum (forecast delta)
 * - Volatility penalty
 * - Aggressive allocation + rebalancing
 * - Safe short handling (auto-disable)
 *
 * Usage:
 *   run stock-trader-smart-aggressive.js [max-stocks] [profit-target] [stop-loss] [refresh-ms]
 */

const COMMISSION = 100000;
const EXIT_THRESHOLD = 0.01;
const LONG_THRESHOLD = 0.52;
const SHORT_THRESHOLD = 0.48;
const MAX_POSITION_FRACTION = 0.25;

// GLOBAL shorting flag (fixes ReferenceError)
let canShort = false;

// State maps
const lastForecasts = new Map();
const lastPrices = new Map();

function fmt(ns, v, pattern = "$0.00a") {
  try { return ns.nFormat(v, pattern); }
  catch { return v.toFixed(2); }
}

/** @param {NS} ns */
export async function main(ns) {
  const maxStocks    = Number(ns.args[0] ?? 15);
  const profitTarget = Number(ns.args[1] ?? 0.22);
  const stopLoss     = Number(ns.args[2] ?? 0.14);
  let   refreshRate  = Number(ns.args[3] ?? 4000);

  if (!ns.stock.hasWSEAccount() || !ns.stock.hasTIXAPIAccess()) {
    ns.tprint("ERROR: TIX API Access required.");
    return;
  }
  if (!ns.stock.has4SDataTIXAPI()) {
    ns.tprint("ERROR: 4S Market Data TIX API required.");
    return;
  }

  // Initialize global shorting flag
  canShort = typeof ns.stock.buyShort === "function";

  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();

  ns.tprint("══════════════════════════════════════════════════════════════");
  ns.tprint(" SMART‑AGGRESSIVE STOCK TRADER – STARTING");
  ns.tprint("══════════════════════════════════════════════════════════════");
  ns.tprint(`Max Stocks    : ${maxStocks}`);
  ns.tprint(`Profit Target : ${(profitTarget * 100).toFixed(1)}%`);
  ns.tprint(`Stop Loss     : ${(stopLoss * 100).toFixed(1)}%`);
  ns.tprint(`Shorts        : ${canShort ? "ENABLED" : "DISABLED"}`);
  ns.tprint(`Base Refresh  : ${refreshRate}ms`);
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
            ns.print(`✓ EXIT LONG ${sym} | P/L ${fmt(ns, net)} | ${(pct * 100).toFixed(2)}%`);
          }
        }
      }

      // SHORT EXIT (safe)
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
              ns.print(`✓ EXIT SHORT ${sym} | P/L ${fmt(ns, net)} | ${(pct * 100).toFixed(2)}%`);
            }
          } catch {
            canShort = false;
            ns.tprint("⚠ Shorts disabled: BitNode‑8 or SF8‑2 required.");
          }
        }
      }
    }

    // 2) CAPITAL + VOLATILITY ANALYSIS
    const portfolioValue = calcPortfolioValue(ns);
    const cash = ns.getServerMoneyAvailable("home");
    const totalCap = portfolioValue + cash;

    const metrics = [];
    let totalVol = 0;

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const price = ns.stock.getAskPrice(sym);

      const strength = Math.abs(forecast - 0.5);
      const momentum = getMomentum(sym, forecast);
      const volatility = getVolatility(sym, price);

      metrics.push({ sym, forecast, strength, momentum, volatility });
      totalVol += volatility;
    }

    const avgVol = metrics.length ? totalVol / metrics.length : 0;

    // Adaptive refresh
    if (avgVol > 0.02) refreshRate = Math.max(1500, refreshRate * 0.8);
    else refreshRate = Math.min(8000, refreshRate * 1.1);

    // 3) SMART SCORE SORT
    metrics.sort((a, b) => smartScore(b) - smartScore(a));
    const targets = metrics.slice(0, maxStocks);

    // 4) REBALANCE
    for (const m of targets) {
      const { sym, forecast } = m;
      const [longShares, , shortShares] = ns.stock.getPosition(sym);

      const bullish = forecast > LONG_THRESHOLD;
      const bearish = forecast < SHORT_THRESHOLD;

      if (Math.abs(forecast - 0.5) < EXIT_THRESHOLD) continue;

      const targetValue = smartAggressiveTarget(m, totalCap, maxStocks);
      const cappedValue = Math.min(targetValue, totalCap * MAX_POSITION_FRACTION);

      if (bullish) {
        await rebalanceLong(ns, sym, longShares, cappedValue, cash);
      } else if (bearish && canShort) {
        await rebalanceShort(ns, sym, shortShares, cappedValue, cash);
      }
    }

    // 5) SUMMARY
    printSummary(ns, realizedProfit, trades, best, worst, avgVol, refreshRate);

    await ns.sleep(refreshRate);
  }
}

// SMART SCORING
function smartScore(m) {
  const { strength, momentum, volatility } = m;
  const s = strength * 4;
  const mom = Math.max(-0.5, Math.min(0.5, momentum * 50));
  const volPenalty = Math.min(1.5, volatility * 30);
  return s + mom - volPenalty;
}

// SMART AGGRESSIVE TARGET
function smartAggressiveTarget(m, totalCap, maxStocks) {
  const base = totalCap / maxStocks;
  const { strength, momentum, volatility } = m;

  const strengthBoost = 1 + strength * 4;
  const momentumBoost = 1 + Math.max(0, momentum * 80);
  const volPenalty = 1 / (1 + volatility * 15);

  let target = base * strengthBoost * momentumBoost * volPenalty;
  if (target < base * 0.3) target = base * 0.3;

  return target;
}

// MOMENTUM
function getMomentum(sym, forecast) {
  const prev = lastForecasts.get(sym) ?? forecast;
  lastForecasts.set(sym, forecast);
  return forecast - prev;
}

// VOLATILITY
function getVolatility(sym, price) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const prev = lastPrices.get(sym) ?? price;
  lastPrices.set(sym, price);
  return Math.abs(price - prev) / price;
}

// LONG REBALANCE
async function rebalanceLong(ns, sym, currentShares, targetValue, cash) {
  const price = ns.stock.getAskPrice(sym);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  const diff = targetShares - currentShares;
  if (Math.abs(diff) < 10) return;

  if (diff > 0) {
    let buy = Math.min(diff, Math.floor((cash - COMMISSION) / price));
    if (buy > 0) {
      const p = ns.stock.buyStock(sym, buy);
      if (p > 0) ns.print(`↑ BUY  ${sym} ${buy} @ ${fmt(ns, p)}`);
    }
  } else {
    const sell = -diff;
    const p = ns.stock.sellStock(sym, sell);
    if (p > 0) ns.print(`↓ SELL ${sym} ${sell} @ ${fmt(ns, p)}`);
  }
}

// SHORT REBALANCE (SAFE)
async function rebalanceShort(ns, sym, currentShares, targetValue, cash) {
  if (!ns.stock.buyShort || !ns.stock.sellShort) return;
  if (!canShort) return;

  const price = ns.stock.getAskPrice(sym);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  const diff = targetShares - currentShares;
  if (Math.abs(diff) < 10) return;

  try {
    if (diff > 0) {
      let amt = Math.min(diff, Math.floor((cash - COMMISSION) / price));
      if (amt > 0) {
        const p = ns.stock.buyShort(sym, amt);
        if (p > 0) ns.print(`↑ SHORT ${sym} ${amt} @ ${fmt(ns, p)}`);
      }
    } else {
      const amt = -diff;
      const p = ns.stock.sellShort(sym, amt);
      if (p > 0) ns.print(`↓ COVER ${sym} ${amt} @ ${fmt(ns, p)}`);
    }
  } catch {
    canShort = false;
    ns.tprint("⚠ Shorts disabled: BitNode‑8 or SF8‑2 required.");
  }
}

// PORTFOLIO VALUE
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

// SUMMARY
function printSummary(ns, realized, trades, best, worst, avgVol, refreshRate) {
  const pv = calcPortfolioValue(ns);
  const cash = ns.getServerMoneyAvailable("home");
  const total = pv + cash;

  ns.print("\n══════════════════════════════════════════════════════");
  ns.print(`Total Capital : ${fmt(ns, total)}`);
  ns.print(`Portfolio     : ${fmt(ns, pv)}`);
  ns.print(`Cash          : ${fmt(ns, cash)}`);
  ns.print("──────────────────────────────────────────────────────");
  ns.print(`Realized P/L  : ${fmt(ns, realized)}`);
  ns.print(`Trades        : ${trades}`);
  ns.print(`Best Trade    : ${fmt(ns, best)}`);
  ns.print(`Worst Trade   : ${fmt(ns, worst)}`);
  ns.print("──────────────────────────────────────────────────────");
  ns.print(`Avg Volatility: ${(avgVol * 100).toFixed(3)}%`);
  ns.print(`Refresh       : ${refreshRate.toFixed(0)} ms`);
  ns.print("══════════════════════════════════════════════════════");
}
