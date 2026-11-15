// Token Radar's one derivation, shared by main.ts and the dashboard page.
//
// The same code scores the board and renders it: main.ts imports this file and the page loads it
// before app.js, so the number a detail view shows and the number board.json carries are the same
// arithmetic, never two copies of it. Pure functions only: no DOM, no network, no input/output.
//
// Model radar-2. An implied value is what a protocol's token would be worth if its record stayed as
// it is, priced off the tokens that already trade:
//
//   multiple   = the category's live-token multiple (below), clamped to [0.05, 1.50]
//   growth     = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   maturity   = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//   chains     = 1 + 0.02 x min(chains, 5)                (wider distribution, at most +10%)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity x chains))
//
// The category multiple is the median market-cap/TVL of the live-token protocols in the same
// category, read off this snapshot at run time: a category with fewer than three live tokens to
// compare against falls back to the median over every live token. No protocol name is ever
// special-cased, and no multiple is hard-coded: the same function scores every row.

const Derive = (() => {
  'use strict';

  /** The model's version label: the dashboard names it and the rules quote it. */
  const MODEL_VERSION = 'radar-2';

  /** The model's constants, as the dashboard states them. */
  const MODEL = {
    growth_weight: 0.5,
    growth_floor: -60,
    growth_cap: 120,
    maturity_floor: 0.6,
    maturity_range: 0.4,
    maturity_days: 1095,
    unknown_age_days: 365,
    comp_min_n: 3,
    comp_clamp_lo: 0.05,
    comp_clamp_hi: 1.5,
    chain_bonus: 0.02,
    chain_max: 5,
  };

  const DAY_MS = 86_400_000;

  /** A finite number, else `fallback`. */
  function finite(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  /** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
  function ageDays(asOf, listedAt) {
    if (listedAt === null || listedAt === undefined) return null;
    const a = Date.parse(asOf + 'T00:00:00Z');
    const b = Date.parse(listedAt + 'T00:00:00Z');
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.max(0, Math.floor((a - b) / DAY_MS));
  }

  /** The median of a non-empty list of numbers. */
  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
  const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

  /** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
  const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

  /** Categories the house rule keeps off the board: an exchange, a bridge, or a staked product. */
  const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

  /** Exchange names a protocol may not begin with: the house rule's list. */
  const EXCHANGES = new Set(['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini']);

  /** Whether a protocol records no token at all. */
  function isPreToken(p) {
    return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
  }

  /** Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
   * product of a protocol whose token already trades, by the house rule's own words. */
  function isRankable(p) {
    if (!isPreToken(p)) return false;
    if (EXCLUDED_CATEGORIES.has(p.category)) return false;
    if (VERSIONED.test(p.name)) return false;
    if (WRAPPED_WORD.test(p.name)) return false;
    const first = String(p.name).split(/\s+/)[0].toLowerCase();
    if (EXCHANGES.has(first)) return false;
    return true;
  }

  /**
   * The live-token comparables of a snapshot: every live token's market-cap/TVL, grouped by
   * category, with the median of each group and the median over all of them. A category with fewer
   * than MODEL.comp_min_n live tokens has no multiple of its own and falls back to the global one.
   */
  function comparables(protocols) {
    const byCategory = new Map();
    const all = [];
    for (const p of protocols) {
      if (p.mcap_usd === null || p.mcap_usd === undefined) continue;
      if (!(p.tvl_usd > 0)) continue;
      const ratio = p.mcap_usd / p.tvl_usd;
      if (!Number.isFinite(ratio) || ratio <= 0) continue;
      all.push(ratio);
      const key = p.category === null || p.category === undefined ? 'Other' : p.category;
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(ratio);
    }
    const globalMedian = all.length > 0 ? median(all) : 0.2;
    const rows = [];
    for (const [category, ratios] of byCategory) {
      const med = median(ratios);
      const own = ratios.length >= MODEL.comp_min_n;
      const raw = own ? med : globalMedian;
      rows.push({
        category,
        n: ratios.length,
        median: Math.round(med * 1000) / 1000,
        multiple: Math.min(MODEL.comp_clamp_hi, Math.max(MODEL.comp_clamp_lo, raw)),
        source: own ? 'category' : 'global',
      });
    }
    rows.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
    return { global_median: Math.round(globalMedian * 1000) / 1000, global_n: all.length, rows };
  }

  /** The multiple one category scores under, from the comparables of its snapshot. */
  function categoryMultiple(category, comps) {
    const key = category === null || category === undefined ? 'Other' : category;
    for (const row of comps.rows) {
      if (row.category === key) return { multiple: row.multiple, source: row.source, n: row.n, median: row.median };
    }
    return { multiple: Math.min(MODEL.comp_clamp_hi, Math.max(MODEL.comp_clamp_lo, comps.global_median)), source: 'global', n: 0, median: null };
  }

  /** The multipliers and the implied value one protocol gets under `model` and `comps`. */
  function impliedValue(protocol, asOf, model, comps) {
    const age = ageDays(asOf, protocol.listed_at);
    const comp = categoryMultiple(protocol.category, comps);
    const rawGrowth = finite(protocol.change_7d, 0);
    const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
    const growthMult = 1 + (growthPct / 100) * model.growth_weight;
    const ageForModel = age === null || age === undefined ? model.unknown_age_days : age;
    const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    const chainCount = Array.isArray(protocol.chains) ? protocol.chains.length : 0;
    const chainMult = 1 + model.chain_bonus * Math.min(chainCount, model.chain_max);
    const implied = Math.max(1, Math.round(protocol.tvl_usd * comp.multiple * growthMult * maturityMult * chainMult));
    return { implied, multiple: comp.multiple, source: comp.source, compN: comp.n, compMedian: comp.median, growthPct, growthMult, maturityMult, chainMult, age };
  }

  /** The first chain a protocol names, or a neutral phrase. */
  function chainOf(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }

  /** How much capital one farm position needs, from the protocol's own TVL. */
  function capitalFor(p) {
    if (p.tvl_usd >= 5_000_000_000) return 250;
    if (p.tvl_usd >= 1_000_000_000) return 150;
    if (p.tvl_usd >= 100_000_000) return 100;
    return 50;
  }

  /** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  /**
   * The category's one action and its weekly action, in the words a farmer can follow. Each entry
   * names the pattern it matches first, so a more specific category wins over a general one.
   */
  const ACTIONS = [
    { re: /uncollateralized/i, action: (n, c, ch) => 'Supply $' + c + ' of collateral to ' + n + ' on ' + ch + ' without locking it, and keep the loan open.', weekly: 'Draw a small loan against the position once, then repay it in the same week.' },
    { re: /cdp manager/i, action: (n, c, ch) => 'Open a ' + n + ' vault on ' + ch + ' with $' + c + ' of collateral and mint a small amount against it.', weekly: 'Top up or draw from the vault once, keeping the collateral ratio safe.' },
    { re: /lend|cdp|collateral/i, action: (n, c, ch) => 'Supply $' + c + ' of USDC to ' + n + ' on ' + ch + ' and keep the position open.', weekly: 'Borrow a small amount against the supply once, then repay it in the same week.' },
    { re: /dex|amm/i, action: (n, c, ch) => 'Provide $' + c + ' of liquidity to ' + n + "'s main pool on " + ch + ' and keep the position open.', weekly: 'Swap a small amount through the pool once, in either direction.' },
    { re: /basis trad/i, action: (n, c, ch) => 'Deposit $' + c + ' into ' + n + "'s basis vault on " + ch + ' and hold the position.', weekly: 'Check the vault funding once and rebalance a small amount if it drifted.' },
    { re: /leveraged farm|farm/i, action: (n, c, ch) => 'Deposit $' + c + ' of USDC into ' + n + "'s main farm on " + ch + ' and keep the position open.', weekly: 'Harvest or compound the farm yield once.' },
    { re: /yield aggregator/i, action: (n, c, ch) => 'Deposit $' + c + ' into a ' + n + ' vault on ' + ch + ' and keep the shares.', weekly: 'Move a small amount between the vault strategies once.' },
    { re: /yield/i, action: (n, c, ch) => 'Deposit $' + c + ' of USDC into ' + n + "'s main vault on " + ch + ' and keep the shares.', weekly: 'Harvest or compound the vault yield once.' },
    { re: /curator|allocator/i, action: (n, c, ch) => 'Deposit $' + c + ' into a ' + n + '-curated vault on ' + ch + ' and keep the shares.', weekly: 'Check the vault allocation once and move a small amount if the curator reallocated.' },
    { re: /restak|staking/i, action: (n, c, ch) => "Stake $" + c + " of the chain's staking asset through " + n + ' and keep the receipt.', weekly: 'Restake the staking rewards once.' },
    { re: /perpetual|derivative|options|interest rate/i, action: (n, c, ch) => 'Deposit $' + c + ' of USDC as margin on ' + n + ' and open one small hedge.', weekly: 'Close and reopen the hedge once so the position stays active.' },
    { re: /prediction/i, action: (n, c, ch) => 'Fund $' + c + ' and place one market position on ' + n + '.', weekly: 'Settle or roll one market position.' },
    { re: /stable/i, action: (n, c, ch) => 'Mint or deposit $' + c + ' of the stable asset through ' + n + ' on ' + ch + '.', weekly: 'Redeem and re-mint a small amount once to keep the position fresh.' },
    { re: /rwa/i, action: (n, c, ch) => 'Mint $' + c + " of the protocol's yield asset on " + ch + ' and hold it.', weekly: 'Claim or compound the asset yield once.' },
    { re: /insurance/i, action: (n, c, ch) => 'Buy $' + c + ' of cover from ' + n + ' on ' + ch + ' and keep the policy.', weekly: 'Check the cover terms once and renew a small amount if it lapsed.' },
    { re: /bridge/i, action: (n, c, ch) => 'Bridge $' + c + ' of USDC to ' + ch + ' through ' + n + ' and use the bridged funds in its app.', weekly: 'Bridge a small amount back and forth once.' },
    { re: /anchor btc|decentralized btc/i, action: (n, c, ch) => 'Mint $' + c + ' of the BTC-backed asset on ' + ch + ' and hold it.', weekly: 'Mint a small amount of the asset once more.' },
    { re: /liquidity manager/i, action: (n, c, ch) => 'Deposit $' + c + ' into a ' + n + '-managed liquidity position on ' + ch + ' and keep it open.', weekly: 'Check the managed range once and rebalance a small amount if it moved.' },
    { re: /payments/i, action: (n, c, ch) => 'Hold a $' + c + ' balance in ' + n + ' on ' + ch + ' and make one payment through it.', weekly: 'Make one payment through the rail.' },
    { re: /governance/i, action: (n, c, ch) => 'Lock $' + c + ' with ' + n + ' on ' + ch + ' and vote once while it is locked.', weekly: 'Vote on one live proposal.' },
    { re: /index/i, action: (n, c, ch) => 'Buy $' + c + ' of the ' + n + ' index on ' + ch + ' and hold it.', weekly: 'Rebalance a small amount into the index.' },
    { re: /otc/i, action: (n, c, ch) => 'Place one $' + c + ' order through ' + n + ' on ' + ch + ' and settle it.', weekly: 'Settle one small order.' },
    { re: /cedefi/i, action: (n, c, ch) => 'Deposit $' + c + " into " + n + "'s vault on " + ch + ' and keep the position.', weekly: 'Check the vault yield once and top up a small amount.' },
    { re: /chain/i, action: (n, c, ch) => 'Bridge $' + c + ' of USDC to ' + ch + ' and use its flagship app once.', weekly: 'Use one app on the chain.' },
    { re: /card/i, action: (n, c, ch) => 'Top up a ' + n + ' card with $' + c + ' on ' + ch + ' and spend once through it.', weekly: 'Spend once through the card.' },
  ];

  /** The category's action and weekly action, from the table above, or the neutral fallback. */
  function actionFor(p, capital, chain) {
    const c = p.category || '';
    for (const entry of ACTIONS) {
      if (entry.re.test(c)) return { action: entry.action(p.name, capital, chain), weekly: entry.weekly };
    }
    return {
      action: 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.',
      weekly: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.',
    };
  }

  /** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
  function stepText(step) {
    let s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  /**
   * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
   * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
   * names.
   */
  function farmSteps(p, age) {
    const chain = chainOf(p);
    const capital = capitalFor(p);
    const hold = holdDaysFor(age);
    const found = actionFor(p, capital, chain);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: found.action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: found.weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' },
    ].map(stepText);
  }

  return {
    MODEL_VERSION, MODEL, finite, ageDays, median, isPreToken, isRankable,
    comparables, categoryMultiple, impliedValue, chainOf, capitalFor, holdDaysFor,
    actionFor, stepText, farmSteps,
  };
})();

if (typeof module !== 'undefined') module.exports = Derive;
if (typeof window !== 'undefined') window.Derive = Derive;
