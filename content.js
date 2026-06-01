(function () {
  'use strict';
  if (window.__gmrs_loaded__) return;
  window.__gmrs_loaded__ = true;

  var HOST_ID = '__gmaps_rating_stats_host__';
  var refs = null;
  var lastRenderKey = '';
  var curPlace = '';
  var seenAt = 0;
  var dragState = null;
  var aiCache = {};            // normal verdict cache (per place key)
  var deepCache = {};          // deep (reviews-only) verdict cache (per place key)
  var curCtx = null;           // latest {r,key,c,a} so the header 🔬 button can run deep analysis
  var autoTimer = null;
  var countTimer = null;       // countdown before an automatic retry
  var curKey = null;           // place currently shown (guards stale AI callbacks)
  var MAX_AUTO_RETRY = 2;      // how many times to auto-wait+retry on rate/overload
  var AUTO_MAX_SEC = 45;       // only auto-wait when the server asks for <= this many seconds

  function isDark() { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); }

  // ---------- i18n ----------
  // Language is decided once per render from the stored uiLang ('auto'|'ja'|'en').
  // 'auto' follows Google Maps' page language (<html lang>) first, then navigator.language.
  var LANG = 'ja';
  function detectLang() {
    var hl = (document.documentElement.getAttribute('lang') || '').toLowerCase();
    if (hl.indexOf('ja') === 0) return 'ja';
    if (hl) return 'en';
    var nl = (navigator.language || 'en').toLowerCase();
    return nl.indexOf('ja') === 0 ? 'ja' : 'en';
  }
  function applyLang(stored) {
    LANG = (stored === 'ja' || stored === 'en') ? stored : detectLang();
  }
  function isJa() { return LANG === 'ja'; }

  // String table. Keys are stable; values pick by LANG. Use S('key') for fixed strings.
  var STR = {
    panelTitle:   { ja: '口コミ評価分析', en: 'Review Rating Analysis' },
    recalc:       { ja: '再計算', en: 'Recalculate' },
    loadingTitle: { ja: '読み込み中…', en: 'Loading…' },
    loadingSub:   { ja: 'レビュー分布を取得しています', en: 'Fetching the rating distribution…' },
    noDistTitle:  { ja: '評価分布が見つかりません', en: 'No rating distribution found' },
    noDistSub:    { ja: 'この場所にはクチコミの星分布が無いか、まだ読み込まれていません。', en: 'This place has no star-rating breakdown, or it hasn’t loaded yet.' },
    secKpi:       { ja: '主要指標', en: 'Key metrics' },
    secChart:     { ja: '星評価別の口コミ分布', en: 'Rating distribution' },
    secPolar:     { ja: '二極化・リスク分析', en: 'Polarization & risk' },
    secReli:      { ja: '信頼性・統計的安全性', en: 'Reliability & statistical safety' },
    secAdv:       { ja: '分布の高度分析', en: 'Advanced distribution analysis' },
    secCat:       { ja: '賛否の3分類', en: 'Sentiment split' },
    legMeasured:  { ja: '実測', en: 'Observed' },
    legNormal:    { ja: '正規分布近似（補助）', en: 'Normal approx. (aux)' },
    cMean:        { ja: '平均評価', en: 'Mean rating' },
    cMedian:      { ja: '中央値', en: 'Median' },
    cMode:        { ja: '最頻値', en: 'Mode' },
    cHigh:        { ja: '高評価率', en: 'Positive rate' },
    cLow:         { ja: '低評価率', en: 'Negative rate' },
    cExtreme:     { ja: '極端評価率', en: 'Extreme rate' },
    mPolar:       { ja: '分極化指数', en: 'Polarization index' },
    mPolarI:      { ja: '3★からの離れ具合。0=中立寄り / 1=両極端', en: 'Distance from 3★. 0 = centered / 1 = both extremes' },
    mDisagree:    { ja: '評価不一致確率', en: 'Disagreement prob.' },
    mDisagreeI:   { ja: '無作為な2人の評価が異なる確率', en: 'Chance two random reviewers differ' },
    mStrong:      { ja: '強い不一致確率', en: 'Strong disagreement' },
    mStrongI:     { ja: '2人の評価差が3★以上になる確率', en: 'Chance their ratings differ by 3★+' },
    mMeanDiff:    { ja: '平均評価差', en: 'Mean pairwise gap' },
    mMeanDiffI:   { ja: '無作為な2人の星の平均的なズレ', en: 'Average star gap between two reviewers' },
    mLoveHate:    { ja: 'Love-Hate比', en: 'Love–Hate ratio' },
    mLoveHateI:   { ja: '5★件数 ÷ 1★件数。1超で熱烈支持が優勢', en: '5★ ÷ 1★. Above 1 = enthusiasts dominate' },
    mTopBottom:   { ja: 'Top − Bottom', en: 'Top − Bottom' },
    mTopBottomI:  { ja: '5★率 − 1★率', en: '5★ rate − 1★ rate' },
    mHighDom:     { ja: '高評価優勢確率', en: 'Positive-dominance prob.' },
    mHighDomI:    { ja: '高評価率が低評価率を上回っている確実性', en: 'Confidence positives outweigh negatives' },
    mWilson:      { ja: '高評価率 95%CI', en: 'Positive rate 95% CI' },
    mWilsonI:     { ja: 'Wilson法。保守的に見た高評価率の範囲', en: 'Wilson interval; conservative positive-rate range' },
    mMeanCI:      { ja: '平均評価 95%CI', en: 'Mean 95% CI' },
    mMeanCII:     { ja: '平均値の不確実性を考慮した範囲', en: 'Range accounting for uncertainty in the mean' },
    mRiskMean:    { ja: 'リスク調整済み平均', en: 'Risk-adjusted mean' },
    mRiskMeanI:   { ja: '平均の95%下限。辛めに見た評価', en: 'Lower 95% bound of the mean; a strict read' },
    mEntropy:     { ja: '正規化エントロピー', en: 'Normalized entropy' },
    mEntropyI:    { ja: '0〜1。1ほど星全体に分散', en: '0–1; higher = spread across all stars' },
    mBimod:       { ja: '双峰性係数', en: 'Bimodality coeff.' },
    mBimodI:      { ja: '0.56超で双峰（2つの山）の可能性', en: 'Above 0.56 suggests two peaks' },
    mChi2:        { ja: '正規分布との乖離(χ²)', en: 'Deviation from normal (χ²)' },
    mChi2I:       { ja: '正規分布近似からのズレ。大きいほど非正規（補助スコア）', en: 'Gap from a normal fit; larger = less normal (aux)' },
    mShape:       { ja: '分布タイプ', en: 'Distribution type' },
    mShapeI:      { ja: '形の総合判定', en: 'Overall shape verdict' },
    catHigh:      { ja: '高評価', en: 'Positive' },
    catNeu:       { ja: '中立', en: 'Neutral' },
    catLow:       { ja: '低評価', en: 'Negative' },
    unitCount:    { ja: '件', en: '' },
    verdictTitle: { ja: '総合評価', en: 'Overall' },
    verdictPrefix:{ ja: '総合評価: ', en: 'Overall: ' },
    recPrefix:    { ja: 'おすすめ度: ', en: 'Recommendation: ' },
    genAI:        { ja: '\u2726 AIで生成', en: '\u2726 Generate with AI' },
    evaluating:   { ja: 'AIが評価中…', en: 'AI is evaluating…' },
    srcLocal:     { ja: '（ローカル）', en: '(local)' },
    srcWithRev:   { ja: '・口コミ本文を加味', en: ' · review text included' },
    noKeyManual:  { ja: 'APIキーが未設定です。', en: 'No API key set. ' },
    openOpts:     { ja: '設定を開く', en: 'Open settings' },
    retry:        { ja: '再試行', en: 'Retry' },
    genFail:      { ja: 'AI生成に失敗しました', en: 'AI generation failed' },
    footTail:     { ja: ' ・ 計算は端末内', en: ' · computed on-device' },
    footTotal:    { ja: '合計 ', en: 'Total ' },
    aiBusyQuota:  { ja: 'Geminiの無料枠のリクエスト上限に達しました（429）。', en: 'Hit the Gemini free-tier rate limit (429). ' },
    retryInSec:   { ja: function (s) { return '約' + s + '秒後に'; }, en: function (s) { return 'in ~' + s + 's'; } },
    retryLater:   { ja: 'しばらくしてから', en: 'after a short wait' },
    retryCan:     { ja: '再試行できます。', en: 'You can retry.' },
    autoRetry:    { ja: function (s, i, n) { return '約' + s + '秒後に自動再試行…（' + i + '/' + n + '）'; },
                    en: function (s, i, n) { return 'Auto-retry in ~' + s + 's… (' + i + '/' + n + ')'; } },
    deepLink:     { ja: '\uD83D\uDD2C 超分析（全レビュー読込）', en: '\uD83D\uDD2C Deep analysis (load all reviews)' },
    deepRedo:     { ja: '\uD83D\uDD2C 再分析（全レビュー読込）', en: '\uD83D\uDD2C Re-analyze (load all reviews)' },
    deepRunning:  { ja: '超分析中…', en: 'Deep-analyzing…' },
    deepHint:     { ja: 'レビュー本文を多数AIに送るため、トークン・費用・時間が大きく増えます', en: 'Sends many review texts to the AI — uses far more tokens, cost and time' },
    deepOpenTab:  { ja: 'クチコミタブを開いてから「超分析」を押してください。', en: 'Open the Reviews tab, then click “Deep analysis”.' },
    deepLoading:  { ja: function (n) { return 'レビューを読み込み中… ' + n + '件'; },
                    en: function (n) { return 'Loading reviews… ' + n; } },
    deepOpenTab2: { ja: 'クチコミタブに切り替えています…', en: 'Switching to the Reviews tab…' },
    deepGen:      { ja: function (n) { return '全' + n + '件を読み込み。AIが超分析中…'; },
                    en: function (n) { return 'Loaded ' + n + ' reviews. Deep-analyzing…'; } },
    srcDeep:      { ja: function (n) { return '・全' + n + '件読込'; }, en: function (n) { return ' · all ' + n + ' loaded'; } },
    backNormal:   { ja: '\u2190 通常分析に戻す', en: '\u2190 Back to normal analysis' },
    kwHead:       { ja: '分析に使った主なキーワード', en: 'Key terms used in this analysis' }
  };
  function S(k) { var e = STR[k]; return e ? (isJa() ? e.ja : e.en) : k; }

  var CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; }',
    '.panel {',
    '  position: fixed; top: 78px; right: 16px; width: 360px; max-width: calc(100vw - 32px);',
    '  background: var(--bg); color: var(--text); border: 1px solid var(--border);',
    '  border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; z-index: 2147483647;',
    '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", "Noto Sans JP", sans-serif;',
    '  font-size: 13px; line-height: 1.5;',
    '  --bg:#fff; --bg-soft:#f5f5f2; --tint:rgba(230,162,60,0.10); --text:#1b1b1a; --text-soft:#6c6c66; --text-faint:#9b9b95;',
    '  --border:rgba(0,0,0,0.10); --track:#eaeae6; --accent:#e6a23c; --shadow:0 8px 28px rgba(0,0,0,0.16);',
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  .panel { --bg:#1f1f1e; --bg-soft:#2a2a28; --tint:rgba(230,162,60,0.14); --text:#f2f2ef; --text-soft:#b3b3ad; --text-faint:#85857f;',
    '           --border:rgba(255,255,255,0.12); --track:#3a3a37; --accent:#e6a23c; --shadow:0 8px 28px rgba(0,0,0,0.55); }',
    '}',
    '.hd { display:flex; align-items:center; gap:8px; padding:9px 11px; cursor:move; user-select:none; border-bottom:1px solid var(--border); }',
    '.hd .ic { color:var(--accent); font-size:14px; }',
    '.hd .ti { font-weight:600; font-size:13px; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
    '.hd button { background:transparent; border:0; color:var(--text-soft); cursor:pointer; padding:3px 6px; border-radius:7px; font-size:14px; line-height:1; }',
    '.hd button:hover { background:var(--bg-soft); color:var(--text); }',
    '.chev { display:inline-block; transition: transform .18s ease; }',
    '.panel.collapsed .bd { display:none; }',
    '.panel.collapsed .chev { transform: rotate(-90deg); }',
    '.bd { padding:11px; max-height: calc(100vh - 150px); overflow-y:auto; overflow-x:hidden; scrollbar-width:thin; }',
    '.bd::-webkit-scrollbar { width:8px; } .bd::-webkit-scrollbar-thumb { background:var(--track); border-radius:4px; }',
    '.cards3 { display:grid; grid-template-columns:repeat(3,1fr); gap:7px; }',
    '.card { background:var(--bg-soft); border-radius:9px; padding:9px; }',
    '.card .cl { font-size:10px; color:var(--text-soft); margin-bottom:3px; white-space:nowrap; }',
    '.card .cv { font-size:17px; font-weight:600; letter-spacing:-.3px; font-variant-numeric:tabular-nums; }',
    '.card .u { font-size:10.5px; color:var(--text-faint); font-weight:400; margin-left:1px; }',
    '.sec { font-size:13px; font-weight:600; margin:15px 0 3px; }',
    '.concl { background:var(--tint); border-left:3px solid #e0a93d; border-radius:11px; padding:12px 13px; margin-bottom:4px; }',
    '.concl .ct { font-size:15px; font-weight:700; color:var(--text); margin-bottom:5px; letter-spacing:-.2px; line-height:1.3; }',
    '.concl .cs { font-size:11.5px; color:var(--text-soft); line-height:1.62; }',
    '.concl .cs .vh { font-size:11px; font-weight:700; color:var(--text); margin:9px 0 2px; padding-left:7px; border-left:2px solid var(--accent); letter-spacing:.1px; }',
    '.concl .cs .vh:first-child { margin-top:0; }',
    '.concl .cs .vb { font-size:11.5px; color:var(--text-soft); line-height:1.62; margin-bottom:2px; }',
    '.concl .cs .kw { display:flex; flex-wrap:wrap; gap:5px; margin:3px 0 2px; }',
    '.concl .cs .kw .kwt { font-size:10.5px; color:var(--text); background:var(--tint); border:1px solid var(--border); border-radius:11px; padding:2px 8px; white-space:nowrap; }',
    '.concl .rec { font-size:13px; font-weight:700; margin:3px 0 8px; }',
    '.concl .csrc { margin-top:6px; font-size:10px; }',
    '.concl .vsrc { color:var(--text-faint); white-space:nowrap; }',
    '.concl .cact { margin-top:5px; font-size:11px; color:var(--text-faint); }',
    '.deepbtn { display:block; width:100%; margin:10px 0 3px; padding:9px 12px; border:1px solid var(--accent); border-radius:9px; background:var(--tint); color:var(--text); font-family:inherit; font-size:12.5px; font-weight:600; cursor:pointer; text-align:center; }',
    '.deepbtn:hover { background:var(--accent); color:#1b1b1a; }',
    '.deepbtn:disabled { opacity:0.6; cursor:default; }',
    '.deepnote { font-size:10.5px; color:var(--text-faint); margin:0 0 6px; line-height:1.45; }',
    '.concl .evrow { display:flex; align-items:center; gap:8px; margin:4px 0 10px; }',
    '.concl .evdot { width:8px; height:8px; border-radius:50%; background:#e0a93d; animation:gmrsPulse 1s ease-in-out infinite; flex:none; }',
    '.concl .evtxt { font-size:13px; font-weight:700; color:var(--text); animation:gmrsPulse 1.4s ease-in-out infinite; }',
    '.concl .evbar { height:9px; border-radius:5px; margin:7px 0; background:linear-gradient(90deg, var(--bg-soft) 25%, rgba(224,169,61,0.20) 37%, var(--bg-soft) 63%); background-size:400px 100%; animation:gmrsShimmer 1.3s linear infinite; }',
    '.concl .evbar.b1 { width:92%; } .concl .evbar.b2 { width:78%; } .concl .evbar.b3 { width:58%; }',
    '@keyframes gmrsPulse { 0%,100% { opacity:.4; } 50% { opacity:1; } }',
    '@keyframes gmrsShimmer { 0% { background-position:-200px 0; } 100% { background-position:200px 0; } }',
    '.subt { font-size:10.5px; color:var(--text-soft); margin-bottom:8px; line-height:1.45; }',
    '.leg { display:flex; flex-wrap:wrap; gap:14px; font-size:10.5px; color:var(--text-soft); margin-bottom:6px; }',
    '.leg span { display:inline-flex; align-items:center; }',
    '.leg i { display:inline-block; width:11px; height:11px; border-radius:2px; margin-right:5px; }',
    '.leg i.dash { width:15px; height:0; border-radius:0; border-top:2px dashed #e0a93d; }',
    '.chartwrap { width:100%; }',
    '.chartwrap svg { display:block; width:100%; height:auto; }',
    '.cat { display:flex; height:18px; border-radius:6px; overflow:hidden; margin-bottom:7px; }',
    '.catleg { display:flex; flex-wrap:wrap; gap:13px; font-size:10.5px; color:var(--text-soft); }',
    '.catleg span { display:inline-flex; align-items:center; }',
    '.catleg i { display:inline-block; width:11px; height:11px; border-radius:2px; margin-right:5px; }',
    '.metrics { display:grid; grid-template-columns:repeat(2,1fr); gap:7px; }',
    '.m { background:var(--bg-soft); border-radius:9px; padding:9px; }',
    '.m .ml { font-size:10.5px; color:var(--text-soft); margin-bottom:3px; }',
    '.m .mv { font-size:16px; font-weight:600; letter-spacing:-.2px; font-variant-numeric:tabular-nums; }',
    '.m .u { font-size:10.5px; color:var(--text-faint); font-weight:400; margin-left:1px; }',
    '.m .mi { font-size:10px; color:var(--text-faint); margin-top:4px; line-height:1.4; }',
    '.verdict { background:var(--tint); border-radius:11px; padding:11px 12px; margin-top:14px; }',
    '.verdict .vt { font-size:10.5px; color:var(--text-soft); font-weight:600; margin-bottom:5px; display:flex; justify-content:space-between; gap:8px; align-items:baseline; }',
    '.verdict .vsrc { font-weight:400; color:var(--text-faint); white-space:nowrap; }',
    '.verdict .vb { font-size:12px; color:var(--text); line-height:1.62; }',
    '.verdict .vact { margin-top:7px; font-size:11px; color:var(--text-faint); }',
    '.link { color:var(--accent); cursor:pointer; text-decoration:underline; }',
    '.err { color:#d9544d; }',
    '.msg { padding:6px 2px 8px; color:var(--text-soft); font-size:12px; }',
    '.msg .t1 { display:block; font-weight:600; color:var(--text); margin-bottom:3px; }'
  ].join('\n');

  function ensurePanel() {
    if (refs && document.documentElement.contains(refs.host)) return refs;
    var existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();
    var host = document.createElement('div');
    host.id = HOST_ID;
    (document.documentElement || document.body).appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' + CSS + '</style>' +
      '<div class="panel" id="p" role="region" aria-label="' + S('panelTitle') + '">' +
        '<div class="hd" id="hd">' +
          '<span class="ic">\u2605</span>' +
          '<span class="ti">' + S('panelTitle') + '</span>' +
          '<button id="rf" title="' + S('recalc') + '" aria-label="' + S('recalc') + '">\u21bb</button>' +
          '<button id="cv" title="' + (isJa() ? '折りたたみ' : 'Collapse') + '" aria-label="' + (isJa() ? '折りたたみ' : 'Collapse') + '"><span class="chev">\u25be</span></button>' +
        '</div>' +
        '<div class="bd" id="bd"></div>' +
      '</div>';
    var panel = root.getElementById('p');
    var hd = root.getElementById('hd');
    var bd = root.getElementById('bd');
    root.getElementById('cv').addEventListener('click', function () { panel.classList.toggle('collapsed'); });
    root.getElementById('rf').addEventListener('click', function () { lastRenderKey = ''; curPlace = ''; update(); });
    hd.addEventListener('mousedown', function (e) {
      if (e.target.closest('button')) return;
      var r = panel.getBoundingClientRect();
      dragState = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      panel.style.right = 'auto'; panel.style.left = r.left + 'px'; panel.style.top = r.top + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      var x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - dragState.dx));
      var y = Math.max(0, Math.min(window.innerHeight - 28, e.clientY - dragState.dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    });
    window.addEventListener('mouseup', function () { dragState = null; });
    refs = { host: host, root: root, panel: panel, bd: bd };
    return refs;
  }

  function removePanel() {
    if (refs && refs.host) refs.host.remove();
    var h = document.getElementById(HOST_ID);
    if (h) h.remove();
    refs = null;
  }

  // A stable identifier for the *place*, independent of map pan/zoom.
  // Google Maps mutates location.pathname (the @lat,lng,zoom segment and others) as the map
  // moves, even while the same place panel is open. Using the raw pathname as the key therefore
  // causes spurious re-renders/re-evaluations on every pan. We instead extract the place's stable
  // feature id (the "!1s0x...:0x..." token in the data= segment) and fall back to the /place/<name>/
  // slug, ignoring the volatile coordinate parts entirely.
  function placeIdOf() {
    var href = location.href;
    var mId = href.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/) || href.match(/!1s([^!?&]+)/);
    if (mId) return 'id:' + mId[1];
    var mSlug = location.pathname.match(/\/maps\/place\/([^/@]+)/);
    if (mSlug) return 'place:' + decodeURIComponent(mSlug[1]);
    return 'path:' + decodeURIComponent(location.pathname.replace(/\/@[-0-9.,a-zA-Z]+$/, ''));
  }

  function parseHistogram() {
    var counts = { 1: null, 2: null, 3: null, 4: null, 5: null };
    var els = document.querySelectorAll('[aria-label]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getClientRects().length === 0) continue;
      var label = el.getAttribute('aria-label');
      if (!label) continue;
      var star = null, cnt = null, m;
      m = label.match(/([1-5])\s*つ星[、,]\s*クチコミ\s*([\d,]+)\s*件/);
      if (m) { star = +m[1]; cnt = parseInt(m[2].replace(/,/g, ''), 10); }
      if (star === null) {
        m = label.match(/([1-5])\s*stars?,\s*([\d,]+)\s*reviews?/i);
        if (m) { star = +m[1]; cnt = parseInt(m[2].replace(/,/g, ''), 10); }
      }
      if (star !== null && cnt !== null && !isNaN(cnt) && star >= 1 && star <= 5) counts[star] = cnt;
    }
    for (var s = 1; s <= 5; s++) if (counts[s] === null) return null;
    var total = counts[1] + counts[2] + counts[3] + counts[4] + counts[5];
    if (total <= 0) return null;
    return counts;
  }

  // ---- analysis engine (all local) ----
  function erf(x) {
    var s = x < 0 ? -1 : 1; x = Math.abs(x);
    var t = 1 / (1 + 0.3275911 * x);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  function normCdf(z) { return 0.5 * (1 + erf(z / Math.SQRT2)); }

  function analyze(c) {
    var n = c[1] + c[2] + c[3] + c[4] + c[5];
    var p = {}; for (var s = 1; s <= 5; s++) p[s] = c[s] / n;
    var mean = (1 * c[1] + 2 * c[2] + 3 * c[3] + 4 * c[4] + 5 * c[5]) / n;
    var k1 = Math.floor((n + 1) / 2), k2 = Math.ceil((n + 1) / 2);
    function rank(k) { var cum = 0; for (var s = 1; s <= 5; s++) { cum += c[s]; if (k <= cum) return s; } return 5; }
    var median = (rank(k1) + rank(k2)) / 2;
    var mode = 1, best = -1; for (var s = 1; s <= 5; s++) { if (c[s] > best) { best = c[s]; mode = s; } }
    var m2 = 0, m3 = 0, m4 = 0, mad = 0;
    for (var s = 1; s <= 5; s++) { var d = s - mean; m2 += p[s] * d * d; m3 += p[s] * d * d * d; m4 += p[s] * d * d * d * d; mad += p[s] * Math.abs(s - 3); }
    var sd = Math.sqrt(m2);
    var skew = m2 > 0 ? m3 / Math.pow(m2, 1.5) : 0;
    var kurt = m2 > 0 ? m4 / (m2 * m2) : 0;
    var bc = kurt > 0 ? (skew * skew + 1) / kurt : 0;
    var polar = mad / 2;
    var high = (c[4] + c[5]) / n, low = (c[1] + c[2]) / n, neu = c[3] / n, extreme = (c[1] + c[5]) / n;
    var sump2 = 0; for (var s = 1; s <= 5; s++) sump2 += p[s] * p[s];
    var disagree = 1 - sump2;
    var strong = 0, meandiff = 0;
    for (var i = 1; i <= 5; i++) for (var j = 1; j <= 5; j++) { var pr = p[i] * p[j]; meandiff += pr * Math.abs(i - j); if (Math.abs(i - j) >= 3) strong += pr; }
    var H = 0; for (var s = 1; s <= 5; s++) if (p[s] > 0) H += -p[s] * Math.log(p[s]);
    var nent = H / Math.log(5);
    var w = {}, sw = 0; for (var s = 1; s <= 5; s++) { var wv = m2 > 0 ? Math.exp(-Math.pow(s - mean, 2) / (2 * m2)) : 1; w[s] = wv; sw += wv; }
    var normal = {}; for (var s = 1; s <= 5; s++) normal[s] = w[s] / sw * n;
    // Reliability / polarization extras
    var z95 = 1.96;
    var loveHate = c[1] > 0 ? c[5] / c[1] : (c[5] > 0 ? Infinity : 0);
    var topBottom = (p[5] - p[1]) * 100;
    // 高評価優勢確率: Dirichlet(H+1, M+1, L+1) posterior, normal approximation of P(p_H > p_L)
    var aH = c[4] + c[5] + 1, aM = c[3] + 1, aL = c[1] + c[2] + 1, a0 = aH + aM + aL;
    var dMean = (aH - aL) / a0;
    var dVar = (aH * (a0 - aH) + aL * (a0 - aL) + 2 * aH * aL) / (a0 * a0 * (a0 + 1));
    var highDom = dVar > 0 ? normCdf(dMean / Math.sqrt(dVar)) : (aH > aL ? 1 : (aH < aL ? 0 : 0.5));
    // Wilson 95% CI for high rate
    var wDen = 1 + z95 * z95 / n, wCen = high + z95 * z95 / (2 * n);
    var wMar = z95 * Math.sqrt(high * (1 - high) / n + z95 * z95 / (4 * n * n));
    var wilsonLo = (wCen - wMar) / wDen, wilsonHi = (wCen + wMar) / wDen;
    // Mean 95% CI using the sample standard deviation (n-1)
    var sSample = n > 1 ? Math.sqrt(m2 * n / (n - 1)) : sd;
    var se = sSample / Math.sqrt(n);
    var ciLo = mean - z95 * se, ciHi = mean + z95 * se, riskMean = ciLo;
    // Anti-normality score: chi-square against the normal-approx expected counts
    var chi2 = 0; for (var s = 1; s <= 5; s++) { if (normal[s] > 0) chi2 += Math.pow(c[s] - normal[s], 2) / normal[s]; }
    return { n: n, mean: mean, median: median, mode: mode, sd: sd, sSample: sSample, skew: skew, kurt: kurt, bc: bc,
             polar: polar, high: high, low: low, neu: neu, extreme: extreme, disagree: disagree,
             strong: strong, meandiff: meandiff, nent: nent, normal: normal, chi2: chi2,
             loveHate: loveHate, topBottom: topBottom, highDom: highDom,
             wilsonLo: wilsonLo, wilsonHi: wilsonHi, ciLo: ciLo, ciHi: ciHi, riskMean: riskMean };
  }

  function fmtMed(m) { return (m % 1 === 0) ? String(m) : m.toFixed(1); }

  function verdict(c, a) {
    var minC = Math.min(c[1], c[2], c[3], c[4], c[5]);
    var isU = (c[3] === minC) && a.extreme > 0.45 && a.low > 0.2 && a.high > 0.2;
    var lean = (a.median >= 4 && a.mean >= 3.4) ? 'high' : (a.median <= 2 && a.mean <= 2.6) ? 'low' : 'mid';
    var head = '平均は' + a.mean.toFixed(2) + 'だが中央値は' + fmtMed(a.median) + '・最頻値は' + a.mode + '★で';
    var ext = (a.extreme * 100).toFixed(1), pol = a.polar.toFixed(2);
    var hi = (a.high * 100).toFixed(1), lo = (a.low * 100).toFixed(1), p1 = (c[1] / a.n * 100).toFixed(1);
    if (isU) {
      var bias = lean === 'high' ? '高評価側にやや偏った' : lean === 'low' ? '低評価側に偏った' : '';
      var c1 = lean === 'high' ? '高評価側に寄っている。' : lean === 'low' ? '低評価側に寄っている。' : '中央寄り。';
      return head + c1 + '一方で1★と5★だけで全体の' + ext + '%を占め、分極化指数は' + pol +
        'と高い。賛否が大きく分かれており、単純な平均では説明しにくい「' + bias + '二極化分布」と解釈するのが妥当。';
    }
    if (a.polar < 0.4 && a.neu >= 0.25) {
      return head + '評価は3★付近に集中している。分極化指数は' + pol + 'と低く、平均値が分布の代表として比較的妥当。';
    }
    if (lean === 'high') {
      return head + '高評価側に大きく偏っている（高評価率' + hi + '%）。ただし1★が' + p1 +
        '%含まれ、少数の強い不満が混じる分布。平均だけでなく低評価率も併せて見るのが妥当。';
    }
    if (lean === 'low') {
      return head + '低評価側に偏っている（低評価率' + lo + '%）。少数の高評価はあるが、全体に不満が多い分布。';
    }
    return head + '評価はやや広がっている。分極化指数は' + pol + 'で、平均値だけでなく分布の形も併せて見るのが妥当。';
  }

  function recommend(a) {
    if (isJa()) {
      if (a.low >= 0.4 || a.mean < 2.8) return '低評価が目立つため、行くなら慎重に。';
      if (a.high >= 0.7 && a.low <= 0.15) return '総じて評判は良く、行く価値は高い。';
      if (a.polar >= 0.6 && a.high >= 0.5) return '高評価も多いが賛否がはっきり割れており、人を選ぶ（期待は控えめに）。';
      if (a.high >= 0.6) return 'おおむね良好で、行く価値はある方。';
      if (a.polar >= 0.6) return '賛否が大きく割れており、人を選ぶ。';
      if (a.high >= 0.5) return 'まずまずで、大きな外れは少なそう。';
      return '評価は中庸で、可もなく不可もなく。';
    }
    if (a.low >= 0.4 || a.mean < 2.8) return 'Negatives stand out — approach with caution.';
    if (a.high >= 0.7 && a.low <= 0.15) return 'Well regarded overall — clearly worth a visit.';
    if (a.polar >= 0.6 && a.high >= 0.5) return 'Plenty of praise, but opinion is sharply split — not for everyone (keep expectations modest).';
    if (a.high >= 0.6) return 'Largely positive — worth a visit.';
    if (a.polar >= 0.6) return 'Opinion is sharply divided — not for everyone.';
    if (a.high >= 0.5) return 'Decent — big misses look unlikely.';
    return 'Middling overall — neither remarkable nor bad.';
  }

  function recLevel(a) {
    if (a.low >= 0.4 || a.mean < 2.8) return 'bad';
    if (a.high >= 0.7 && a.low <= 0.15) return 'good';
    if (a.polar >= 0.6 && a.high >= 0.5) return 'mixed';
    if (a.high >= 0.6) return 'good';
    if (a.polar >= 0.6) return 'mixed';
    if (a.high >= 0.5) return 'okay';
    return 'neutral';
  }

  // Headline classification + adaptive summary text.
  function classify(c, a) {
    var pc1 = function (x) { return (x * 100).toFixed(1); };
    var ja = isJa();
    var minC = Math.min(c[1], c[2], c[3], c[4], c[5]);
    var isU = (c[3] === minC) && a.extreme > 0.45 && a.low > 0.2 && a.high > 0.2;
    var lean = (a.median >= 4 && a.mean >= 3.4) ? 'high' : (a.median <= 2 && a.mean <= 2.6) ? 'low' : 'mid';
    var sideKey = (a.highDom >= 0.95 && (a.high - a.low) >= 0.05) ? 'high'
             : (a.highDom <= 0.05 && (a.low - a.high) >= 0.05) ? 'low' : 'even';
    var sideWord = ja ? (sideKey === 'high' ? '高評価優勢' : sideKey === 'low' ? '低評価優勢' : '拮抗')
                      : (sideKey === 'high' ? 'Positive-leaning' : sideKey === 'low' ? 'Negative-leaning' : 'Contested');
    var shapeLabel, title;
    if (isU) {
      shapeLabel = ja
        ? (lean === 'high' ? '高評価側にやや偏ったU字型分布' : lean === 'low' ? '低評価側に偏ったU字型分布' : '対称的なU字型分布')
        : (lean === 'high' ? 'U-shaped, tilted positive' : lean === 'low' ? 'U-shaped, tilted negative' : 'Symmetric U-shape');
      title = ja ? (sideWord + '・二極化型') : (sideWord + ', polarized');
    } else if (a.high >= 0.7 && a.low <= 0.2) {
      shapeLabel = ja ? '高評価集中型' : 'Concentrated positive';
      title = shapeLabel;
    } else if (a.low >= 0.5) {
      shapeLabel = ja ? '低評価集中型' : 'Concentrated negative';
      title = ja ? '低評価優勢型' : 'Negative-dominated';
    } else if (a.neu >= 0.25 && a.polar < 0.4) {
      shapeLabel = ja ? '中央集中型' : 'Center-concentrated';
      title = shapeLabel;
    } else if (a.nent >= 0.85 && a.extreme < 0.45) {
      shapeLabel = ja ? '平坦・分散型' : 'Flat / dispersed';
      title = ja ? (sideWord + '型') : sideWord;
    } else {
      shapeLabel = ja ? '分散型' : 'Dispersed';
      title = ja ? (sideWord + '型') : sideWord;
    }
    var tvd = 0; for (var s = 1; s <= 5; s++) tvd += Math.abs(c[s] / a.n - a.normal[s] / a.n);
    tvd = tvd / 2;
    var devLabel = ja ? (tvd >= 0.18 ? '高い' : tvd >= 0.09 ? '中程度' : '低い')
                      : (tvd >= 0.18 ? 'high' : tvd >= 0.09 ? 'moderate' : 'low');
    var summary;
    if (ja) {
      var sideTxt = sideKey === 'high' ? '高評価側が優勢' : sideKey === 'low' ? '低評価側が優勢' : '高評価と低評価が拮抗';
      var s1 = '平均評価は' + a.mean.toFixed(2) + 'だが、中央値は' + fmtMed(a.median) + '、最頻値は' + a.mode + '★。';
      var s2 = '高評価率' + pc1(a.high) + '%に対して低評価率' + pc1(a.low) + '%で、' + sideTxt + '。';
      var s3, s4;
      if (isU) {
        s3 = '一方で1★と5★だけで' + pc1(a.extreme) + '%を占め、評価はかなり二極化している（分極化指数' + a.polar.toFixed(2) + '）。';
        s4 = '「無難に普通」ではなく、「合う人には強く刺さるが、合わない人の不満も大きい」タイプと解釈できる。';
      } else if (a.high >= 0.7 && a.low <= 0.2) {
        s3 = '低評価は' + pc1(a.low) + '%にとどまり、評価は高評価側に集中している。';
        s4 = '多くの人が満足しており、大きな外れは少ないタイプと解釈できる。';
      } else if (a.low >= 0.5) {
        s3 = '高評価は' + pc1(a.high) + '%にとどまり、不満が多数を占める。';
        s4 = '全体に評価が低く、利用には慎重さが要るタイプ。';
      } else {
        s3 = '極端評価率は' + pc1(a.extreme) + '%、分極化指数は' + a.polar.toFixed(2) + '。';
        s4 = '平均値だけでなく、分布の形と低評価率も併せて見るのが妥当。';
      }
      summary = s1 + s2 + s3 + s4;
    } else {
      var sideTxtE = sideKey === 'high' ? 'positives lead' : sideKey === 'low' ? 'negatives lead' : 'positives and negatives are roughly even';
      var e1 = 'The mean is ' + a.mean.toFixed(2) + ', but the median is ' + fmtMed(a.median) + ' and the mode is ' + a.mode + '★. ';
      var e2 = 'Positive rate ' + pc1(a.high) + '% vs negative ' + pc1(a.low) + '% — ' + sideTxtE + '. ';
      var e3, e4;
      if (isU) {
        e3 = 'Yet 1★ and 5★ alone make up ' + pc1(a.extreme) + '%, so opinion is strongly polarized (polarization index ' + a.polar.toFixed(2) + '). ';
        e4 = 'Read it not as "safely average" but as "a strong hit for the right person, a real letdown for others."';
      } else if (a.high >= 0.7 && a.low <= 0.2) {
        e3 = 'Negatives stay at just ' + pc1(a.low) + '%, so ratings concentrate on the positive side. ';
        e4 = 'Most people are satisfied and big misses look unlikely.';
      } else if (a.low >= 0.5) {
        e3 = 'Positives reach only ' + pc1(a.high) + '%, so complaints are the majority. ';
        e4 = 'Ratings are low overall; use some caution.';
      } else {
        e3 = 'Extreme rate is ' + pc1(a.extreme) + '% and the polarization index is ' + a.polar.toFixed(2) + '. ';
        e4 = 'Look beyond the mean to the shape of the distribution and the negative rate.';
      }
      summary = e1 + e2 + e3 + e4;
    }
    return { title: title, summary: summary, shapeLabel: shapeLabel, devLabel: devLabel, scene: sceneFor(a, c) };
  }

  // Distribution-only scene suggestion for the local (non-AI) verdict.
  function sceneFor(a, c) {
    if (isJa()) {
      if (a.low >= 0.4 || a.mean < 2.8) return '低評価が多く、外れる可能性が高め。重要な予定や接待・記念日など失敗できない場面は避け、試すなら期待を抑えて。';
      if (a.high >= 0.7 && a.low <= 0.15) return '満足度が高く安定。失敗しにくい安牌で、デートや接待、初めての来店、待ち合わせなど幅広いシーンに向く。';
      if (a.polar >= 0.6 || (c[3] === Math.min(c[1], c[2], c[3], c[4], c[5]) && a.extreme > 0.45)) return '当たり外れが大きい二極化型。事前に自分の好みと評判を確かめてから。冒険できる場面向きで、絶対に外したくない日には不向き。';
      if (a.high >= 0.6) return 'おおむね満足度は高め。日常使いやちょっとした外食には十分だが、特別な日は口コミの傾向も確認すると安心。';
      if (a.neu >= 0.25 && a.polar < 0.4) return '平均的で大きな波が少ない。とりあえず無難に済ませたい場面や日常使いに向く。';
      return '評価は分散気味。気軽な利用には問題ない一方、確実性を求める場面では下調べを。';
    }
    if (a.low >= 0.4 || a.mean < 2.8) return 'Many low ratings and a higher chance of a miss. Avoid it for occasions you can’t afford to ruin (business, anniversaries); if you try it, keep expectations low.';
    if (a.high >= 0.7 && a.low <= 0.15) return 'High, stable satisfaction — a safe pick that suits a wide range: dates, business meals, first visits, meetups.';
    if (a.polar >= 0.6 || (c[3] === Math.min(c[1], c[2], c[3], c[4], c[5]) && a.extreme > 0.45)) return 'A hit-or-miss, polarized place. Check your own taste and the reviews first. Fine when you can be adventurous, not for a day you must not get wrong.';
    if (a.high >= 0.6) return 'Generally satisfying — plenty good for everyday outings, though for a special occasion it’s worth checking the review themes too.';
    if (a.neu >= 0.25 && a.polar < 0.4) return 'Average with few swings — good for an easy, no-fuss visit or everyday use.';
    return 'Ratings are fairly dispersed. Fine for a casual visit, but do some homework when you need certainty.';
  }

  function chartComment(c, a) {
    var minC = Math.min(c[1], c[2], c[3], c[4], c[5]);
    if (isJa()) {
      if (c[3] === minC && a.extreme > 0.45)
        return '3★が' + c[3].toLocaleString() + '件と少なく、1★と5★が多いため、中央集中型ではなく二極化型の分布。点線の正規分布近似は補助。';
      if (a.high >= 0.7) return '高い星に件数が偏っており、高評価側に集中した分布。点線の正規分布近似は補助。';
      if (a.low >= 0.5) return '低い星に件数が偏っており、低評価側に寄った分布。点線の正規分布近似は補助。';
      return '点線は同じ平均・標準偏差の正規分布近似（本来は3★が山）。実測との差が分布の偏りを表す。';
    }
    if (c[3] === minC && a.extreme > 0.45)
      return '3★ is rare (' + c[3].toLocaleString() + ') while 1★ and 5★ are common, so the shape is polarized rather than center-heavy. The dashed normal curve is auxiliary.';
    if (a.high >= 0.7) return 'Counts skew toward high stars — a positive-concentrated distribution. The dashed normal curve is auxiliary.';
    if (a.low >= 0.5) return 'Counts skew toward low stars — a negative-leaning distribution. The dashed normal curve is auxiliary.';
    return 'The dashed line is a normal approximation with the same mean and SD (which would peak at 3★). Its gap from the bars shows the skew.';
  }

  function catComment(c, a) {
    var pc1 = function (x) { return (x * 100).toFixed(1); };
    if (isJa()) {
      if (a.neu < 0.1) return '中立層が' + pc1(a.neu) + '%しかなく、評価が中間に集まっていない。高評価が多数派だが、低評価もかなり多い。';
      if (a.high >= 0.6) return '高評価が多数派。中立' + pc1(a.neu) + '%、低評価' + pc1(a.low) + '%。';
      if (a.low >= 0.5) return '低評価が多数派で、高評価は' + pc1(a.high) + '%。';
      return '高評価' + pc1(a.high) + '% / 中立' + pc1(a.neu) + '% / 低評価' + pc1(a.low) + '%。';
    }
    if (a.neu < 0.1) return 'Neutrals are just ' + pc1(a.neu) + '%, so ratings don’t cluster in the middle. Positives are the majority, but negatives are sizable too.';
    if (a.high >= 0.6) return 'Positives are the majority. Neutral ' + pc1(a.neu) + '%, negative ' + pc1(a.low) + '%.';
    if (a.low >= 0.5) return 'Negatives are the majority; positives are ' + pc1(a.high) + '%.';
    return 'Positive ' + pc1(a.high) + '% / neutral ' + pc1(a.neu) + '% / negative ' + pc1(a.low) + '%.';
  }

  function fmtRatio(x) { return isFinite(x) ? x.toFixed(2) : '∞'; }

  function buildChart(c, a) {
    var W = 336, H = 206, mL = 30, mR = 8, mT = 10, mB = 40;
    var pW = W - mL - mR, pH = H - mT - mB, baseY = mT + pH;
    var stars = [5, 4, 3, 2, 1];
    var counts = stars.map(function (s) { return c[s]; });
    var norm = stars.map(function (s) { return a.normal[s]; });
    var top = Math.max.apply(null, counts.concat(norm)) * 1.05 || 1;
    var slot = pW / 5, barW = slot * 0.5;
    var dk = isDark();
    var axc = dk ? 'rgba(235,235,232,0.72)' : 'rgba(40,40,38,0.66)';
    var grc = dk ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.10)';
    var P = [], i, xC, y;
    var fr = [0, 0.5, 1];
    for (var g = 0; g < fr.length; g++) {
      var f = fr[g]; y = baseY - pH * f; var v = Math.round(top * f);
      P.push('<line x1="' + mL + '" y1="' + y.toFixed(1) + '" x2="' + (mL + pW) + '" y2="' + y.toFixed(1) + '" stroke="' + grc + '" stroke-width="1"/>');
      P.push('<text x="' + (mL - 4) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" font-size="9" fill="' + axc + '">' + v + '</text>');
    }
    for (i = 0; i < 5; i++) {
      xC = mL + slot * (i + 0.5); var h = counts[i] / top * pH; var x = xC - barW / 2; y = baseY - h;
      P.push('<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="3" fill="#378ADD"/>');
      P.push('<text x="' + xC.toFixed(1) + '" y="' + (baseY + 14).toFixed(1) + '" text-anchor="middle" font-size="10" fill="' + axc + '">' + stars[i] + '\u2605</text>');
      P.push('<text x="' + xC.toFixed(1) + '" y="' + (baseY + 28).toFixed(1) + '" text-anchor="middle" font-size="9.5" fill="' + axc + '">' + counts[i].toLocaleString() + '</text>');
    }
    var pts = [];
    for (i = 0; i < 5; i++) { xC = mL + slot * (i + 0.5); y = baseY - norm[i] / top * pH; pts.push(xC.toFixed(1) + ',' + y.toFixed(1)); }
    P.push('<polyline points="' + pts.join(' ') + '" fill="none" stroke="#e0a93d" stroke-width="2" stroke-dasharray="5,4"/>');
    for (i = 0; i < 5; i++) { xC = mL + slot * (i + 0.5); y = baseY - norm[i] / top * pH; P.push('<circle cx="' + xC.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="2.4" fill="#e0a93d"/>'); }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="' + (isJa() ? '星評価別の口コミ数と正規分布近似の比較グラフ' : 'Review counts per star with a normal-approximation overlay') + '">' + P.join('') + '</svg>';
  }

  function card(label, val, unit) {
    return '<div class="card"><div class="cl">' + label + '</div><div class="cv">' + val + '<span class="u">' + (unit || '') + '</span></div></div>';
  }
  function metric(label, val, unit, interp) {
    return '<div class="m"><div class="ml">' + label + '</div><div class="mv">' + val + '<span class="u">' + (unit || '') + '</span></div><div class="mi">' + interp + '</div></div>';
  }

  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // Return review elements. Keep this PERMISSIVE: count every [data-review-id].
  // (An earlier "exclude nested replies" filter mis-classified real reviews and collapsed
  // the count to ~3, so we no longer filter here. Duplicate bodies are de-duped later in
  // extractReviews by their leading text, and the displayed count is capped at the total.)
  function reviewCards() {
    return document.querySelectorAll('[data-review-id]');
  }

  // Find the scrollable element that actually drives review lazy-loading.
  // Scans ALL scrollable elements and picks the one containing the most review cards.
  function isScrollable(el) {
    var oy = '';
    try { oy = getComputedStyle(el).overflowY; } catch (e) { return false; }
    return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 8;
  }
  // Collect every plausibly-relevant scrollable element. The review feed container
  // differs by how the place was opened (search list vs direct vs panel), so we don't
  // commit to a single one — we scroll all candidates that contain a review card,
  // plus the nearest scrollable ancestor of the last card.
  function allScrollables() {
    var set = [];
    var seen = [];
    function push(el) { if (el && seen.indexOf(el) < 0) { seen.push(el); set.push(el); } }
    var anchorEls = document.querySelectorAll('[data-review-id]');
    if (anchorEls.length) {
      var lastCard = anchorEls[anchorEls.length - 1];
      var el = lastCard.parentElement;
      while (el && el !== document.body && el !== document.documentElement) {
        if (isScrollable(el)) push(el);
        el = el.parentElement;
      }
    }
    var nodes = document.querySelectorAll('div, section, main');
    for (var i = 0; i < nodes.length; i++) {
      if (!isScrollable(nodes[i])) continue;
      if (nodes[i].querySelector('[data-review-id]')) push(nodes[i]);
    }
    return set;
  }
  // Primary container (for diagnostics / end detection): nearest scrollable ancestor of a card.
  function reviewScrollContainer() {
    var list = allScrollables();
    return list.length ? list[0] : null;
  }

  var GMRS_DEBUG = true; // set false to silence the deep-scroll diagnostics
  function dlog() { if (GMRS_DEBUG && window.console) { try { console.log.apply(console, ['[GMRS]'].concat([].slice.call(arguments))); } catch (e) {} } }

  // Find and click the "Reviews / クチコミ" tab, then wait until the scrollable review
  // feed actually appears. Resolves true if a scrollable review container is detected.
  function openReviewsTab(maxMs) {
    maxMs = maxMs || 9000;
    return new Promise(function (resolve) {
      // If a scrollable review feed already exists, we're on the right tab.
      if (allScrollables().length) { resolve(true); return; }
      // Look for the reviews tab button by its label.
      var cand = document.querySelectorAll('button, [role="tab"], a[role="tab"], [jsaction] [role="tab"]');
      var btn = null;
      for (var i = 0; i < cand.length; i++) {
        var el = cand[i];
        var label = (el.getAttribute('aria-label') || el.textContent || '').trim();
        if (!label) continue;
        // Japanese "クチコミ" / English "Reviews". Avoid matching "概要/Overview".
        if (/クチコミ|口コミ|Reviews?\b/i.test(label) && !/概要|Overview/i.test(label)) {
          // Prefer elements that look like tabs (short label).
          if (label.length <= 12 || el.getAttribute('role') === 'tab') { btn = el; break; }
          if (!btn) btn = el;
        }
      }
      dlog('openReviewsTab: tab button', btn ? ('"' + (btn.getAttribute('aria-label') || btn.textContent || '').trim() + '"') : 'NOT FOUND');
      if (btn) { try { btn.click(); } catch (e) {} }
      // Poll until a scrollable review feed shows up (Maps loads it asynchronously).
      var startedAt = Date.now();
      (function waitFeed() {
        if (allScrollables().length) { dlog('openReviewsTab: feed ready'); resolve(true); return; }
        if (Date.now() - startedAt > maxMs) { dlog('openReviewsTab: timed out waiting for feed'); resolve(false); return; }
        setTimeout(waitFeed, 300);
      })();
    });
  }

  // Auto-scroll the reviews pane until no new reviews load (or a cap/time budget is hit).
  // onProgress(count) is called as it grows. Resolves with the final loaded count.
  function loadAllReviews(onProgress, maxCount, maxMs) {
    maxCount = maxCount || 100000;
    maxMs = maxMs || 180000;
    return new Promise(function (resolve) {
      var startedAt = Date.now();
      var stall = 0;
      var last = reviewCards().length;
      dlog('start: reviews=', last, 'scrollables=', allScrollables().length);
      if (onProgress) onProgress(last);
      function atEnd() {
        var box = reviewScrollContainer();
        if (!box) return false;
        var tail = (box.textContent || '').slice(-160);
        return /クチコミは以上です|これ以上のクチコミはありません|すべてのクチコミを表示しました|You['’]ve reached the end|No more reviews|end of the list/i.test(tail);
      }
      function kick(b) {
        // Trigger lazy-load by stepping the scroll, not pinning to the bottom.
        try {
          var max = b.scrollHeight - b.clientHeight;
          // Briefly pull up, then drive to (near) the bottom so a real downward
          // scroll is observed by Maps' infinite-scroll handler.
          b.scrollTop = Math.max(0, max - Math.round(b.clientHeight * 1.5));
          b.dispatchEvent(new Event('scroll', { bubbles: true }));
          setTimeout(function () {
            b.scrollTop = b.scrollHeight;
            b.dispatchEvent(new Event('scroll', { bubbles: true }));
            try { b.dispatchEvent(new WheelEvent('wheel', { deltaY: 1500, bubbles: true, cancelable: true })); } catch (e) {}
          }, 120);
        } catch (e) { /* ignore */ }
      }
      function nudgeAll() {
        var list = allScrollables();
        for (var i = 0; i < list.length; i++) kick(list[i]);
        var cards = reviewCards();
        if (cards.length) { try { cards[cards.length - 1].scrollIntoView({ block: 'center' }); } catch (e) {} }
        if (!list.length) { window.scrollBy(0, -400); setTimeout(function () { window.scrollTo(0, document.body.scrollHeight); }, 120); }
        return list.length;
      }
      function step() {
        var now = reviewCards().length;
        if (onProgress && now !== last) onProgress(now);
        var grew = now > last;
        last = now;
        if (grew) stall = 0; else stall++;

        var box = reviewScrollContainer();
        dlog('tick: reviews=', now, 'stall=', stall, 'scrollables=', allScrollables().length,
             'box=', box ? (box.className || box.tagName) : 'NONE',
             box ? ('top=' + Math.round(box.scrollTop) + ' sh=' + box.scrollHeight + ' ch=' + box.clientHeight) : '');

        if (now >= maxCount || (Date.now() - startedAt) > maxMs || stall >= 20 || (stall >= 6 && atEnd())) {
          dlog('stop: reviews=', now, 'reason=', now >= maxCount ? 'cap' : (Date.now() - startedAt) > maxMs ? 'time' : atEnd() ? 'endmark' : 'stall');
          resolve(now); return;
        }
        nudgeAll();
        setTimeout(step, 1100);
      }
      step();
    });
  }

  // Naive keyword frequency from review text (for display only). Returns top terms.
  function topKeywords(reviews, topN) {
    topN = topN || 12;
    var stop = {
      'こと':1,'これ':1,'それ':1,'ここ':1,'ため':1,'ところ':1,'もの':1,'よう':1,'さん':1,'です':1,'ます':1,'した':1,'して':1,'いる':1,'ある':1,'なる':1,'思う':1,'思い':1,'感じ':1,'店':1,'お店':1,'時間':1,'利用':1,'本当':1,'今回':1,'自分':1,'店員':1,'対応':1,
      'the':1,'and':1,'was':1,'were':1,'this':1,'that':1,'with':1,'for':1,'are':1,'have':1,'had':1,'but':1,'not':1,'you':1,'they':1,'very':1,'just':1,'really':1,'place':1,'here':1,'there':1,'their':1,'them':1,'from':1,'out':1,'get':1,'got':1,'has':1,'our':1,'can':1,'will':1,'would':1,'when':1,'what':1,'all':1,'too':1,'also':1,'than':1,'then':1,'some':1,'much':1,'more':1,'been':1,'one':1
    };
    var freq = {};
    function bump(w) { if (!w || stop[w]) return; freq[w] = (freq[w] || 0) + 1; }
    (reviews || []).forEach(function (rv) {
      var t = (rv.text || '');
      // Katakana runs (length>=3) and kanji runs (length>=2).
      var mk = t.match(/[\u30A0-\u30FF\u30FCー]{3,}/g) || [];
      mk.forEach(bump);
      var mj = t.match(/[\u4E00-\u9FFF]{2,}/g) || [];
      mj.forEach(bump);
      // ASCII words (length>=4), lowercased.
      var me = t.toLowerCase().match(/[a-z]{4,}/g) || [];
      me.forEach(bump);
    });
    var arr = Object.keys(freq).map(function (k) { return [k, freq[k]]; });
    arr.sort(function (a, b) { return b[1] - a[1]; });
    var out = [];
    for (var i = 0; i < arr.length && out.length < topN; i++) {
      if (arr[i][1] >= 2) out.push(arr[i][0]); // keep only terms seen at least twice
    }
    return out;
  }

  // Read a sample of actual review texts from the page (★ + body, no author names).
  function extractReviews(max) {
    max = max || 10;
    var seen = {};
    var all = []; // every visible review we can read, before balancing
    function clean(txt) {
      txt = (txt || '').replace(/\s+/g, ' ').trim().replace(/(続きを読む|もっと見る|Read more|More)\s*$/i, '').trim();
      return txt;
    }
    function add(rating, raw) {
      var txt = clean(raw);
      if (txt.length < 8) return;
      var k = txt.slice(0, 40);
      if (seen[k]) return;
      seen[k] = 1;
      if (txt.length > 300) txt = txt.slice(0, 300) + '…';
      all.push({ rating: rating || 0, text: txt });
    }
    function ratingIn(el) {
      var r = el.querySelector('[aria-label*="つ星"],[aria-label*="星"],[aria-label*="star"],[aria-label*="Star"]');
      if (r) {
        var al = r.getAttribute('aria-label') || '';
        var m = al.match(/([1-5])\s*つ星/) || al.match(/星\s*([1-5])/) || al.match(/([1-5])(?:\.0)?\s*(?:\/|out of)\s*5/i) || al.match(/([1-5])(?:\.0)?\s*stars?/i);
        if (m) return Math.round(parseFloat(m[1]));
      }
      // Fallback: no rating detected.
      return 0;
    }
    function textIn(el) {
      var t = el.querySelector('.wiI7pd, .MyEned, .review-full-text, .OA1nbd, [data-expandable-section], [class*="review-text"]');
      if (t && (t.textContent || '').trim().length >= 8) return t.textContent;
      return longestSpan(el);
    }
    function longestSpan(el) {
      var best = '', spans = el.querySelectorAll('span, div');
      for (var i = 0; i < spans.length; i++) {
        // Prefer leaf-ish nodes to avoid grabbing the whole card (name + meta + body).
        var node = spans[i];
        if (node.children && node.children.length > 2) continue;
        var t = (node.textContent || '').trim();
        if (t.length > best.length && t.length < 4000) best = t;
      }
      return best;
    }
    try {
      var conts = reviewCards();
      for (var i = 0; i < conts.length; i++) {
        add(ratingIn(conts[i]), textIn(conts[i]));
      }
      if (!all.length) {
        var sp = document.querySelectorAll('.wiI7pd, .MyEned');
        for (var j = 0; j < sp.length; j++) add(0, sp[j].textContent);
      }
    } catch (e) { /* ignore */ }

    if (all.length <= max) return all;

    // Balance across star ratings: take an equal quota from each present rating (round-robin),
    // so a feed dominated by 5★ doesn't crowd out the (often more informative) low reviews.
    var byStar = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [] };
    all.forEach(function (rv) { byStar[rv.rating].push(rv); });
    var order = [1, 2, 3, 4, 5].filter(function (s) { return byStar[s].length; }); // low→high; rated first
    if (byStar[0].length) order.push(0); // unknown-rating last
    var picked = [], idx = 0;
    while (picked.length < max) {
      var progressed = false;
      for (var o = 0; o < order.length && picked.length < max; o++) {
        var bucket = byStar[order[o]];
        if (idx < bucket.length) { picked.push(bucket[idx]); progressed = true; }
      }
      if (!progressed) break;
      idx++;
    }
    // Present in a readable order: low→high by star (unknown last).
    picked.sort(function (a, b) {
      var ra = a.rating || 99, rb = b.rating || 99;
      return ra - rb;
    });
    return picked;
  }

  // Deep analysis prompt: judge ONLY from review text. No star statistics/metrics are provided.
  function buildDeepPrompt(reviews, deepCount) {
    var n = (reviews && reviews.length) || 0;
    if (!isJa()) {
      var linesE = [
        'You are a review analyst. Below are excerpts of actual user reviews for a place (drawn from ' + (deepCount || n) + ' reviews loaded on the page; no author names; balanced across star ratings; lowest stars first).',
        'Judge ONLY from these review texts. Do NOT rely on, infer, or mention any numeric star statistics — base everything on what the reviews actually say.',
        'Respond in English in the following format.',
        'Line 1: output only "Recommendation: <label>". Choose the best-fitting <label> from "Clearly worth a visit", "Largely positive", "Decent", "Not for everyone (depends on taste)", "With caution", "Better avoided", based on the review content.',
        'From line 2 on, write these chapters. Start each heading with "■ " and put the body on the next line. No bullet lists.',
        '■ What reviewers praise … The most common positives, with how frequently/strongly they recur (3–5 sentences).',
        '■ What reviewers complain about … The most common negatives and any recurring warnings (3–5 sentences).',
        '■ Suspicious or irrelevant low ratings (review-bombing check) … From the review text only, judge whether some low ratings look unrelated to the actual experience or like coordinated review-bombing — e.g. political/religious/personal-grudge content, complaints unrelated to this business, posts admitting they did not visit, or near-identical copy-pasted wording. Describe what you see and how common it seems, then give your read of the true reputation once such reviews are set aside. If there are no clear signs, say so plainly. State clearly that this is an inference from the text, not a verified judgment, and do not accuse specific individuals (3–5 sentences).',
        '■ Who it suits / does not … Concrete situations and visitors the reviews suggest it fits, and any it does not (solo, date, family, group, business, quick stop, special occasion, etc.) (2–3 sentences).',
        '■ Verdict … An overall "is it worth visiting" conclusion grounded only in the review content, noting how consistent or divided the reviews are (2–3 sentences).',
        'Constraints: use only the excerpts; do not invent details not present; do not quote any single review verbatim — summarize as shared tendencies; weigh themes by how often they recur. Do not exaggerate. Write in English.',
        '',
        'Review excerpts:'
      ];
      reviews.forEach(function (rv) { linesE.push('・' + (rv.rating ? '★' + rv.rating + ' ' : '') + rv.text); });
      return linesE.join('\n');
    }
    var lines = [
      'あなたはレビュー分析者です。以下はある店舗の実際の利用者レビューの抜粋です（ページ上で読み込んだ' + (deepCount || n) + '件から、★が偏らないよう各評価から均等に抽出・投稿者名なし・★の低い順）。',
      '判断はこのレビュー本文のみから行ってください。星評価の統計値・数値指標は使わず、参照も言及もせず、レビューに書かれている内容だけを根拠にしてください。',
      '次の形式で日本語で出力してください。',
      '1行目: 「おすすめ度: <ラベル>」だけを書く。<ラベル>は「行く価値は高い」「おおむね良好」「まずまず」「人を選ぶ（好み次第）」「慎重に」「避けた方が無難」から、レビュー内容に最も合うものを1つ選ぶ。',
      '2行目以降は、次の見出しで章立てして書く。各見出しは行頭に「■ 」を付け、本文はその次の行に書く。箇条書きにしない。',
      '■ 評価されている点 … レビューに多い称賛を、どれくらい繰り返し出てくるか（頻度・強さ）も踏まえて述べる（3〜5文）。',
      '■ 不満点・注意点 … レビューに多い不満や繰り返される注意喚起を述べる（3〜5文）。',
      '■ 不審・無関係な低評価（荒らしチェック） … レビュー本文だけから、店舗の実際の体験と無関係な低評価や、組織的な「荒らし（評価爆撃）」と思われるものがあるかを判断する（例: 政治・宗教・私怨、店と無関係な不満、来店していないと読み取れる投稿、ほぼ同一のコピペ文面など）。見られる内容とおおよその多さを述べ、それらを除いて見た場合の本当の評判の見立ても述べる。明確な兆候がなければ「特に見当たらない」と明記する。これは本文からの推測であって確定判定ではないことを明示し、特定の個人を断定的に非難しない（3〜5文）。',
      '■ 向いている人・向かない人 … レビューから読み取れる、向いている利用シーンや客層と、逆に向かないもの（一人／デート／家族／大人数／接待／さっと立ち寄り／特別な日 など）（2〜3文）。',
      '■ 総評 … レビュー内容だけを根拠にした「行く価値があるか」の結論。評価がそろっているか割れているかにも触れる（2〜3文）。',
      '制約: 抜粋に書かれていることだけを使う。抜粋にない事柄は推測で補わない。特定のレビューの丸写し引用は避け、共通する傾向として要約する。繰り返し出てくる話題ほど重視する。誇張しない。',
      '',
      'レビュー抜粋:'
    ];
    reviews.forEach(function (rv) { lines.push('・' + (rv.rating ? '★' + rv.rating + ' ' : '') + rv.text); });
    return lines.join('\n');
  }

  function buildPrompt(c, a, reviews, deepCount) {
    var pc = function (x) { return (x * 100).toFixed(1); };
    var hasRev = reviews && reviews.length;
    var cl = classify(c, a);
    var lh = (a.loveHate === Infinity) ? (isJa() ? '∞（1★が0件）' : '∞ (no 1★)') : a.loveHate.toFixed(1);

    if (!isJa()) {
      var labelE = 'Line 1: output only "Recommendation: <label>". Choose the single best-fitting <label> from "Clearly worth a visit", "Largely positive", "Decent", "Not for everyone (depends on taste)", "With caution", "Better avoided"'
        + (hasRev ? ', considering both the numbers and the review text.' : ', based on the numbers.');
      var bodyE = hasRev
        ? 'From line 2 on, write four chapters. Start each heading with "■ " and put the body on the next line. No bullet lists.\n'
          + '■ From the numbers … Interpret the metrics below concretely (4–6 sentences). In particular, read experience variability / how split opinion is from the polarization index, disagreement probability, strong-disagreement probability and mean pairwise gap; read the shape of the distribution (polarized vs center-heavy vs dispersed) from the bimodality coefficient, distribution type and normalized entropy; read reliability and a strict lower bound from positive-dominance probability, the positive-rate 95% CI, the mean 95% CI and the risk-adjusted mean; and read the tilt of support from the Love–Hate ratio and Top−Bottom. Translate each into what it means for a visit decision (do not just list numbers).\n'
          + '■ From the review text … Common themes of praise and complaint across the reviews (2–3 sentences).\n'
          + '■ Suspicious or irrelevant low ratings … From the review text only, note whether some low ratings look unrelated to the actual experience or like review-bombing — e.g. political/religious/personal-grudge content, complaints unrelated to this business, posts that admit not visiting, or near-identical copy-pasted text. If so, describe them and how common they seem, and give your read of the rating once such reviews are set aside. If you see no clear signs, say so plainly. Be explicit that this is an inference from text, not a verified judgment, and do not accuse specific individuals (2–4 sentences).\n'
          + '■ Best-fit scenes … Concrete situations/visitors this place suits, and any it does not (e.g. solo, date, family with kids, group, business, quick stop, special occasion, quiet work). Ground each suggestion in the distribution and the review themes, not generic guesses (2–3 sentences).\n'
          + '■ Integrated verdict … State whether the numbers and the reviews agree or diverge (if they diverge, make explicit what the stars alone miss), then give the final "is it worth visiting" conclusion using both (2–3 sentences).'
        : 'From line 2 on, write two chapters. Start each heading with "■ " and put the body on the next line. No bullet lists.\n'
          + '■ From the numbers … Interpret the metrics below concretely (5–7 sentences). Read experience variability and how split opinion is from the polarization index, disagreement probability, strong-disagreement probability and mean pairwise gap; the shape of the distribution from the bimodality coefficient, distribution type and normalized entropy; reliability and a strict lower bound from positive-dominance probability, the positive-rate 95% CI, the mean 95% CI and the risk-adjusted mean; and the tilt of support from the Love–Hate ratio and Top−Bottom. Translate each into what it means for a visit decision (do not just list numbers), and end with whether it is worth visiting.\n'
          + '■ Best-fit scenes … From the distribution shape alone, what kind of visit/visitor this pattern tends to suit and what it does not (e.g. a safe pick vs a high-variance "hit or miss" place). Keep it tied to the numbers, not specifics you cannot know (2–3 sentences).';
      var constraintE = hasRev
        ? 'Constraints: base your judgment only on the rating distribution, the statistics above, and what the review excerpts actually say. Do not invent details not in the excerpts, do not quote any review verbatim, summarize as common tendencies. If the numbers and reviews conflict, treat that conflict itself as important. Translate each metric into meaning, not just figures. Do not exaggerate. Write in English.'
        : 'Constraints: judge only from the rating distribution and the statistics above; do not guess about food, service, price or other specifics. Translate each metric into meaning, not just figures. Do not pad with generic statements. Do not exaggerate. Write in English.';
      var linesE = [
        'You are a review-data analyst. Below is the 1–5★ rating distribution of a place and detailed statistics derived from it' + (hasRev ? ', a provisional numeric conclusion, and excerpts of actual review text. Integrate BOTH the numbers (especially polarization, disagreement, shape and reliability) and the review text.' : '. Use these metrics fully.'),
        'Respond in the following format, in English.',
        labelE,
        bodyE,
        constraintE,
        '',
        'Distribution (counts): 5★=' + c[5] + ', 4★=' + c[4] + ', 3★=' + c[3] + ', 2★=' + c[2] + ', 1★=' + c[1] + ' (total ' + a.n + ')',
        'mean=' + a.mean.toFixed(2) + ' / median=' + fmtMed(a.median) + ' / mode=' + a.mode + '★ / SD=' + a.sd.toFixed(2) + ' / skew=' + a.skew.toFixed(2) + ' / kurtosis=' + a.kurt.toFixed(2),
        'positive(4-5★)=' + pc(a.high) + '% / negative(1-2★)=' + pc(a.low) + '% / neutral(3★)=' + pc(a.neu) + '% / extreme(1★+5★)=' + pc(a.extreme) + '%',
        '[Polarization] polarization index=' + a.polar.toFixed(2) + '(0=centered,1=both extremes) / disagreement prob=' + pc(a.disagree) + '%(two random reviewers differ) / strong disagreement(gap 3+)=' + pc(a.strong) + '% / mean pairwise gap=' + a.meandiff.toFixed(2) + '★',
        '[Shape] bimodality coeff=' + a.bc.toFixed(2) + '(>0.56 suggests two peaks) / distribution type=' + cl.shapeLabel + ' / normalized entropy=' + a.nent.toFixed(3) + '(0–1, higher=more spread) / deviation from normal χ²=' + Math.round(a.chi2),
        '[Reliability] positive-dominance prob=' + pc(a.highDom) + '%(confidence positives exceed negatives) / positive-rate 95%CI=' + pc(a.wilsonLo) + '–' + pc(a.wilsonHi) + '%(Wilson) / mean 95%CI=' + a.ciLo.toFixed(2) + '–' + a.ciHi.toFixed(2) + ' / risk-adjusted mean=' + a.riskMean.toFixed(2) + '(lower 95% bound)',
        '[Support tilt] Love-Hate ratio=' + lh + '(5★÷1★, >1 favors fans) / Top−Bottom=' + (a.topBottom >= 0 ? '+' : '') + a.topBottom.toFixed(1) + 'pt(5★ rate − 1★ rate)'
      ];
      if (hasRev) {
        linesE.push('Provisional numeric conclusion: type=' + cl.title + ' / numeric recommendation=' + recommend(a));
        linesE.push('');
        linesE.push(deepCount
          ? ('Actual review excerpts (representative sample drawn from ALL ' + deepCount + ' reviews loaded on the page; no author names; balanced across stars; lowest stars first):')
          : 'Actual review excerpts (no author names; balanced across stars; lowest stars first):');
        reviews.forEach(function (rv) { linesE.push('・' + (rv.rating ? '★' + rv.rating + ' ' : '') + rv.text); });
      }
      return linesE.join('\n');
    }

    var label1 = '1行目: 「おすすめ度: <ラベル>」だけを書く。<ラベル>は「行く価値は高い」「おおむね良好」「まずまず」「人を選ぶ（好み次第）」「慎重に」「避けた方が無難」から、'
      + (hasRev ? '数値とレビュー本文の両方を踏まえて' : '数値に') + '最も合うものを1つ選ぶ。';
    var body2 = hasRev
      ? '2行目以降は、次の4つの見出しで章立てして書く。各見出しは行頭に「■ 」を付け、本文はその次の行に書く。箇条書きにしない。\n'
        + '■ 数値からの評価 … 下の指標を十分に使って具体的に解釈する（4〜6文）。特に、分極化指数・評価不一致確率・強い不一致確率・平均評価差から「体験のばらつき／賛否の割れ方」を、双峰性係数と分布タイプ・正規化エントロピーから「分布の形（二極化か中央集中か分散か）」を、高評価優勢確率・高評価率95%CI・平均評価95%CI・リスク調整済み平均から「評価の信頼性と辛めに見た下限」を、Love-Hate比とTop−Bottomから「支持の偏り」を読み取り、それぞれが来店判断にとって何を意味するかを平易な言葉で述べる（数値の羅列で終わらせない）。\n'
        + '■ レビュー本文からの評価 … レビューに共通する称賛と不満の傾向（2〜3文）。\n'
        + '■ 不審・無関係な低評価の扱い … レビュー本文だけから見て、店舗の実際の体験と無関係な低評価や「荒らし（評価爆撃）」と思われるものがあるかを述べる（例: 政治・宗教・私怨、店と無関係な不満、来店していないと読み取れる投稿、ほぼ同一のコピペ文面など）。あれば、その内容とおおよその多さに触れ、それらを除いて見た場合の評価感も述べる。明確な兆候がなければ「特に見当たらない」と明記する。これは本文からの推測であって確定判定ではないことを明示し、特定の個人を断定的に非難しない（2〜4文）。\n'
        + '■ おすすめのシーン … この店が向いている具体的な利用シーン・客層と、逆に向かないシーンを述べる（例: 一人／デート／子連れ・家族／大人数／接待・ビジネス／さっと立ち寄り／特別な日／静かに作業）。分布の形とレビューの傾向に根拠を置き、憶測の一般論にしない（2〜3文）。\n'
        + '■ 統合評価 … 数値とレビューが一致するか食い違うか（食い違う場合は星評価だけでは見えない点を明示）を述べ、両方を踏まえた最終的な「行く価値があるか」の結論（2〜3文）。'
      : '2行目以降は、次の2つの見出しで章立てして書く。各見出しは行頭に「■ 」を付け、本文はその次の行に書く。箇条書きにしない。\n'
        + '■ 数値からの評価 … 下の指標を十分に使って具体的に解釈する（5〜7文）。分極化指数・評価不一致確率・強い不一致確率・平均評価差から体験のばらつきと賛否の割れ方を、双峰性係数と分布タイプ・正規化エントロピーから分布の形を、高評価優勢確率・高評価率95%CI・平均評価95%CI・リスク調整済み平均から評価の信頼性と辛めに見た下限を、Love-Hate比とTop−Bottomから支持の偏りを読み取り、それぞれが来店判断にとって何を意味するかを平易な言葉で述べ（数値の羅列で終わらせない）、最後に行く価値の結論を述べる。\n'
        + '■ おすすめのシーン … 分布の形から言える範囲で、このパターンが向きやすい利用シーン・客層と、逆に向かないものを述べる（例: 失敗しにくい安牌か、当たり外れの大きい店か）。実際の中身は推測せず、数値に根拠を置く（2〜3文）。';
    var constraint = hasRev
      ? '制約: 判断は星評価の分布・上記の統計指標と、提供されたレビュー抜粋から読み取れる範囲とすること。抜粋にない事柄は推測で補わず、特定の本文の丸写し引用は避け、共通する傾向として要約すること。数値とレビューが矛盾する場合は、その不一致自体を重要な判断材料として扱うこと。各指標は数値を述べるだけでなく意味に翻訳すること。誇張しないこと。'
      : '制約: 判断はあくまで星評価の分布と上記の統計指標から言える範囲とし、料理・接客・価格など実際の中身は推測しないこと。各指標は数値を述べるだけでなく意味に翻訳すること。憶測や一般論で補わず、誇張しないこと。';
    var lines = [
      'あなたは口コミデータの分析者です。以下はある店舗の5段階評価（★1〜5）の分布と、そこから算出した詳細な統計指標' + (hasRev ? '、数値から導いた暫定結論、および実際のレビュー本文の抜粋です。数値（特に二極化・不一致・分布の形・信頼性の各指標）とレビュー本文の両方を十分に使って統合判断してください' : 'です。これらの指標を十分に使って判断してください') + '。',
      '次の形式で日本語で出力してください。',
      label1,
      body2,
      constraint,
      '',
      '分布(件数): 5★=' + c[5] + ', 4★=' + c[4] + ', 3★=' + c[3] + ', 2★=' + c[2] + ', 1★=' + c[1] + ' (合計' + a.n + ')',
      '平均=' + a.mean.toFixed(2) + ' / 中央値=' + fmtMed(a.median) + ' / 最頻値=' + a.mode + '★ / 標準偏差=' + a.sd.toFixed(2) + ' / 歪度=' + a.skew.toFixed(2) + ' / 尖度=' + a.kurt.toFixed(2),
      '高評価率(4-5★)=' + pc(a.high) + '% / 低評価率(1-2★)=' + pc(a.low) + '% / 中立率(3★)=' + pc(a.neu) + '% / 極端評価率(1★+5★)=' + pc(a.extreme) + '%',
      '【二極化・不一致】分極化指数=' + a.polar.toFixed(2) + '(0=中央集中,1=両極) / 評価不一致確率=' + pc(a.disagree) + '%(無作為な2人の評価が異なる) / 強い不一致確率(差3+)=' + pc(a.strong) + '% / 平均評価差=' + a.meandiff.toFixed(2) + '★',
      '【分布の形】双峰性係数=' + a.bc.toFixed(2) + '(0.56超で双峰の可能性) / 分布タイプ=' + cl.shapeLabel + ' / 正規化エントロピー=' + a.nent.toFixed(3) + '(0〜1,1ほど分散) / 正規分布乖離χ²=' + Math.round(a.chi2),
      '【信頼性】高評価優勢確率=' + pc(a.highDom) + '%(高評価率が低評価率を上回る確実性) / 高評価率95%CI=' + pc(a.wilsonLo) + '〜' + pc(a.wilsonHi) + '%(Wilson) / 平均評価95%CI=' + a.ciLo.toFixed(2) + '〜' + a.ciHi.toFixed(2) + ' / リスク調整済み平均=' + a.riskMean.toFixed(2) + '(平均の95%下限,辛め)',
      '【支持の偏り】Love-Hate比=' + lh + '(5★÷1★,1超で支持優勢) / Top−Bottom=' + (a.topBottom >= 0 ? '+' : '') + a.topBottom.toFixed(1) + 'pt(5★率−1★率)'
    ];
    if (hasRev) {
      lines.push('数値分析の暫定結論: 分類=' + cl.title + ' / 数値ベースの推奨=' + recommend(a));
      lines.push('');
      lines.push(deepCount
        ? ('実際のレビュー本文の抜粋（ページ上で読み込んだ全' + deepCount + '件から、★が偏らないよう各評価から均等に抽出した代表・投稿者名なし・★の低い順）:')
        : '実際のレビュー本文の抜粋（投稿者名なし・★が偏らないよう各評価から均等に抽出・★の低い順）:');
      reviews.forEach(function (rv) { lines.push('・' + (rv.rating ? '★' + rv.rating + ' ' : '') + rv.text); });
    }
    return lines.join('\n');
  }

  function getConcl(r) { return r.bd.querySelector('#gmrsConcl'); }
  function setMetricsHidden(r, hidden) {
    var m = r.bd.querySelector('#gmrsMetrics');
    if (m) m.style.display = hidden ? 'none' : '';
  }
  // Reflect the deep button state: running (disabled), already-analyzed (re-analyze), or default.
  function updateDeepBtn(r, key) {
    var b = r.bd.querySelector('#gmrsDeepBtn');
    if (!b) return;
    if (deepBusy) {
      b.disabled = true;
      b.textContent = S('deepRunning');
    } else {
      b.disabled = false;
      b.textContent = (key && deepCache[key]) ? S('deepRedo') : S('deepLink');
    }
  }

  function recColorLocal(a) {
    var lv = recLevel(a);
    return lv === 'good' ? '#1D9E75' : lv === 'okay' ? '#3a9d78' : lv === 'mixed' ? '#c8821f' : lv === 'bad' ? '#d4433f' : 'var(--text-soft)';
  }
  function recColorText(s) {
    if (/避け|おすすめしない|向かない/.test(s) || /avoid|skip|steer clear/i.test(s)) return '#d4433f';
    if (/慎重/.test(s) || /caution|cautious/i.test(s)) return '#d4433f';
    if (/人を選ぶ|好み|賛否|分かれ/.test(s) || /not for everyone|mixed|divided|depends/i.test(s)) return '#c8821f';
    if (/高い|良好|おすすめ|満足|十分/.test(s) || /worth (a )?visit|recommend|highly|positive|great/i.test(s)) return '#1D9E75';
    if (/まずまず|ある方|悪くない/.test(s) || /decent|okay|ok\b|fair|fine/i.test(s)) return '#3a9d78';
    return 'var(--text-soft)';
  }
  function parseAI(text) {
    var t = String(text || '').trim();
    var m = t.match(/^\s*(?:おすすめ度|Recommendation)[\s:：]*([^\n]+)\n?([\s\S]*)$/i);
    if (m) return { rec: m[1].trim(), body: (m[2] || '').trim() };
    return { rec: '', body: t };
  }

  // Render a verdict body. If it uses "■ 見出し" chapters, show each as a heading + paragraph.
  function formatVerdictBody(body) {
    var t = String(body || '').trim();
    if (/(^|\n)\s*■/.test(t)) {
      var parts = t.split(/\n(?=\s*■)/);
      var html = '';
      parts.forEach(function (p) {
        p = p.trim(); if (!p) return;
        var mm = p.match(/^■\s*([^\n：:]+)[：:]?\s*\n?([\s\S]*)$/);
        if (mm) {
          html += '<div class="vh">' + escapeHtml(mm[1].trim()) + '</div>';
          var txt = (mm[2] || '').trim();
          if (txt) html += '<div class="vb">' + escapeHtml(txt).replace(/\n/g, '<br>') + '</div>';
        } else {
          html += '<div class="vb">' + escapeHtml(p).replace(/\n/g, '<br>') + '</div>';
        }
      });
      return html;
    }
    return escapeHtml(t).replace(/\n/g, '<br>');
  }

  function conclResultHtml(cl, recText, recColor, bodyHtml, srcLabel, actHtml) {
    var title = (cl && cl.title) ? cl.title : S('verdictTitle');
    return '<div class="ct">' + S('verdictPrefix') + escapeHtml(title) + '</div>' +
      '<div class="rec" style="color:' + recColor + '">' + S('recPrefix') + escapeHtml(recText) + '</div>' +
      '<div class="cs" id="gmrsVerdict">' + bodyHtml + '</div>' +
      '<div class="csrc"><span class="vsrc" id="gmrsSrc">' + escapeHtml(srcLabel) + '</span></div>' +
      '<div class="cact" id="gmrsAct">' + (actHtml || '') + '</div>';
  }
  function wireConcl(r, key, c, a, cl) {
    var el = getConcl(r); if (!el) return;
    var regen = el.querySelector('#gmrsRegen');
    if (regen) regen.addEventListener('click', function () { requestVerdict(r, key, c, a, true); });
    var opt = el.querySelector('#gmrsOpt');
    if (opt) opt.addEventListener('click', function () { chrome.runtime.sendMessage({ type: 'GMRS_OPEN_OPTIONS' }); });
    var rt = el.querySelector('#gmrsRetry');
    if (rt) rt.addEventListener('click', function () { requestVerdict(r, key, c, a, true); });
    var deep = el.querySelector('#gmrsDeep');
    if (deep) deep.addEventListener('click', function () { runDeepAnalysis(r, key, c, a); });
    var back = el.querySelector('#gmrsBack');
    if (back) back.addEventListener('click', function () {
      try {
        setMetricsHidden(r, false);
        if (aiCache[key]) {
          showAIConcl(r, key, c, a, cl, aiCache[key].text, aiCache[key].model, aiCache[key].provider, aiCache[key].withReviews);
        } else {
          showLocalConcl(r, key, c, a, cl); // no normal AI result cached; show local (offers AI/deep links)
        }
      } catch (e) {
        // Last-resort fallback so the panel never gets stuck.
        try { setMetricsHidden(r, false); showLocalConcl(r, key, c, a, classify(c, a)); } catch (e2) {}
      }
    });
  }
  function showLocalConcl(r, key, c, a, cl, actHtml) {
    var el = getConcl(r); if (!el) return;
    if (!cl) cl = classify(c, a);
    var defAct = '<span class="link" id="gmrsRegen">' + S('genAI') + '</span>';
    var act = (actHtml != null) ? actHtml : defAct;
    var sceneHead = isJa() ? 'おすすめのシーン' : 'Best-fit scenes';
    var body = '<div class="vb">' + escapeHtml(cl.summary) + '</div>'
      + '<div class="vh">' + sceneHead + '</div>'
      + '<div class="vb">' + escapeHtml(cl.scene || sceneFor(a, c)) + '</div>';
    el.innerHTML = conclResultHtml(cl, recommend(a), recColorLocal(a), body, S('srcLocal'), act);
    wireConcl(r, key, c, a, cl);
  }
  function showAIConcl(r, key, c, a, cl, text, model, provider, withReviews, deepCount) {
    var el = getConcl(r); if (!el) return;
    if (!cl) cl = classify(c, a);
    var pa = parseAI(text);
    var recText = pa.rec || recommend(a);
    var col = pa.rec ? recColorText(pa.rec) : recColorLocal(a);
    var bodyHtml = formatVerdictBody(pa.body);
    var prov = (provider === 'openai') ? 'OpenAI' : 'Gemini';
    var revMark = deepCount ? (isJa() ? STR.srcDeep.ja(deepCount) : STR.srcDeep.en(deepCount)) : (withReviews ? S('srcWithRev') : '');
    var src = '(' + prov + ' ' + (model || '') + revMark + ')';
    // Deep analysis is offered via the prominent button under the verdict, so no inline link here.
    var act = '';
    el.innerHTML = conclResultHtml(cl, recText, col, bodyHtml, src, act);
    wireConcl(r, key, c, a, cl);
  }
  function showLoadingConcl(r, msg) {
    var el = getConcl(r); if (!el) return;
    el.innerHTML = '<div class="ct">' + S('verdictTitle') + '</div>' +
      '<div class="evrow"><span class="evdot"></span><span class="evtxt" id="gmrsEvtxt">' + escapeHtml(msg || S('evaluating')) + '</span></div>' +
      '<div class="evbar b1"></div><div class="evbar b2"></div><div class="evbar b3"></div>';
  }
  // Deep (reviews-only) verdict: metrics hidden, keyword chapter appended, back link shown.
  function showDeepConcl(r, key, c, a, cl, text, model, provider, deepCount, keywords) {
    var el = getConcl(r); if (!el) return;
    if (!cl) cl = classify(c, a);
    setMetricsHidden(r, true);
    var pa = parseAI(text);
    var recText = pa.rec || recommend(a);
    var col = pa.rec ? recColorText(pa.rec) : recColorLocal(a);
    var bodyHtml = formatVerdictBody(pa.body);
    if (keywords && keywords.length) {
      bodyHtml += '<div class="vh">' + S('kwHead') + '</div>'
        + '<div class="kw">' + keywords.map(function (k) { return '<span class="kwt">' + escapeHtml(k) + '</span>'; }).join('') + '</div>';
    }
    var prov = (provider === 'openai') ? 'OpenAI' : 'Gemini';
    var src = '(' + prov + ' ' + (model || '') + (isJa() ? STR.srcDeep.ja(deepCount) : STR.srcDeep.en(deepCount)) + ')';
    var act = '<span class="link" id="gmrsBack">' + S('backNormal') + '</span>';
    el.innerHTML = conclResultHtml(cl, recText, col, bodyHtml, src, act);
    wireConcl(r, key, c, a, cl);
  }
  // Render the cached NORMAL verdict (metrics visible).
  function showCachedConcl(r, key, c, a, cl) {
    var e = aiCache[key]; if (!e) return;
    setMetricsHidden(r, false);
    showAIConcl(r, key, c, a, cl, e.text, e.model, e.provider, e.withReviews, e.deepCount);
  }

  // Generate the "総合評価" via Gemini. force=true: manual (ignores cache & auto setting).
  function requestVerdict(r, key, c, a, force, autoTries) {
    autoTries = autoTries || 0;
    if (countTimer) { clearInterval(countTimer); countTimer = null; }
    var cl = classify(c, a);
    if (!getConcl(r)) return;
    if (!force && aiCache[key]) { showCachedConcl(r, key, c, a, cl); return; }
    showLoadingConcl(r);
    chrome.storage.local.get(['analyzeReviews', 'reviewCount'], function (rcfg) {
      if (curKey !== key) return;
      var nRev = Math.max(1, Math.min(40, parseInt(rcfg.reviewCount, 10) || 10));
      var reviews = rcfg.analyzeReviews ? extractReviews(nRev) : null;
      var usedRev = !!(reviews && reviews.length);
      try {
        chrome.runtime.sendMessage({ type: 'GMRS_AI', prompt: buildPrompt(c, a, reviews), auto: !force }, function (resp) {
          if (curKey !== key) return; // user navigated to another place; ignore stale result
          if (chrome.runtime.lastError || !resp) { showLocalConcl(r, key, c, a, cl); return; }
          if (resp.ok) {
            aiCache[key] = { text: resp.text, model: resp.model || '', provider: resp.provider || '', withReviews: usedRev };
            showAIConcl(r, key, c, a, cl, resp.text, resp.model, resp.provider, usedRev);
          } else if (resp.error === 'NO_KEY') {
            var actK = force ? (S('noKeyManual') + '<span class="link" id="gmrsOpt">' + S('openOpts') + '</span>') : '<span class="link" id="gmrsRegen">' + S('genAI') + '</span>';
            showLocalConcl(r, key, c, a, cl, actK);
          } else if (resp.error === 'AUTO_OFF') {
            showLocalConcl(r, key, c, a, cl);
          } else {
            var sec = resp.retryDelay ? Math.ceil(resp.retryDelay / 1000) : 0;
            var canAuto = (resp.status === 429 || resp.status === 503) && sec > 0 && sec <= AUTO_MAX_SEC && autoTries < MAX_AUTO_RETRY;
            if (canAuto) {
              var remain = sec + 1;
              var arFn = isJa() ? STR.autoRetry.ja : STR.autoRetry.en;
              showLoadingConcl(r, arFn(remain, autoTries + 1, MAX_AUTO_RETRY));
              countTimer = setInterval(function () {
                remain -= 1;
                if (remain <= 0) { clearInterval(countTimer); countTimer = null; requestVerdict(r, key, c, a, true, autoTries + 1); return; }
                var t = r.bd.querySelector('#gmrsEvtxt');
                if (t) t.textContent = arFn(remain, autoTries + 1, MAX_AUTO_RETRY);
              }, 1000);
            } else {
              var riFn = isJa() ? STR.retryInSec.ja : STR.retryInSec.en;
              var emsg = (resp.status === 429)
                ? S('aiBusyQuota') + (sec ? riFn(sec) : S('retryLater')) + S('retryCan')
                : (resp.error || S('genFail'));
              showLocalConcl(r, key, c, a, cl, '<span class="err">' + escapeHtml(emsg) + '</span> <span class="link" id="gmrsRetry">' + S('retry') + '</span>');
            }
          }
        });
      } catch (e) { showLocalConcl(r, key, c, a, cl); }
    });
  }

  // Deep analysis: scroll-load as many reviews as possible, then analyze a balanced sample.
  var DEEP_SAMPLE = 100;      // review texts actually sent to the AI
  var DEEP_MAX_LOAD = 100000; // no practical cap on how many to load (time budget governs)
  var DEEP_MAX_MS = 180000;   // hard time budget for scrolling
  var deepBusy = false;
  function runDeepAnalysis(r, key, c, a) {
    if (deepBusy) return;
    var cl = classify(c, a);
    if (!getConcl(r)) return;
    // Already have a deep result for this place: just show it, don't regenerate.
    if (deepCache[key]) {
      var d = deepCache[key];
      showDeepConcl(r, key, c, a, cl, d.text, d.model, d.provider, d.deepCount, d.keywords);
      return;
    }
    deepBusy = true;
    updateDeepBtn(r, key); // -> "超分析中…", disabled
    setMetricsHidden(r, true); // hide stats immediately, before loading/AI begins
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (countTimer) { clearInterval(countTimer); countTimer = null; }
    var loadFn = isJa() ? STR.deepLoading.ja : STR.deepLoading.en;
    // Step 1: make sure we're on the Reviews tab (the Overview tab has no scrollable feed).
    showLoadingConcl(r, S('deepOpenTab2'));
    openReviewsTab(9000).then(function () {
      if (curKey !== key) { deepBusy = false; updateDeepBtn(r, key); return; }
      // If still no scrollable feed and no reviews at all, give up gracefully.
      if (!allScrollables().length && !reviewCards().length) {
        deepBusy = false;
        updateDeepBtn(r, key);
        setMetricsHidden(r, false);
        showLocalConcl(r, key, c, a, cl, '<span class="err">' + escapeHtml(S('deepOpenTab')) + '</span> <span class="link" id="gmrsRegen">' + S('genAI') + '</span> <span class="link" id="gmrsDeep" title="' + S('deepHint') + '">' + S('deepLink') + '</span>');
        return;
      }
      // Step 2: scroll-load all reviews.
      showLoadingConcl(r, loadFn(reviewCards().length));
      return loadAllReviews(function (n) {
        if (curKey !== key) return;
        var t = r.bd.querySelector('#gmrsEvtxt');
        if (t) t.textContent = loadFn(a.n && n > a.n ? a.n : n);
      }, DEEP_MAX_LOAD, DEEP_MAX_MS).then(function (total) {
        if (curKey !== key) { deepBusy = false; updateDeepBtn(r, key); return; }
        var reviews = extractReviews(DEEP_SAMPLE);
        var loaded = total || reviews.length;
        // The text-review count can never exceed the rated-review total from the histogram.
        if (a.n && loaded > a.n) loaded = a.n;
      var keywords = topKeywords(reviews, 12);
      var genFn = isJa() ? STR.deepGen.ja : STR.deepGen.en;
      showLoadingConcl(r, genFn(loaded));
      try {
        chrome.runtime.sendMessage({ type: 'GMRS_AI', prompt: buildDeepPrompt(reviews, loaded), auto: false }, function (resp) {
          deepBusy = false;
          updateDeepBtn(r, key); // re-enable; becomes "再分析" if a deep result was cached
          if (curKey !== key) return;
          if (chrome.runtime.lastError || !resp) { setMetricsHidden(r, false); showLocalConcl(r, key, c, a, cl); return; }
          if (resp.ok) {
            deepCache[key] = { text: resp.text, model: resp.model || '', provider: resp.provider || '', deepCount: loaded, keywords: keywords };
            showDeepConcl(r, key, c, a, cl, resp.text, resp.model, resp.provider, loaded, keywords);
            updateDeepBtn(r, key); // now cached -> "再分析"
          } else if (resp.error === 'NO_KEY') {
            setMetricsHidden(r, false);
            showLocalConcl(r, key, c, a, cl, S('noKeyManual') + '<span class="link" id="gmrsOpt">' + S('openOpts') + '</span>');
          } else {
            setMetricsHidden(r, false);
            var emsg = resp.error || S('genFail');
            showLocalConcl(r, key, c, a, cl, '<span class="err">' + escapeHtml(emsg) + '</span> <span class="link" id="gmrsDeep" title="' + S('deepHint') + '">' + S('deepLink') + '</span>');
          }
        });
      } catch (e) { deepBusy = false; updateDeepBtn(r, key); setMetricsHidden(r, false); showLocalConcl(r, key, c, a, cl); }
      }); // end loadAllReviews().then
    }); // end openReviewsTab().then
  }

  function renderStats(c) {
    var r = ensurePanel();
    var a = analyze(c);
    var cl = classify(c, a);
    var pc1 = function (x) { return (x * 100).toFixed(1); };
    var h = '';

    // 1. 総合評価 (top): filled after render (local immediately; AI / 評価中 animation as needed)
    h += '<div class="concl" id="gmrsConcl"></div>';

    // Prominent deep-analysis button (always visible, just under the verdict).
    h += '<button class="deepbtn" id="gmrsDeepBtn">' + S('deepLink') + '</button>';
    h += '<div class="deepnote">' + S('deepHint') + '</div>';

    // Everything below the verdict is the statistical detail; hidden during deep (reviews-only) analysis.
    h += '<div id="gmrsMetrics">';

    // 2. Key KPI cards (basic)
    h += '<div class="sec">' + S('secKpi') + '</div>';
    h += '<div class="cards3">';
    h += card(S('cMean'), a.mean.toFixed(2), ' / 5');
    h += card(S('cMedian'), fmtMed(a.median), ' / 5');
    h += card(S('cMode'), a.mode + '\u2605', '');
    h += card(S('cHigh'), pc1(a.high), '%');
    h += card(S('cLow'), pc1(a.low), '%');
    h += card(S('cExtreme'), pc1(a.extreme), '%');
    h += '</div>';

    // 3. Star distribution chart (main visual)
    h += '<div class="sec">' + S('secChart') + '</div>';
    h += '<div class="leg"><span><i style="background:#378ADD"></i>' + S('legMeasured') + '</span><span><i class="dash"></i>' + S('legNormal') + '</span></div>';
    h += '<div class="chartwrap">' + buildChart(c, a) + '</div>';
    h += '<div class="subt">' + escapeHtml(chartComment(c, a)) + '</div>';

    // 4. Polarization / risk
    h += '<div class="sec">' + S('secPolar') + '</div>';
    h += '<div class="metrics">';
    h += metric(S('mPolar'), a.polar.toFixed(2), ' / 1', S('mPolarI'));
    h += metric(S('mDisagree'), pc1(a.disagree), '%', S('mDisagreeI'));
    h += metric(S('mStrong'), pc1(a.strong), '%', S('mStrongI'));
    h += metric(S('mMeanDiff'), a.meandiff.toFixed(2), '\u2605', S('mMeanDiffI'));
    h += metric(S('mLoveHate'), fmtRatio(a.loveHate), '', S('mLoveHateI'));
    h += metric(S('mTopBottom'), (a.topBottom >= 0 ? '+' : '') + a.topBottom.toFixed(1), 'pt', S('mTopBottomI'));
    h += '</div>';

    // 5. Reliability / statistical safety
    h += '<div class="sec">' + S('secReli') + '</div>';
    h += '<div class="metrics">';
    h += metric(S('mHighDom'), pc1(a.highDom), '%', S('mHighDomI'));
    h += metric(S('mWilson'), pc1(a.wilsonLo) + (isJa() ? '〜' : '–') + pc1(a.wilsonHi), '%', S('mWilsonI'));
    h += metric(S('mMeanCI'), a.ciLo.toFixed(2) + (isJa() ? '〜' : '–') + a.ciHi.toFixed(2), '', S('mMeanCII'));
    h += metric(S('mRiskMean'), a.riskMean.toFixed(2), ' / 5', S('mRiskMeanI'));
    h += '</div>';

    // 6. Advanced distribution analysis
    h += '<div class="sec">' + S('secAdv') + '</div>';
    h += '<div class="metrics">';
    h += metric(S('mEntropy'), a.nent.toFixed(3), '', S('mEntropyI'));
    h += metric(S('mBimod'), a.bc.toFixed(2), '', S('mBimodI'));
    h += metric(S('mChi2'), Math.round(a.chi2).toLocaleString(), '', S('mChi2I'));
    h += metric(S('mShape'), cl.shapeLabel, '', S('mShapeI'));
    h += '</div>';

    // 7. Three-way split
    h += '<div class="sec">' + S('secCat') + '</div>';
    h += '<div class="cat"><div style="width:' + pc1(a.high) + '%;background:#1D9E75"></div><div style="width:' + pc1(a.neu) + '%;background:#888780"></div><div style="width:' + pc1(a.low) + '%;background:#E24B4A"></div></div>';
    var uc = S('unitCount');
    h += '<div class="catleg">' +
      '<span><i style="background:#1D9E75"></i>' + S('catHigh') + ' ' + (c[4] + c[5]).toLocaleString() + uc + ' (' + pc1(a.high) + '%)</span>' +
      '<span><i style="background:#888780"></i>' + S('catNeu') + ' ' + c[3].toLocaleString() + uc + ' (' + pc1(a.neu) + '%)</span>' +
      '<span><i style="background:#E24B4A"></i>' + S('catLow') + ' ' + (c[1] + c[2]).toLocaleString() + uc + ' (' + pc1(a.low) + '%)</span>' +
      '</div>';
    h += '<div class="subt" style="margin-top:7px;">' + escapeHtml(catComment(c, a)) + '</div>';

    h += '</div>'; // /gmrsMetrics

    h += '<div class="foot" style="margin-top:11px;font-size:10px;color:var(--text-faint);text-align:right;">' + S('footTotal') + a.n.toLocaleString() + uc + S('footTail') + '</div>';
    r.bd.innerHTML = h;

    var key = placeIdOf() + '|' + [c[1], c[2], c[3], c[4], c[5]].join(',');
    curKey = key;
    curCtx = { r: r, key: key, c: c, a: a };
    var deepBtn = r.bd.querySelector('#gmrsDeepBtn');
    if (deepBtn) deepBtn.addEventListener('click', function () { runDeepAnalysis(r, key, c, a); });
    updateDeepBtn(r, key);
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    if (countTimer) { clearInterval(countTimer); countTimer = null; }

    try {
      if (deepCache[key]) {
        // A deep (reviews-only) result exists for this place: restore that view, metrics hidden.
        var d = deepCache[key];
        showDeepConcl(r, key, c, a, cl, d.text, d.model, d.provider, d.deepCount, d.keywords);
        return;
      }
      if (aiCache[key]) {
        // Cached normal AI verdict: show it directly.
        showCachedConcl(r, key, c, a, cl);
        return;
      }
    } catch (e) {
      try { setMetricsHidden(r, false); showLocalConcl(r, key, c, a, cl); } catch (e2) {}
      return;
    }
    // Decide the first thing shown by whether AI will run (settings read is a few ms; the block stays empty until then).
    // AI on  -> show the "評価中…" loader first, then the AI verdict (local is never shown first).
    // AI off -> show the local verdict (with a manual "AIで生成" link).
    chrome.storage.local.get(['provider', 'geminiKey', 'openaiKey', 'autoAI'], function (cfg) {
      if (curKey !== key) return;
      var hasKey = (cfg.provider === 'openai')
        ? !!(cfg.openaiKey && String(cfg.openaiKey).trim())
        : !!(cfg.geminiKey && String(cfg.geminiKey).trim());
      var autoOn = (cfg.autoAI !== false);
      if (hasKey && autoOn) {
        showLoadingConcl(r);
        autoTimer = setTimeout(function () { if (curKey === key) requestVerdict(r, key, c, a, false); }, 500);
      } else {
        showLocalConcl(r, key, c, a, cl);
      }
    });
  }

  function renderMsg(title, sub) {
    var r = ensurePanel();
    r.bd.innerHTML = '<div class="msg"><span class="t1">' + title + '</span>' + (sub || '') + '</div>';
  }

  function update() {
    var onPlace = /\/maps\/place\//.test(location.href);
    if (!onPlace) { removePanel(); curPlace = ''; lastRenderKey = ''; return; }
    var placeKey = placeIdOf();
    if (placeKey !== curPlace) {
      curPlace = placeKey; seenAt = Date.now(); lastRenderKey = '';
      renderMsg(S('loadingTitle'), S('loadingSub'));
    }
    var counts = parseHistogram();
    if (counts) {
      // Require all five buckets to be present numbers; otherwise treat as not-ready.
      var okCounts = true, sum = 0;
      for (var s = 1; s <= 5; s++) {
        var v = counts[s];
        if (typeof v !== 'number' || isNaN(v)) { okCounts = false; break; }
        sum += v;
      }
      if (okCounts && sum > 0) {
        var key = placeKey + '|' + [1, 2, 3, 4, 5].map(function (s2) { return counts[s2]; }).join(',');
        if (key !== lastRenderKey) {
          try { renderStats(counts); lastRenderKey = key; }
          catch (e) { /* keep the panel alive; will retry on next tick */ }
        }
        return;
      }
    }
    if (Date.now() - seenAt > 2200 && lastRenderKey !== 'empty') {
      renderMsg(S('noDistTitle'), S('noDistSub'));
      lastRenderKey = 'empty';
    }
  }

  var moTimer = null;
  var mo = new MutationObserver(function () {
    if (moTimer) return;
    moTimer = setTimeout(function () { moTimer = null; update(); }, 180);
  });
  function start() {
    try { mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    // Resolve UI language once, then begin observing. 'auto' follows the page/browser language.
    try {
      chrome.storage.local.get(['uiLang'], function (cfg) {
        applyLang(cfg && cfg.uiLang);
        setInterval(update, 700);
        update();
      });
    } catch (e) {
      applyLang('auto');
      setInterval(update, 700);
      update();
    }
    // Re-render in the new language if the setting changes while a tab is open.
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.uiLang) {
          applyLang(changes.uiLang.newValue);
          aiCache = {};            // cached verdicts are language-specific
          lastRenderKey = '';      // force a re-render
          update();
        }
      });
    } catch (e2) { /* ignore */ }
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
