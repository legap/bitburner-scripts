/** stock-trader-quant-highperf.js
 * High‑performance quant stock trader.
 *
 * Strategy:
 * - Compute score per symbol: strength + momentum - light volatility penalty
 * - Allocate capital proportional to scores
 * - Long above 0.5, short below 0.5 (if shorts available)
 * - Max 20% of total capital per stock
 * - Minimal trade threshold so it actually trades
 *
 * Usage:
 *   run stock-trader-quant-highperf.js [max-stocks] [profit-target] [stop-loss] [refresh-ms]
 */

const COMMISSION = 100000;
const EXIT_NEUTRAL_THRESHOLD = 0.005;    // used only for exits
const LONG_THRESHOLD = 0.5;              // any forecast > 0.5 = bullish
const SHORT_THRESHOLD = 0.5;             // any forecast < 0.5 = bearish
const MAX_POSITION_FRACTION = 0.20;      // max 20% per stock
const MIN_TRADE_VALUE = COMMISSION * 2;  // very small to avoid blocking

// Global short flag
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
  const profitTarget = Number(ns.args[1] ?? 0.20);
  const stopLoss     = Number(ns.args[2] ?? 0.12);
  let   refreshRate  = Number(ns.args[3] ?? 4000);

  if (!ns.stock.hasWSEAccount() || !ns.stock.hasTIXAPIAccess()) {
    ns.tprint("ERROR: TIX API Access required.");
    return;
  }
  if (!ns.stock.has4SDataTIXAPI()) {
    ns.tprint("ERROR: 4S Market Data TIX API required.");
    return;
  }

  canShort = typeof ns.stock.buyShort === "function";

  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();

  ns.tprint("══════════════════════════════════════════════════════");
  ns.tprint(" HIGH‑PERFORMANCE QUANT STOCK TRADER – STARTING");
  ns.tprint("══════════════════════════════════════════════════════");
  ns.tprint(`Max Stocks    : ${maxStocks}`);
  ns.tprint(`Profit Target : ${(profitTarget * 100).toFixed(1)}%`);
  ns.tprint(`Stop Loss     : ${(stopLoss * 100).toFixed(1)}%`);
  ns.tprint(`Shorts        : ${canShort ? "ENABLED" : "DISABLED"}`);
  ns.tprint(`Base Refresh  : ${refreshRate}ms`);
  ns.tprint("══════════════════════════════════════════════════════\n");

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

      // Long exit
      if (longShares > 0) {
        const gross = (bid - longPrice) * longShares;
        const net = gross - 2 * COMMISSION;
        const pct = net / (longShares * longPrice);

        const exit =
          pct >= profitTarget ||
          pct <= -stopLoss ||
          Math.abs(forecast - 0.5) < EXIT_NEUTRAL_THRESHOLD;

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

      // Short exit
      if (shortShares > 0 && canShort) {
        const gross = (shortPrice - ask) * shortShares;
        const net = gross - 2 * COMMISSION;
        const pct = net / (shortShares * shortPrice);

        const exit =
          pct >= profitTarget ||
          pct <= -stopLoss ||
          Math.abs(forecast - 0.5) < EXIT_NEUTRAL_THRESHOLD;

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

    // 2) CAPITAL + METRICS
    const portfolioValue = calcPortfolioValue(ns);
    const cash = ns.getServerMoneyAvailable("home");
    const totalCap = portfolioValue + cash;

    const metrics = [];
    let totalVol = 0;

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const price = ns.stock.getAskPrice(sym);

      const strength = Math.abs(forecast - 0.5);        // 0–0.5
      const momentum = getMomentum(sym, forecast);      // Δforecast
      const volatility = getVolatility(sym, price);     // |Δp|/p
      const score = quantScoreHighPerf(strength, momentum, volatility);

      metrics.push({ sym, forecast, strength, momentum, volatility, score });
      totalVol += volatility;
    }

    const avgVol = metrics.length ? totalVol / metrics.length : 0;

    // React to volatility (slightly)
    if (avgVol > 0.02) refreshRate = Math.max(2000, refreshRate * 0.9);
    else refreshRate = Math.min(7000, refreshRate * 1.05);

    // Debug: top few symbols
    for (const m of metrics.slice(0, 5)) {
      ns.print(
        `${m.sym} | f=${(m.forecast*100).toFixed(2)}% | ` +
        `str=${m.strength.toFixed(4)} | ` +
        `mom=${m.momentum.toFixed(4)} | ` +
        `vol=${(m.volatility*100).toFixed(3)}% | ` +
        `score=${m.score.toFixed(4)}`
      );
    }

    // 3) SELECTION BY SCORE
    let positive = metrics.filter(m => m.score > -1); // allow almost all
    positive.sort((a, b) => b.score - a.score);
    positive = positive.slice(0, maxStocks);

    const totalScore = positive.reduce((sum, m) => sum + Math.max(m.score, 0.01), 0);

    // 4) REBALANCE BASED ON SCORE-WEIGHTED ALLOCATION
    for (const m of positive) {
      const { sym, forecast } = m;
      const score = Math.max(m.score, 0.01);
      const [longShares, , shortShares] = ns.stock.getPosition(sym);

      const bullish = forecast > LONG_THRESHOLD;
      const bearish = forecast < SHORT_THRESHOLD;

      let targetValue = (score / totalScore) * totalCap;
      const cappedValue = Math.min(targetValue, totalCap * MAX_POSITION_FRACTION);

      if (bullish) {
        await rebalanceLong(ns, sym, longShares, cappedValue, cash);
      } else if (bearish && canShort) {
        await rebalanceShort(ns, sym, shortShares, cappedValue, cash);
      }
    }

    printSummary(ns, realizedProfit, trades, best, worst, avgVol, refreshRate);
    await ns.sleep(refreshRate);
  }
}

/** Strong strength & momentum, gentle volatility penalty */
function quantScoreHighPerf(strength, momentum, volatility) {
  const s = strength * 4.5;
  const mom = Math.max(-0.6, Math.min(0.6, momentum * 60));
  const volPenalty = volatility * 1.5;
  return s + mom - volPenalty;
}

function getMomentum(sym, forecast) {
  const prev = lastForecasts.get(sym) ?? forecast;
  lastForecasts.set(sym, forecast);
  return forecast - prev;
}

function getVolatility(sym, price) {
  if (!Number.isFinite(price) || price <= 0) return 0;
  const prev = lastPrices.get(sym) ?? price;
  lastPrices.set(sym, price);
  return Math.abs(price - prev) / price;
}

/** @param {NS} ns */
async function rebalanceLong(ns, sym, currentShares, targetValue, cash) {
  const price = ns.stock.getAskPrice(sym);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  const diff = targetShares - currentShares;
  if (diff === 0) return;

  const deltaValue = Math.abs(diff) * price;
  if (deltaValue < MIN_TRADE_VALUE) return;

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

/** @param {NS} ns */
async function rebalanceShort(ns, sym, currentShares, targetValue, cash) {
  if (!ns.stock.buyShort || !ns.stock.sellShort) return;
  if (!canShort) return;

  const price = ns.stock.getAskPrice(sym);
  if (price <= 0) return;

  const targetShares = Math.floor((targetValue - COMMISSION) / price);
  const diff = targetShares - currentShares;
  if (diff === 0) return;

  const deltaValue = Math.abs(diff) * price;
  if (deltaValue < MIN_TRADE_VALUE) return;

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
