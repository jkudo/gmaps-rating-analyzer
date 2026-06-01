'use strict';

// Defaults per provider.
var DEFAULT_GEMINI = 'gemini-3.5-flash';
var DEFAULT_OPENAI = 'gpt-5.4-mini';
var OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Exponential backoff (equal jitter) for transient 503/429/500 errors.
// attempts: tries per model (1 initial + 2 retries). baseMs/factor/capMs shape the wait.
var RETRY = { attempts: 3, baseMs: 1000, factor: 2, capMs: 8000 };

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'GMRS_OPEN_OPTIONS') {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
    return; // synchronous
  }

  if (msg.type === 'GMRS_AI') {
    handleAI(msg.prompt, msg.auto)
      .then(function (r) { sendResponse(r); })
      .catch(function (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); });
    return true; // async response
  }
});

// Left-click on the toolbar icon opens the options page.
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(function () {
    if (chrome.runtime.openOptionsPage) chrome.runtime.openOptionsPage();
  });
}

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

// Server-side capacity / rate problems that are worth retrying or switching models for.
function isTransient(status, msg) {
  if (status === 503 || status === 429 || status === 500) return true;
  var m = (msg || '').toLowerCase();
  return m.indexOf('overloaded') >= 0 || m.indexOf('high demand') >= 0 ||
         m.indexOf('unavailable') >= 0 || m.indexOf('try again') >= 0 ||
         m.indexOf('rate limit') >= 0 || m.indexOf('resource_exhausted') >= 0;
}

// Retry hint in ms: HTTP Retry-After header, else Gemini RetryInfo detail, else "try again in Xs" text.
function retryHintMs(res, ej) {
  try {
    var h = res && res.headers && res.headers.get && res.headers.get('retry-after');
    if (h) { var hn = parseFloat(h); if (!isNaN(hn)) return Math.round(hn * 1000); }
  } catch (e) { /* ignore */ }
  try {
    var det = ej && ej.error && ej.error.details;
    if (det) for (var i = 0; i < det.length; i++) {
      var d = det[i];
      if (d && String(d['@type'] || '').indexOf('RetryInfo') >= 0 && d.retryDelay) {
        var m = String(d.retryDelay).match(/([\d.]+)/);
        if (m) return Math.round(parseFloat(m[1]) * 1000);
      }
    }
  } catch (e2) { /* ignore */ }
  try {
    var em = ej && ej.error && ej.error.message;
    if (em) { var mm = String(em).match(/try again in\s+([\d.]+)\s*s/i); if (mm) return Math.round(parseFloat(mm[1]) * 1000); }
  } catch (e3) { /* ignore */ }
  return 0;
}

function errResult(res, ej) {
  return { ok: false, status: res.status, error: (ej && ej.error && ej.error.message) || ('HTTP ' + res.status), retryDelay: retryHintMs(res, ej) };
}

// ---------- Gemini ----------
function geminiUrl(model, key) {
  return 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key);
}
function geminiCall(url, contents, genConfig) {
  return fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: contents, generationConfig: genConfig })
  }).then(function (res) {
    if (!res.ok) {
      return res.json().then(function (ej) { return errResult(res, ej); })
        .catch(function () { return { ok: false, status: res.status, error: 'HTTP ' + res.status, retryDelay: retryHintMs(res, null) }; });
    }
    return res.json().then(function (data) {
      var cand = data.candidates && data.candidates[0];
      var text = '';
      try { var parts = cand && cand.content && cand.content.parts; if (parts) text = parts.map(function (p) { return p.text || ''; }).join('').trim(); } catch (e) { /* ignore */ }
      return { ok: true, status: 200, text: text, finishReason: (cand && cand.finishReason) || '' };
    });
  }).catch(function () { return { ok: false, status: 0, error: '通信に失敗しました（ネットワークまたは権限）。', retryDelay: 0 }; });
}
// Cap thinking first; if rejected (400) or empty, retry once without thinkingConfig and a larger budget.
function genGemini(model, key, prompt) {
  var url = geminiUrl(model, key);
  var contents = [{ parts: [{ text: prompt }] }];
  var thinking = /gemini-3/.test(model) ? { thinkingLevel: 'low' } : { thinkingBudget: 0 };
  var cfgA = { temperature: 0.4, maxOutputTokens: 2048, thinkingConfig: thinking };
  return geminiCall(url, contents, cfgA).then(function (r1) {
    if (r1.ok && r1.text) return { ok: true, text: r1.text };
    var fixable = (!r1.ok && r1.status === 400) || (r1.ok && !r1.text);
    if (!fixable) return { ok: false, status: r1.status, error: r1.error, transient: isTransient(r1.status, r1.error), retryDelay: r1.retryDelay };
    return geminiCall(url, contents, { temperature: 0.4, maxOutputTokens: 8192 }).then(function (r2) {
      if (r2.ok && r2.text) return { ok: true, text: r2.text };
      if (!r2.ok) return { ok: false, status: r2.status, error: r2.error, transient: isTransient(r2.status, r2.error), retryDelay: r2.retryDelay };
      if (r2.finishReason === 'MAX_TOKENS') return { ok: false, error: '出力が長すぎて生成しきれませんでした（MAX_TOKENS）。', transient: false };
      return { ok: false, error: '空の応答' + (r2.finishReason ? '（' + r2.finishReason + '）' : '') + '。', transient: false };
    });
  });
}

