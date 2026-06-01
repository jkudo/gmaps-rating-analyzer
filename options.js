'use strict';

var providerEl = document.getElementById('provider');
var uilangEl = document.getElementById('uilang');
var keyEl = document.getElementById('key');
var modelEl = document.getElementById('model');
var okeyEl = document.getElementById('okey');
var omodelEl = document.getElementById('omodel');
var autoEl = document.getElementById('autoai');
var reviewsEl = document.getElementById('reviews');
var reviewCountEl = document.getElementById('reviewCount');
var reviewCountWrap = document.getElementById('reviewCountWrap');
var statusEl = document.getElementById('status');
var geminiFields = document.getElementById('geminiFields');
var openaiFields = document.getElementById('openaiFields');

// ---------- options i18n ----------
var OPT_LANG = 'ja';
function resolveLang(stored) {
  if (stored === 'ja' || stored === 'en') return stored;
  return (navigator.language || 'en').toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';
}
function optJa() { return OPT_LANG === 'ja'; }
// Phrases produced from JS (not static in the HTML).
var OPT = {
  saved:        { ja: '保存しました。', en: 'Saved.' },
  keyDeleted:   { ja: 'キーを削除しました。', en: 'Key deleted.' },
  show:         { ja: '表示', en: 'Show' },
  hide:         { ja: '隠す', en: 'Hide' },
  clearGemini:  { ja: 'Geminiキーを削除', en: 'Delete Gemini key' },
  clearOpenAI:  { ja: 'OpenAIキーを削除', en: 'Delete OpenAI key' },
  needKey:      { ja: function (p) { return '先に' + p + 'のキーを入力してください。'; },
                  en: function (p) { return 'Enter the ' + p + ' key first.'; } },
  testing:      { ja: 'テスト中…', en: 'Testing…' },
  errPrefix:    { ja: 'エラー: ', en: 'Error: ' },
  okPrefix:     { ja: '成功', en: 'Success' },
  failPrefix:   { ja: '失敗: ', en: 'Failed: ' },
  noKeySet:     { ja: 'キーが未設定です', en: 'No key set' },
  noResp:       { ja: '応答がありません', en: 'No response' }
};
function L(k, arg) {
  var e = OPT[k]; if (!e) return k;
  var v = optJa() ? e.ja : e.en;
  return (typeof v === 'function') ? v(arg) : v;
}
// Apply data-ja / data-en (text), data-*-html (innerHTML), data-*-ph (placeholder) across the page.
function applyOptsLang(lang) {
  OPT_LANG = lang;
  document.documentElement.setAttribute('lang', lang);
  var els = document.querySelectorAll('[data-ja],[data-en],[data-ja-html],[data-en-html],[data-ja-ph],[data-en-ph]');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var html = el.getAttribute(lang === 'ja' ? 'data-ja-html' : 'data-en-html');
    if (html != null) { el.innerHTML = html; continue; }
    var ph = el.getAttribute(lang === 'ja' ? 'data-ja-ph' : 'data-en-ph');
    if (ph != null) { el.setAttribute('placeholder', ph); continue; }
    var txt = el.getAttribute(lang === 'ja' ? 'data-ja' : 'data-en');
    if (txt != null) el.textContent = txt;
  }
  // Re-apply pieces that JS controls so they match the language too.
  syncProviderView();
  var tk = document.getElementById('toggleKey');
  var tok = document.getElementById('toggleOkey');
  if (tk) tk.textContent = keyEl.classList.contains('masked') ? L('show') : L('hide');
  if (tok) tok.textContent = okeyEl.classList.contains('masked') ? L('show') : L('hide');
}

function setStatus(t) { statusEl.textContent = t; }

function syncProviderView() {
  var openai = (providerEl.value === 'openai');
  geminiFields.style.display = openai ? 'none' : '';
  openaiFields.style.display = openai ? '' : 'none';
  document.getElementById('clear').textContent = openai ? L('clearOpenAI') : L('clearGemini');
}

function syncReviewView() {
  reviewCountWrap.style.display = reviewsEl.checked ? '' : 'none';
}

