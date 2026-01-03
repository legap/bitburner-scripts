/** stock-trader-quant-balanced.js
 * Quant‑balanced stock trader.
 *
 * Features:
 * - Score-based allocation per symbol:
 *     score = strength + momentum - volatilityPenalty
 * - Capital allocated proportionally to positive scores
 * - Balanced risk: max 15% of capital per stock
 * - Long + short support (shorts auto‑disable if unavailable)
 * - Commission‑aware rebalancing (avoids tiny, pointless trades)
 *
 * Usage:
 *   run stock-trader-quant-balanced.js [max-stocks] [profit-target] [stop-loss] [refresh-ms]
 *
 * Example:
 *   run stock-trader-quant-balanced.js 15 0.18 0.10 5000
 */

const COMMISSION = 100000;
const EXIT_THRESHOLD = 0.01;       // Too close to neutral → no position
const LONG_THRESHOLD = 0.52;       // Prefer long above this
const SHORT_THRESHOLD = 0.48;      // Prefer short below this
const MAX_POSITION_FRACTION = 0.15; // Max 15% of total capital per stock
const MIN_TRADE_VALUE = 10 * COMMISSION; // Don't rebalance for smaller value changes

// Global shorting flag (auto‑disabled on first failure)
let canShort = false;

// State maps for momentum & volatility
const lastForecasts = new Map();
const lastPrices = new Map();

function fmt(ns, v, pattern = "$0.00a") {
  try { return ns.nFormat(v, pattern); }
  catch { return v.toFixed(2); }
}

/** @param {NS} ns */
export async function main(ns) {
  const maxStocks    = Number(ns.args[0] ?? 15);
  const profitTarget = Number(ns.args[1] ?? 0.18);
  const stopLoss     = Number(ns.args[2] ?? 0.10);
  let   refreshRate  = Number(ns.args[3] ?? 5000);

  if (!ns.stock.hasWSEAccount() || !ns.stock.hasTIXAPIAccess()) {
    ns.tprint("ERROR: TIX API Access required.");
    return;
  }
  if (!ns.stock.has4SDataTIXAPI()) {
    ns.tprint("ERROR: 4S Market Data TIX API required.");
    return;
  }
  if (profitTarget <= 0 || profitTarget > 1 || stopLoss <= 0 || stopLoss > 1) {
    ns.tprint("ERROR: profit-target and stop-loss must be between 0 and 1.");
    return;
  }

  canShort = typeof ns.stock.buyShort === "function";

  ns.disableLog("ALL");
  ns.clearLog();
  ns.tail();

  ns.tprint("══════════════════════════════════════════════════════════════");
  ns.tprint(" QUANT‑BALANCED STOCK TRADER – STARTING");
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

    /** @type {{sym:string, forecast:number, strength:number, momentum:number, volatility:number, score:number}[]} */
    const metrics = [];
    let totalVol = 0;

    for (const sym of symbols) {
      const forecast = ns.stock.getForecast(sym);
      const price = ns.stock.getAskPrice(sym);

      const strength = Math.abs(forecast - 0.5);       // 0–0.5
      const momentum = getMomentum(sym, forecast);     // delta forecast
      const volatility = getVolatility(sym, price);    // |Δp| / p
      const score = quantScore(strength, momentum, volatility);

      metrics.push({ sym, forecast, strength, momentum, volatility, score });
      totalVol += volatility;
    }

    const avgVol = metrics.length ? totalVol / metrics.length : 0;

    // Quant-balanced: refresh reacts a bit to volatility, but not extreme
    if (avgVol > 0.02) refreshRate = Math.max(3000, refreshRate * 0.9);
    else refreshRate = Math.min(8000, refreshRate * 1.05);

    // Filter to symbols with positive score
    const positive = metrics.filter(m => m.score > 0);
    // Sort by score descending
    positive.sort((a, b) => b.score - a.score);
    const candidates = positive.slice(0, maxStocks);

    const totalScore = candidates.reduce((sum, m) => sum + m.score, 0);

    // 3) REBALANCE BASED ON SCORE‑WEIGHTED ALLOCATION
    for (const m of candidates) {
      const { sym, forecast, score } = m;
      if (score <= 0 || totalScore <= 0) continue;

      const [longShares, , shortShares] = ns.stock.getPosition(sym);
      const bullish = forecast > LONG_THRESHOLD;
      const bearish = forecast < SHORT_THRESHOLD;

      // Target capital for this symbol based on normalized score
      let targetValue = (score / totalScore) * totalCap;
      const cappedValue = Math.min(targetValue, totalCap * MAX_POSITION_FRACTION);

      // Neutral-ish: no position
      if (Math.abs(forecast - 0.5) < EXIT_THRESHOLD) {
        // Let exit logic clear positions; skip further allocation
        continue;
      }

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

/** Quant score: balanced view of strength, momentum, volatility */
function quantScore(strength, momentum, volatility) {
  // Reasonable scaling for a balanced model
  const s = strength * 3;                                // up to ~1.5
  const mom = Math.max(-0.4, Math.min(0.4, momentum * 40)); // clamp
  const volPenalty = Math.min(1.0, volatility * 20);     // 0–1

  return s + mom - volPenalty;
}

/** Momentum: forecast delta since last cycle */
function getMomentum(sym, forecast) {
  const prev = lastForecasts.get(sym) ?? forecast;
  lastForecasts.set(sym, forecast);
  return forecast - prev;
}

/** Volatility: absolute price change ratio since last cycle */
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
  if (deltaValue < MIN_TRADE_VALUE) return; // not worth the commission

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