// ---------- OpenAI ----------
function openaiCall(key, bodyObj) {
  return fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify(bodyObj)
  }).then(function (res) {
    if (!res.ok) {
      return res.json().then(function (ej) { return errResult(res, ej); })
        .catch(function () { return { ok: false, status: res.status, error: 'HTTP ' + res.status, retryDelay: retryHintMs(res, null) }; });
    }
    return res.json().then(function (data) {
      var ch = data.choices && data.choices[0];
      var text = (ch && ch.message && ch.message.content) ? String(ch.message.content).trim() : '';
      return { ok: true, status: 200, text: text, finishReason: (ch && ch.finish_reason) || '' };
    });
  }).catch(function () { return { ok: false, status: 0, error: '通信に失敗しました（ネットワークまたは権限）。', retryDelay: 0 }; });
}
// GPT-5.x are reasoning models: internal reasoning consumes output tokens, so keep budgets generous
// and, if a model rejects temperature (400) or returns empty, retry minimal with a larger budget.
function genOpenAI(model, key, prompt) {
  var msgs = [{ role: 'user', content: prompt }];
  return openaiCall(key, { model: model, messages: msgs, max_completion_tokens: 3072, temperature: 0.4 }).then(function (r1) {
    if (r1.ok && r1.text) return { ok: true, text: r1.text };
    var fixable = (!r1.ok && r1.status === 400) || (r1.ok && !r1.text);
    if (!fixable) return { ok: false, status: r1.status, error: r1.error, transient: isTransient(r1.status, r1.error), retryDelay: r1.retryDelay };
    return openaiCall(key, { model: model, messages: msgs, max_completion_tokens: 8192 }).then(function (r2) {
      if (r2.ok && r2.text) return { ok: true, text: r2.text };
      if (!r2.ok) return { ok: false, status: r2.status, error: r2.error, transient: isTransient(r2.status, r2.error), retryDelay: r2.retryDelay };
      if (r2.finishReason === 'length') return { ok: false, error: '出力が長すぎて生成しきれませんでした（length）。', transient: false };
      return { ok: false, error: '空の応答' + (r2.finishReason ? '（' + r2.finishReason + '）' : '') + '。', transient: false };
    });
  });
}

function genForModel(provider, model, key, prompt) {
  return provider === 'openai' ? genOpenAI(model, key, prompt) : genGemini(model, key, prompt);
}

// Equal-jitter exponential backoff: wait in [exp/2, exp], exp = base*factor^(n-1) capped.
function backoffMs(attempt, serverRetryMs) {
  var exp = Math.min(RETRY.capMs, RETRY.baseMs * Math.pow(RETRY.factor, attempt - 1));
  var wait = exp / 2 + Math.random() * (exp / 2);
  if (serverRetryMs && serverRetryMs > wait) wait = serverRetryMs;
  return Math.min(RETRY.capMs, Math.round(wait));
}
function withRetry(provider, model, key, prompt) {
  function go(attempt) {
    return genForModel(provider, model, key, prompt).then(function (r) {
      if (r.ok) return r;
      if (!r.transient || attempt >= RETRY.attempts) return r;
      if (r.retryDelay && r.retryDelay > RETRY.capMs) return r; // too long to wait -> caller falls back
      return sleep(backoffMs(attempt, r.retryDelay)).then(function () { return go(attempt + 1); });
    });
  }
  return go(1);
}
// Try the chosen model, then any fallback models if the first stays overloaded.
function tryModels(provider, models, idx, key, prompt, lastErr) {
  if (idx >= models.length) return Promise.resolve(lastErr || { ok: false, error: 'AI生成に失敗しました。' });
  var model = models[idx];
  return withRetry(provider, model, key, prompt).then(function (r) {
    if (r.ok) return { ok: true, text: r.text, model: model, provider: provider };
    var code = r.status ? ('[' + r.status + '] ') : '';
    var err = { ok: false, status: r.status || 0, retryDelay: r.retryDelay || 0, error: code + (r.error || 'AI生成に失敗しました。') };
    if (r.transient) return tryModels(provider, models, idx + 1, key, prompt, err);
    return err;
  });
}

function handleAI(prompt, auto) {
  return chrome.storage.local.get(['provider', 'geminiKey', 'geminiModel', 'openaiKey', 'openaiModel', 'autoAI']).then(function (cfg) {
    var provider = (cfg.provider === 'openai') ? 'openai' : 'gemini';
    var autoOn = (cfg.autoAI !== false);
    if (auto && !autoOn) return { ok: false, error: 'AUTO_OFF' };

    if (provider === 'openai') {
      var okey = (cfg.openaiKey || '').trim();
      if (!okey) return { ok: false, error: 'NO_KEY' };
      var omodel = (cfg.openaiModel || DEFAULT_OPENAI).trim() || DEFAULT_OPENAI;
      return tryModels('openai', [omodel], 0, okey, prompt);
    }
    var key = (cfg.geminiKey || '').trim();
    if (!key) return { ok: false, error: 'NO_KEY' };
    var model = (cfg.geminiModel || DEFAULT_GEMINI).trim() || DEFAULT_GEMINI;
    var fallback = /gemini-3/.test(model) ? 'gemini-2.5-flash' : 'gemini-2.5-flash-lite';
    var models = (fallback === model) ? [model] : [model, fallback];
    return tryModels('gemini', models, 0, key, prompt);
  });
}