chrome.storage.local.get(['provider', 'geminiKey', 'geminiModel', 'openaiKey', 'openaiModel', 'autoAI', 'analyzeReviews', 'reviewCount', 'uiLang'], function (cfg) {
  providerEl.value = (cfg.provider === 'openai') ? 'openai' : 'gemini';
  uilangEl.value = (cfg.uiLang === 'ja' || cfg.uiLang === 'en') ? cfg.uiLang : 'auto';
  if (cfg.geminiKey) keyEl.value = cfg.geminiKey;
  if (cfg.geminiModel) modelEl.value = cfg.geminiModel;
  if (cfg.openaiKey) okeyEl.value = cfg.openaiKey;
  if (cfg.openaiModel) omodelEl.value = cfg.openaiModel;
  autoEl.checked = (cfg.autoAI !== false); // default true
  reviewsEl.checked = (cfg.analyzeReviews === true); // default false
  reviewCountEl.value = String(cfg.reviewCount || 10);
  applyOptsLang(resolveLang(cfg.uiLang)); // calls syncProviderView internally

  syncReviewView();
});

function save(cb) {
  chrome.storage.local.set({
    provider: providerEl.value,
    uiLang: uilangEl.value,
    geminiKey: keyEl.value.trim(),
    geminiModel: modelEl.value,
    openaiKey: okeyEl.value.trim(),
    openaiModel: omodelEl.value,
    autoAI: autoEl.checked,
    analyzeReviews: reviewsEl.checked,
    reviewCount: parseInt(reviewCountEl.value, 10) || 10
  }, function () { if (cb) cb(); });
}

document.getElementById('save').addEventListener('click', function () {
  save(function () { setStatus(L('saved')); setTimeout(function () { setStatus(''); }, 2500); });
});

providerEl.addEventListener('change', function () { syncProviderView(); save(); });
uilangEl.addEventListener('change', function () { applyOptsLang(resolveLang(uilangEl.value)); save(); });
autoEl.addEventListener('change', function () { save(); });
reviewsEl.addEventListener('change', function () { syncReviewView(); save(); });
reviewCountEl.addEventListener('change', function () { save(); });

document.getElementById('clear').addEventListener('click', function () {
  var openai = (providerEl.value === 'openai');
  var storageKey = openai ? 'openaiKey' : 'geminiKey';
  chrome.storage.local.remove([storageKey], function () {
    (openai ? okeyEl : keyEl).value = '';
    setStatus(L('keyDeleted'));
    setTimeout(function () { setStatus(''); }, 2500);
  });
});

document.getElementById('toggleKey').addEventListener('click', function () {
  var masked = keyEl.classList.toggle('masked');
  this.textContent = masked ? L('show') : L('hide');
});
document.getElementById('toggleOkey').addEventListener('click', function () {
  var masked = okeyEl.classList.toggle('masked');
  this.textContent = masked ? L('show') : L('hide');
});

document.getElementById('test').addEventListener('click', function () {
  var openai = (providerEl.value === 'openai');
  var activeKey = openai ? okeyEl.value.trim() : keyEl.value.trim();
  if (!activeKey) { setStatus(L('needKey', openai ? 'OpenAI' : 'Gemini')); return; }
  setStatus(L('testing'));
  save(function () {
    var lang = resolveLang(uilangEl.value);
    var testPrompt = (lang === 'en')
      ? 'Reply with exactly "Connection OK" and nothing else.'
      : '「接続OK」とだけ、他の語を付けずに返答してください。';
    chrome.runtime.sendMessage({ type: 'GMRS_AI', prompt: testPrompt, auto: false }, function (resp) {
      if (chrome.runtime.lastError) { setStatus(L('errPrefix') + chrome.runtime.lastError.message); return; }
      if (resp && resp.ok) setStatus(L('okPrefix') + (optJa() ? '（' : ' (') + (resp.model || '') + (optJa() ? '）: ' : '): ') + resp.text.slice(0, 40));
      else setStatus(L('failPrefix') + (resp ? (resp.error === 'NO_KEY' ? L('noKeySet') : resp.error) : L('noResp')));
    });
  });
});
