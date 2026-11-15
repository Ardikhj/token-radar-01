// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own
// inputs and the protocol's farm plan. No network: every byte it shows is in data.js. The model and
// the farm plan come from Derive (derive.js), the same derivation main.ts runs, so the page never
// re-implements the arithmetic it displays.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var DERIVE = window.Derive;
  if (!DATA || !DERIVE) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', wl: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) {
    return n.toFixed(2) + 'x';
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('wl') === '1') state.wl = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.wl) params.set('wl', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.wl && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // Chain totals are computed on the page from the same rows the board shows, so the panel can
  // never disagree with the table. A protocol deployed on several chains counts under each of
  // them, which is why the chain totals overlap and add up to more than the board itself.
  function chainTotals() {
    var byChain = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (c) {
        var t = byChain[c];
        if (!t) t = byChain[c] = { chain: c, count: 0, watchlist: 0, implied: 0, values: [], bestGrowth: null, top: null };
        t.count += 1;
        if (r.watchlist) t.watchlist += 1;
        t.implied += r.implied_value_usd || 0;
        t.values.push(r.implied_value_usd || 0);
        if (r.change_7d !== null && r.change_7d !== undefined && (t.bestGrowth === null || r.change_7d > t.bestGrowth)) t.bestGrowth = r.change_7d;
        if (!t.top || (r.implied_value_usd || 0) > (t.top.implied_value_usd || 0)) t.top = r;
      });
    });
    return Object.keys(byChain).map(function (k) {
      var t = byChain[k];
      var ordered = t.values.slice().sort(function (a, b) { return a - b; });
      t.median = ordered.length ? ordered[Math.floor(ordered.length / 2)] : 0;
      delete t.values;
      return t;
    }).sort(function (a, b) { return b.implied - a.implied; });
  }

  function chainPanel() {
    var totals = chainTotals();
    var shown = totals.slice(0, 12);
    var panelTotal = totals.reduce(function (s, t) { return s + t.implied; }, 0);
    var boardTotal = DATA.rows.reduce(function (s, r) { return s + (r.implied_value_usd || 0); }, 0);
    var head = el('div', { class: 'chains-head' },
      el('div', null,
        el('h2', { text: 'Implied value by chain' }),
        el('p', { class: 'sub', text: 'Top ' + shown.length + ' of ' + totals.length + ' chains, by the implied value of their pre-token protocols. Select a chain to filter the board to it; select it again to clear.' })
      ),
      state.chain !== 'all'
        ? el('button', { class: 'button', type: 'button', text: 'Clear chain filter', onclick: function () { state.chain = 'all'; writeHash(); render(); } })
        : null
    );
    var grid = el('div', { class: 'chains' });
    shown.forEach(function (t) {
      var share = panelTotal ? (t.implied / panelTotal) * 100 : 0;
      var topImplied = totals[0] ? totals[0].implied : 0;
      var barWidth = topImplied ? Math.max(2, Math.round((t.implied / topImplied) * 100)) : 0;
      var wlNote = t.watchlist ? ' · ' + t.watchlist + ' watchlist' : '';
      var growthNote = t.bestGrowth === null ? '' : ' · best 7d ' + fmtPct(t.bestGrowth);
      var row = el('button', {
        type: 'button',
        class: 'chain-row' + (state.chain === t.chain ? ' active' : ''),
        'aria-pressed': state.chain === t.chain ? 'true' : 'false',
        'aria-label': t.chain + ': ' + t.count + ' pre-token protocols, ' + fmtUsd(t.implied) + ' implied value. Filter the board to this chain.',
        onclick: function () {
          state.chain = state.chain === t.chain ? 'all' : t.chain;
          state.tab = 'pre-token';
          writeHash();
          render();
        }
      },
        el('span', { class: 'chain-name', text: t.chain }),
        el('span', { class: 'chain-count', text: t.count + ' protocol' + (t.count === 1 ? '' : 's') + wlNote }),
        el('span', { class: 'chain-bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + barWidth + '%' })),
        el('span', { class: 'chain-implied num', text: fmtUsd(t.implied) }),
        el('span', { class: 'chain-share num', text: share.toFixed(1) + '% of chain totals' }),
        el('span', { class: 'chain-median sub', text: 'Median ' + fmtUsd(t.median) + growthNote }),
        el('span', { class: 'chain-top sub', text: 'Top: ' + (t.top ? t.top.name : 'n/a') })
      );
      grid.appendChild(row);
    });
    var foot = el('p', { class: 'sub', text: 'Chain totals add up to ' + fmtUsd(panelTotal) + ' against ' + fmtUsd(boardTotal) + ' on the board. The gap is the overlap: a protocol deployed on several chains is counted under each of them.' });
    return el('section', { class: 'panel chains-panel' }, head, grid, foot);
  }

  function csvCell(value) {
    var s = value === null || value === undefined ? '' : String(value);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // The export takes exactly the rows the board is showing right now: the same filters, the same
  // sort, the same tab. On the live-token tab the implied-value column carries the market cap and
  // there is no farm plan to export, so that column stays empty.
  function exportCsv() {
    var preToken = state.tab === 'pre-token';
    var list = preToken ? sortedRows(rows()) : DATA.live.slice();
    var header = ['rank', 'name', 'category', 'chains', 'tvl_usd', 'change_7d', 'age_days', 'implied_value_usd', 'token_status', 'farm_steps'];
    var lines = [header.join(',')];
    list.forEach(function (r) {
      var steps = preToken ? DERIVE.farmSteps(r, r.age_days).join(' | ') : '';
      lines.push([
        csvCell(preToken ? r.rank : 'live'),
        csvCell(r.name),
        csvCell(r.category || 'Other'),
        csvCell((r.chains || []).join('; ')),
        csvCell(r.tvl_usd),
        csvCell(r.change_7d),
        csvCell(r.age_days),
        csvCell(preToken ? r.implied_value_usd : r.mcap_usd),
        csvCell(preToken ? 'no token' : 'already trades'),
        csvCell(steps)
      ].join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'token-radar-' + (preToken ? 'pre-token' : 'live-token') + '-' + DATA.as_of + '.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols the house rule keeps, at any TVL. Implied value is a model, not a promise.' }),
        el('p', { text: 'Each row is priced off the tokens that already trade: its TVL times its category\u2019s live-token multiple, adjusted for seven-day growth, age with no token, and chain breadth.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows beyond the watchlist' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainCounts[c] = (chainCounts[c] || 0) + 1; }); });
    var chains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 20);
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c + ' (' + chainCounts[c] + ')', selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var wlBox = el('input', { type: 'checkbox', id: 'wl', checked: state.wl ? 'checked' : null, 'aria-label': 'Watchlist only' });
    wlBox.addEventListener('change', function () { state.wl = wlBox.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('label', { class: 'check', for: 'wl' }, wlBox, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('button', { class: 'button export', type: 'button', text: 'Export CSV', onclick: function () { exportCsv(); } }),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.wl = false; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' + (r.rank <= 3 ? ' rank-top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('div', { class: 'row-tags' }, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'tag', text: 'Watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap/TVL is what prices the board.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var comps = DATA.comparables.rows.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    var compRows = comps.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.n) }),
        el('td', { class: 'num', text: c.median === null ? 'n/a' : fmtMult(c.median) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'sub', text: c.source === 'category' ? 'category median' : 'global median' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x category multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + 0.02 x min(chains, 5)) )'
      ),
      el('p', { class: 'sub', text: 'The category multiple is the median market-cap/TVL of the live tokens in the same category, read off this snapshot. A category with fewer than ' + m.comp_min_n + ' live tokens to compare against uses the median over all ' + DATA.comparables.global_n + ' live tokens (' + fmtMult(DATA.comparables.global_median) + '), and every multiple is clamped to [' + m.comp_clamp_lo + ', ' + m.comp_clamp_hi + ']. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Wrapped, staked and bridged products of tokens that already trade, and exchanges, are kept off the board by the house rule, so no row is a token in disguise.' }),
      el('h3', { text: 'Live-token comparables by category' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'comps' },
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Live tokens' }),
            el('th', { scope: 'col', text: 'Median mcap/TVL' }),
            el('th', { scope: 'col', text: 'Multiple applied' }),
            el('th', { scope: 'col', text: 'Source' })
          )),
          el('tbody', null, compRows)
        )
      ),
      el('p', { class: 'note', text: 'What this board is not: it does not predict whether or when a protocol issues a token. A protocol that records no token may still have one its record does not carry, and an implied value is this entry\u2019s own claim, never a price.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = DERIVE.farmSteps(row, row.age_days);
    // The page recomputes this row with the same derivation main.ts runs, and says whether the
    // number matches the one board.json carries.
    var check = DERIVE.impliedValue(row, DATA.as_of, DATA.model, DATA.comparables);
    var compNote = row.multiple_source === 'category'
      ? 'Median of ' + row.comp_n + ' live ' + (row.category || 'Other') + ' tokens.'
      : 'Too few live ' + (row.category || 'Other') + ' tokens to compare against, so the global median over ' + DATA.comparables.global_n + ' live tokens.';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  Watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: String(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: String(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: String(row.chain_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: compNote }),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(check.implied) + (check.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price. The snapshot records no token for this protocol, which is not proof it has none.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(chainPanel());
      shell.appendChild(modelPanel());
    }
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
