(function () {
  'use strict';

  const CONFIG = window.PE_CONFIG || {};
  const DEFAULT_TTL = {
    health: 60 * 1000,
    getReferenceData: 30 * 60 * 1000,
    getMedicationIndex: 6 * 60 * 60 * 1000,
    getVisualization: 5 * 60 * 1000
  };

  function normalizeBaseUrl(url) {
    return String(url || '').trim();
  }

  function getApiUrl() {
    const configUrl = normalizeBaseUrl(CONFIG.API_URL);
    if (CONFIG.LOCK_API_URL) return configUrl;
    return normalizeBaseUrl(localStorage.getItem('PE_API_URL') || configUrl);
  }

  function setApiUrl(url) {
    if (CONFIG.LOCK_API_URL) return false;
    localStorage.setItem('PE_API_URL', normalizeBaseUrl(url));
    clearApiCache();
    return true;
  }

  function cacheKey(action, payload) {
    return 'pe-api-cache:' + (CONFIG.VERSION || '') + ':' + action + ':' + stableJson(payload || {});
  }

  function stableJson(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
    return '{' + Object.keys(value).sort().map(function (k) {
      return JSON.stringify(k) + ':' + stableJson(value[k]);
    }).join(',') + '}';
  }

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.expires || Date.now() > obj.expires) {
        sessionStorage.removeItem(key);
        return null;
      }
      return obj.value;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, value, ttl) {
    if (!ttl || ttl <= 0) return;
    try {
      sessionStorage.setItem(key, JSON.stringify({ expires: Date.now() + ttl, value: value }));
    } catch (_) {
      // Ignore storage quota errors.
    }
  }

  function clearApiCache() {
    try {
      Object.keys(sessionStorage).forEach(function (k) {
        if (k.indexOf('pe-api-cache:') === 0) sessionStorage.removeItem(k);
      });
    } catch (_) {}
  }

  function jsonp(url, timeoutMs) {
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve, reject) {
      const callbackName = '__peJsonp_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      let done = false;
      let timer;

      function cleanup() {
        if (timer) window.clearTimeout(timer);
        try { delete window[callbackName]; } catch (_) { window[callbackName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }

      window[callbackName] = function (payload) {
        if (done) return;
        done = true;
        cleanup();
        resolve(payload);
      };

      script.onerror = function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('API Connection Failed'));
      };

      timer = window.setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('API timeout'));
      }, timeoutMs);

      script.src = url + (url.indexOf('?') === -1 ? '?' : '&') + 'callback=' + encodeURIComponent(callbackName) + '&_=' + Date.now();
      document.head.appendChild(script);
    });
  }

  async function apiRequest(action, payload, options) {
    options = options || {};
    payload = payload || {};
    const apiUrl = getApiUrl();
    if (!apiUrl || apiUrl.indexOf('YOUR_DEPLOYMENT_ID') !== -1) {
      throw new Error('ยังไม่ได้ตั้งค่า API URL ใน assets/js/config.js');
    }

    const ttlMap = Object.assign({}, DEFAULT_TTL, CONFIG.CACHE_TTL || {});
    const ttl = options.ttl !== undefined ? options.ttl : (ttlMap[action] || 0);
    const key = cacheKey(action, payload);
    if (!options.noCache && ttl > 0) {
      const cached = readCache(key);
      if (cached) return cached;
    }

    const qs = new URLSearchParams();
    qs.set('action', action);
    if (payload && Object.keys(payload).length) qs.set('payload', JSON.stringify(payload));
    qs.set('clientVersion', CONFIG.VERSION || '');

    const url = apiUrl + (apiUrl.indexOf('?') === -1 ? '?' : '&') + qs.toString();
    const envelope = await jsonp(url, options.timeoutMs || 30000);
    if (!envelope || envelope.success !== true) {
      throw new Error((envelope && (envelope.message || envelope.error)) || 'API error');
    }
    writeCache(key, envelope.data, ttl);
    return envelope.data;
  }

  window.PE_API = {
    getApiUrl: getApiUrl,
    setApiUrl: setApiUrl,
    clearApiCache: clearApiCache,
    request: apiRequest
  };
})();
