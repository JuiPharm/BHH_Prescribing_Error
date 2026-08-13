/* BHH Prescribing Error Frontend
 * Production build: 2026-08-12
 *
 * Backend: Google Apps Script + Google Sheets
 * GET: JSONP by default
 * POST: text/plain fetch with explicit response validation (no no-cors fallback)
 */
(function () {
  'use strict';

  const CONFIG = Object.assign({
    API_URL: 'https://script.google.com/macros/s/AKfycbyIy7tJrZEAeesfARaBVgPaPCt4WXqcLRCIPOJ2_zPWxWCxWZO0pjYrJeCF6m-DEdjF/exec',
    API_MODE: 'jsonp',
    LOCK_API_URL: true,
    VERSION: 'production-2026-08-12'
  }, window.PE_CONFIG || {});

  const API_URL_STORAGE_KEY = 'pe_api_url';
  const API_CACHE_TTL = {
    getReferenceData: 10 * 60 * 1000,
    getVisualization: 90 * 1000,
    getMedicationIndex: 30 * 60 * 1000
  };
  const JSONP_TIMEOUT_MS = 15000;
  const POST_TIMEOUT_MS = 20000;
  const HN_PATTERN = /^07-\d{2}-\d{6}$/;
  const STAFF_ID_PATTERN = /^[A-Za-z0-9]{6}$/;

  const state = {
    ref: { departments: [], doctors: [], staff: [], lists: {} },
    selectedDoctor: null,
    selectedReporter: null,
    selectedDrug1: null,
    selectedDrug2: null,
    medIndex: null,
    admin: { ok: false, staffId: '', name: '', role: 'Not verified' },
    manage: { doctors: [], staff: [], departments: [], medications: [] },
    vizRows: [],
    charts: {},
    pendingSubmission: null
  };

  let medIndexPromise = null;

  class ApiApplicationError extends Error {
    constructor(message) {
      super(message || 'API error');
      this.name = 'ApiApplicationError';
      this.isApplicationError = true;
    }
  }

  class ApiTransportError extends Error {
    constructor(message, cause) {
      super(message || 'ไม่สามารถยืนยันการตอบกลับจาก API');
      this.name = 'ApiTransportError';
      this.isTransportError = true;
      this.cause = cause || null;
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function text(id, value) {
    const el = $(id);
    if (el) el.textContent = String(value ?? '');
  }

  function normalize(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function normalizeSearch(value) {
    return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function fmtDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? '-'
      : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function clearElement(el) {
    if (el) el.replaceChildren();
  }

  function createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.text !== undefined) el.textContent = String(options.text);
    if (options.type) el.type = options.type;
    if (options.title) el.title = options.title;
    return el;
  }

  function appendText(parent, value) {
    parent.appendChild(document.createTextNode(String(value ?? '')));
  }

  function toast(message, type = 'info') {
    const host = $('toastHost');
    if (!host) return;

    const tone = type === 'error' ? 'danger' : type;
    const safeTone = ['success', 'danger', 'warning', 'info', 'secondary'].includes(tone)
      ? tone
      : 'secondary';

    const el = createElement('div', { className: 'toast align-items-center show' });
    const row = createElement('div', { className: 'd-flex' });
    const body = createElement('div', { className: 'toast-body' });
    const badge = createElement('span', {
      className: `badge text-bg-${safeTone} me-2`,
      text: String(type || 'info').toUpperCase()
    });
    const close = createElement('button', { className: 'btn-close me-2 m-auto', type: 'button' });

    body.appendChild(badge);
    appendText(body, message);
    row.append(body, close);
    el.appendChild(row);
    host.appendChild(el);

    close.addEventListener('click', () => el.remove());
    window.setTimeout(() => {
      if (el.isConnected) el.remove();
    }, 5000);
  }

  async function runSafely(fn, context = 'operation') {
    try {
      return await fn();
    } catch (err) {
      console.error(`[${context}]`, err);
      toast(err?.message || 'เกิดข้อผิดพลาด', 'error');
      return undefined;
    }
  }

  function normalizeApiUrl(value) {
    const v = String(value || '').trim();
    return v ? v.replace(/\/+$/, '') : '';
  }

  function getApiUrl() {
    const defaultUrl = normalizeApiUrl(CONFIG.API_URL);

    // Production lock is evaluated before all runtime overrides.
    if (CONFIG.LOCK_API_URL) return defaultUrl;

    const queryUrl = new URLSearchParams(window.location.search).get('api');
    if (queryUrl) return normalizeApiUrl(queryUrl);

    return normalizeApiUrl(localStorage.getItem(API_URL_STORAGE_KEY)) || defaultUrl;
  }

  function setApiUrl(value) {
    if (CONFIG.LOCK_API_URL) {
      localStorage.removeItem(API_URL_STORAGE_KEY);
    } else {
      const normalized = normalizeApiUrl(value);
      if (normalized) localStorage.setItem(API_URL_STORAGE_KEY, normalized);
      else localStorage.removeItem(API_URL_STORAGE_KEY);
    }
    renderApiUrl();
  }

  function renderApiUrl() {
    const url = getApiUrl();
    if (!url) setApiStatus('Not configured', 'danger');
  }

  function setApiStatus(label, tone = 'secondary') {
    const el = $('apiStatusText');
    if (!el) return;
    el.textContent = label;
    el.classList.remove('text-success', 'text-danger', 'text-warning', 'text-secondary');
    const safeTone = ['success', 'danger', 'warning', 'secondary'].includes(tone) ? tone : 'secondary';
    el.classList.add(`text-${safeTone}`);
  }

  function cacheKey(action, params) {
    return `pe_api_cache:${CONFIG.VERSION}:${action}:${JSON.stringify(params || {})}`;
  }

  function getCache(action, params) {
    const ttl = API_CACHE_TTL[action];
    if (!ttl) return null;
    try {
      const raw = sessionStorage.getItem(cacheKey(action, params));
      if (!raw) return null;
      const hit = JSON.parse(raw);
      if (!hit || Date.now() - hit.ts > ttl) return null;
      return hit.data;
    } catch (_) {
      return null;
    }
  }

  function setCache(action, params, data) {
    if (!API_CACHE_TTL[action]) return;
    try {
      sessionStorage.setItem(cacheKey(action, params), JSON.stringify({ ts: Date.now(), data }));
    } catch (_) {}
  }

  function clearApiCache(action) {
    try {
      Object.keys(sessionStorage)
        .filter((key) => key.startsWith('pe_api_cache:') && (!action || key.includes(`:${action}:`)))
        .forEach((key) => sessionStorage.removeItem(key));
    } catch (_) {}
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = window.setTimeout(() => {
      if (controller) controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, Object.assign({}, options || {}, controller ? { signal: controller.signal } : {}));
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function parseJsonApiResponse(response) {
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch (err) {
      throw new ApiTransportError('อ่าน response จาก API ไม่สำเร็จ', err);
    }

    let json;
    try {
      json = JSON.parse(bodyText);
    } catch (err) {
      throw new ApiTransportError('API ตอบกลับมาในรูปแบบที่ไม่สามารถยืนยันผลได้', err);
    }

    if (!json || json.success !== true) {
      throw new ApiApplicationError(json?.message || json?.error || 'API error');
    }
    return json.data;
  }

  async function apiGet(action, params = {}, { useCache = true } = {}) {
    const cached = useCache ? getCache(action, params) : null;
    if (cached !== null && cached !== undefined) return cached;

    const base = getApiUrl();
    if (!base) throw new Error('ยังไม่ได้ตั้งค่า API URL');

    const url = new URL(base);
    url.searchParams.set('action', action);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });

    let data;

    if (CONFIG.API_MODE === 'fetch') {
      let response;
      try {
        response = await fetchWithTimeout(url.toString(), { method: 'GET', redirect: 'follow' }, JSONP_TIMEOUT_MS);
      } catch (err) {
        throw new ApiTransportError('เชื่อมต่อ API ไม่สำเร็จ', err);
      }
      data = await parseJsonApiResponse(response);
    } else {
      data = await new Promise((resolve, reject) => {
        const cbName = `__pe_cb_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
        let done = false;
        let script = null;
        let timer = null;

        function cleanup() {
          if (done) return;
          done = true;
          if (timer) window.clearTimeout(timer);
          try {
            delete window[cbName];
          } catch (_) {
            window[cbName] = undefined;
          }
          if (script?.parentNode) script.parentNode.removeChild(script);
        }

        window[cbName] = (payload) => {
          cleanup();
          if (!payload || payload.success !== true) {
            reject(new ApiApplicationError(payload?.message || 'API error'));
            return;
          }
          resolve(payload.data);
        };

        url.searchParams.set('callback', cbName);
        url.searchParams.set('_', String(Date.now()));

        script = document.createElement('script');
        script.src = url.toString();
        script.async = true;
        script.onerror = () => {
          cleanup();
          reject(new ApiTransportError('เชื่อมต่อ API ไม่สำเร็จ'));
        };

        timer = window.setTimeout(() => {
          cleanup();
          reject(new ApiTransportError(`API timeout หลัง ${Math.round(JSONP_TIMEOUT_MS / 1000)} วินาที`));
        }, JSONP_TIMEOUT_MS);

        document.head.appendChild(script);
      });
    }

    setCache(action, params, data);
    return data;
  }

  async function apiPost(action, data = {}) {
    const base = getApiUrl();
    if (!base) throw new Error('ยังไม่ได้ตั้งค่า API URL');

    const payload = JSON.stringify({ action, data });
    const options = CONFIG.API_MODE === 'fetch'
      ? {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }
      : {
          method: 'POST',
          redirect: 'follow',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: payload
        };

    let response;
    try {
      response = await fetchWithTimeout(base, options, POST_TIMEOUT_MS);
    } catch (err) {
      throw new ApiTransportError(
        'ส่งคำขอไป API แล้ว แต่ browser ไม่สามารถยืนยัน response ได้',
        err
      );
    }

    const result = await parseJsonApiResponse(response);
    clearApiCache();
    return result;
  }

  function generateRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }

    const randomPart = () => Math.random().toString(36).slice(2, 12);
    return `pe_${Date.now().toString(36)}_${randomPart()}_${randomPart()}`;
  }

  function stableSubmissionKey(payload) {
    const fields = [
      'prescribingErrorFrom', 'hn', 'eventDate', 'eventTime', 'department', 'doctor',
      'specialty', 'doctorType', 'errorDetails', 'consult', 'errorType',
      'medicationReconciliation', 'reporter', 'drug1', 'drug2', 'drugGroup',
      'subclass', 'severityLevel'
    ];
    return JSON.stringify(fields.map((key) => String(payload?.[key] ?? '').trim()));
  }

  function attachRequestId(payload) {
    const key = stableSubmissionKey(payload);
    if (state.pendingSubmission && state.pendingSubmission.payloadKey === key) {
      return Object.assign({}, payload, { requestId: state.pendingSubmission.requestId });
    }

    const requestId = generateRequestId();
    state.pendingSubmission = { payloadKey: key, requestId };
    return Object.assign({}, payload, { requestId });
  }

  function clearPendingSubmission() {
    state.pendingSubmission = null;
  }

  async function wait(ms) {
    await new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function reconcileSubmission(requestId) {
    const delays = [0, 700, 1500, 2500];
    for (const delay of delays) {
      if (delay) await wait(delay);
      try {
        const status = await apiGet('getSubmissionStatus', { requestId }, { useCache: false });
        if (status?.found && status?.status === 'saved') {
          return status;
        }
      } catch (err) {
        if (err?.isApplicationError) throw err;
      }
    }
    return null;
  }

  async function submitReportReliable(payload) {
    try {
      return await apiPost('submitReport', payload);
    } catch (err) {
      if (!err?.isTransportError) throw err;

      const status = await reconcileSubmission(payload.requestId);
      if (status) {
        clearApiCache();
        return Object.assign({}, status, { reconciled: true });
      }

      throw new ApiTransportError(
        'ไม่สามารถยืนยันผลการบันทึกได้ ระบบยังเก็บข้อมูลในฟอร์มไว้ กรุณากดบันทึกซ้ำได้โดยระบบจะใช้ RequestID เดิมและป้องกันรายการซ้ำ',
        err
      );
    }
  }

  async function runAdminMutation(action, data) {
    try {
      return await apiPost(action, data);
    } catch (err) {
      if (err?.isTransportError) {
        clearApiCache();
        await loadReferenceData(true).catch(() => undefined);
        if (action === 'uploadMedications') {
          await prefetchMedicationIndex(true).catch(() => undefined);
        }
        if (state.admin.ok) await loadManageData().catch(() => undefined);
        throw new ApiTransportError(
          'ไม่สามารถยืนยัน response ของรายการจัดการข้อมูลได้ ระบบรีโหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสอบผลก่อนทำรายการซ้ำ',
          err
        );
      }
      throw err;
    }
  }

  function renderOptions(selectEl, items, opts = {}) {
    if (!selectEl) return;
    const { placeholder = '-', valueKey = null, labelKey = null } = opts;
    const fragment = document.createDocumentFragment();

    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = placeholder;
    fragment.appendChild(ph);

    (items || []).forEach((item) => {
      const opt = document.createElement('option');
      opt.value = valueKey ? String(item?.[valueKey] ?? '') : String(item ?? '');
      opt.textContent = labelKey ? String(item?.[labelKey] ?? '') : String(item ?? '');
      fragment.appendChild(opt);
    });

    selectEl.replaceChildren(fragment);
  }

  function uniqueSorted(values) {
    return Array.from(
      new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, 'th'));
  }

  function staffIdOf(staff) {
    return String(staff?.staffId ?? staff?.StaffID ?? staff?.staff_id ?? staff?.id ?? '').trim();
  }

  function staffNameOf(staff) {
    return String(staff?.name ?? staff?.Name ?? staff?.staffName ?? staff?.staff_name ?? '').trim();
  }

  function staffRoleOf(staff) {
    return String(staff?.role ?? staff?.Role ?? 'User').trim() || 'User';
  }

  function normalizeStaffList(list) {
    return (Array.isArray(list) ? list : [])
      .map((staff) => ({
        staffId: staffIdOf(staff),
        name: staffNameOf(staff),
        role: staffRoleOf(staff)
      }))
      .filter((staff) => staff.staffId && staff.name);
  }

  function renderReferenceData(ref) {
    state.ref = ref || { departments: [], doctors: [], staff: [], lists: {} };
    state.ref.staff = normalizeStaffList(state.ref.staff);
    const lists = state.ref.lists || {};

    const errorTypesSorted = (lists.errorTypes || []).slice().sort((a, b) => {
      const aLow = String(a).toLowerCase();
      const bLow = String(b).toLowerCase();
      const aIsOther = aLow.includes('other') || aLow.includes('อื่น');
      const bIsOther = bLow.includes('other') || bLow.includes('อื่น');
      if (aIsOther && !bIsOther) return 1;
      if (!aIsOther && bIsOther) return -1;
      return a.localeCompare(b, 'th');
    });

    renderOptions($('prescribingErrorFrom'), lists.prescribingErrorFrom || [], { placeholder: 'เลือก…' });
    renderOptions($('consult'), lists.consultResults || [], { placeholder: 'เลือก…' });
    renderOptions($('errorType'), errorTypesSorted, { placeholder: 'เลือก…' });

    const processList = uniqueSorted([
      ...(lists.medicationReconciliation || []),
      'Med Rec Transfer',
      'None of Above'
    ]);
    renderOptions($('medicationReconciliation'), processList, { placeholder: 'เลือก…' });
    renderOptions($('drugGroup'), lists.drugGroups || [], { placeholder: 'เลือก…' });
    renderOptions($('subclass'), lists.subclasses || [], { placeholder: 'เลือก…' });
    renderOptions($('severityLevel'), lists.severityLevels || [], { placeholder: 'เลือก…' });
    renderOptions($('department'), state.ref.departments || [], { placeholder: 'เลือกแผนก…' });
    renderOptions($('doctorDept'), state.ref.departments || [], { placeholder: '-' });

    state.selectedReporter = null;
    const reporterInput = $('reporter');
    if (reporterInput && reporterInput.tagName !== 'SELECT') reporterInput.value = '';

    renderVizList('vizDept', 'All departments', state.ref.departments || []);
    renderVizList('vizSource', 'All sources', lists.prescribingErrorFrom || []);
    renderVizList('vizSeverity', 'All severity', lists.severityLevels || []);
    renderVizList('vizProcess', 'All process', processList);
    renderVizList('vizDrugGroup', 'All drug groups', lists.drugGroups || []);
    renderVizList('vizSubclass', 'All subclasses', lists.subclasses || []);
    renderVizList('vizGeneric', 'All generics', lists.generics || []);
    renderVizList('vizConsult', 'All consult results', lists.consultResults || []);
    renderVizList('vizErrorType', 'All error types', errorTypesSorted);
    renderVizList(
      'vizSpecialty',
      'All specialties',
      uniqueSorted((state.ref.doctors || []).map((doctor) => doctor.specialty))
    );
    renderVizList(
      'vizDoctor',
      'All doctors',
      uniqueSorted((state.ref.doctors || []).map((doctor) => doctor.name))
    );
    renderVizList(
      'vizDoctorType',
      'All doctor types',
      uniqueSorted((state.ref.doctors || []).map((doctor) => doctor.type))
    );
  }

  function renderVizList(id, labelAll, items) {
    renderOptions($(id), items || [], { placeholder: labelAll });
  }

  async function loadReferenceData(force = false) {
    text('lastSyncText', 'Loading…');
    setApiStatus('Connecting…', 'secondary');
    const ref = await apiGet('getReferenceData', {}, { useCache: !force });
    renderReferenceData(ref);
    text('lastSyncText', fmtDateTime(new Date()));
    setApiStatus('Connected', 'success');
  }

  function getReportPayload() {
    return {
      prescribingErrorFrom: $('prescribingErrorFrom')?.value.trim() || '',
      hn: $('hn')?.value.trim() || '',
      eventDate: $('eventDate')?.value || '',
      eventTime: $('eventTime')?.value || '',
      department: $('department')?.value.trim() || '',
      doctor: state.selectedDoctor?.name || $('doctorSearch')?.value.trim() || '',
      specialty: $('specialty')?.value.trim() || '',
      doctorType: $('doctorType')?.value.trim() || '',
      errorDetails: $('errorDetails')?.value.trim() || '',
      consult: $('consult')?.value.trim() || '',
      errorType: $('errorType')?.value.trim() || '',
      medicationReconciliation: $('medicationReconciliation')?.value.trim() || '',
      reporter: getReporterStaffId(),
      reporterInput: $('reporter')?.value.trim() || '',
      drug1: $('drug1')?.value.trim() || '',
      drug2: $('drug2')?.value.trim() || '',
      drugGroup: $('drugGroup')?.value.trim() || '',
      subclass: $('subclass')?.value.trim() || '',
      severityLevel: $('severityLevel')?.value.trim() || '',
      clientVersion: CONFIG.VERSION,
      userAgent: navigator.userAgent
    };
  }

  function validateReport(payload) {
    const required = [
      ['prescribingErrorFrom', 'Prescribing Error จาก'],
      ['hn', 'HN'],
      ['eventDate', 'วันที่เกิดเหตุการณ์'],
      ['eventTime', 'เวลา'],
      ['department', 'Department'],
      ['doctor', 'รายชื่อแพทย์'],
      ['errorDetails', 'รายละเอียด'],
      ['consult', 'Consult'],
      ['errorType', 'ประเภท'],
      ['medicationReconciliation', 'Process'],
      ['reporter', 'ผู้รายงาน'],
      ['drug1', 'ยา 1'],
      ['drugGroup', 'กลุ่มยา'],
      ['severityLevel', 'Severity']
    ];

    const missing = required
      .filter(([key]) => !String(payload?.[key] || '').trim())
      .map(([, label]) => label);

    if (payload?.reporterInput && !payload?.reporter) {
      return 'กรุณาเลือกผู้รายงานจากรายการ Staff ที่ระบบแสดงขึ้นมา';
    }
    if (missing.length) return `กรอกข้อมูลไม่ครบ: ${missing.join(', ')}`;
    if (!HN_PATTERN.test(payload.hn)) return 'HN ไม่ถูกต้อง ต้องเป็นรูปแบบ 07-XX-XXXXXX เท่านั้น';
    if (!STAFF_ID_PATTERN.test(payload.reporter)) return 'StaffID ผู้รายงานไม่ถูกต้อง';
    return '';
  }

  function resetReportForm() {
    $('reportForm')?.reset();
    [
      'prescribingErrorFrom', 'hn', 'eventDate', 'eventTime', 'department',
      'doctorSearch', 'specialty', 'doctorType', 'errorDetails', 'consult',
      'errorType', 'medicationReconciliation', 'reporter', 'drug1', 'drug2',
      'drugGroup', 'subclass', 'severityLevel'
    ].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });

    ['doctorSuggest', 'reporterSuggest', 'drug1Suggest', 'drug2Suggest'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.style.display = 'none';
        clearElement(el);
      }
    });

    state.selectedDoctor = null;
    state.selectedReporter = null;
    state.selectedDrug1 = null;
    state.selectedDrug2 = null;
    clearPendingSubmission();
    $('prescribingErrorFrom')?.focus();
  }

  function doctorQuery(query) {
    const key = normalize(query);
    if (!key) return [];
    const dept = normalize($('department')?.value);
    const doctors = state.ref.doctors || [];
    let list = dept ? doctors.filter((doctor) => normalize(doctor.department) === dept) : doctors;
    if (dept && !list.length) list = doctors;
    return list
      .filter((doctor) =>
        normalize(`${doctor.name} ${doctor.department} ${doctor.specialty} ${doctor.type}`).includes(key)
      )
      .slice(0, 12);
  }

  function appendHighlightedText(parent, rawText, rawQuery) {
    const value = String(rawText || '');
    const query = String(rawQuery || '').trim();
    if (!query) {
      appendText(parent, value);
      return;
    }

    const lower = value.toLocaleLowerCase('th');
    const qLower = query.toLocaleLowerCase('th');
    let start = 0;
    let index = lower.indexOf(qLower);

    while (index >= 0) {
      if (index > start) appendText(parent, value.slice(start, index));
      const mark = document.createElement('mark');
      mark.textContent = value.slice(index, index + query.length);
      parent.appendChild(mark);
      start = index + query.length;
      index = lower.indexOf(qLower, start);
    }

    if (start < value.length) appendText(parent, value.slice(start));
  }

  function showSuggest(boxId, items, renderItem, onSelect) {
    const box = $(boxId);
    if (!box) return;
    clearElement(box);

    if (!items?.length) {
      box.style.display = 'none';
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const div = createElement('div', { className: 'item' });
      const content = renderItem(item);
      if (content instanceof Node) div.appendChild(content);
      else div.textContent = String(content ?? '');

      div.addEventListener('click', () => {
        onSelect(item);
        box.style.display = 'none';
      });
      fragment.appendChild(div);
    });

    box.appendChild(fragment);
    box.style.display = 'block';
  }

  function doctorSuggestionNode(doctor, query) {
    const wrapper = document.createDocumentFragment();
    const strong = document.createElement('strong');
    appendHighlightedText(strong, doctor.name || '', query);

    const meta = createElement('div', {
      className: 'small text-muted',
      text: [doctor.department || '-', doctor.specialty || '-', doctor.type || '-'].join(' • ')
    });
    wrapper.append(strong, meta);
    return wrapper;
  }

  function formatStaffLabel(staff) {
    if (!staff) return '';
    return [staffIdOf(staff), staffNameOf(staff)]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' - ');
  }

  function reporterQuery(query) {
    const key = normalize(query);
    if (!key) return [];
    return (state.ref.staff || [])
      .filter((staff) =>
        normalize(`${staffIdOf(staff)} ${staffNameOf(staff)} ${staffRoleOf(staff)}`).includes(key)
      )
      .slice(0, 12);
  }

  function reporterSuggestionNode(staff, query) {
    const wrapper = document.createDocumentFragment();
    const strong = document.createElement('strong');
    appendHighlightedText(strong, formatStaffLabel(staff), query);
    const meta = createElement('div', {
      className: 'small text-muted',
      text: `Role: ${staffRoleOf(staff)}`
    });
    wrapper.append(strong, meta);
    return wrapper;
  }

  function findReporterMatch(value) {
    const key = normalize(value);
    if (!key) return null;
    return (state.ref.staff || []).find((staff) =>
      normalize(staffIdOf(staff)) === key ||
      normalize(staffNameOf(staff)) === key ||
      normalize(formatStaffLabel(staff)) === key
    ) || null;
  }

  function setReporter(staff) {
    state.selectedReporter = staff || null;
    const input = $('reporter');
    if (input) input.value = staff ? formatStaffLabel(staff) : '';
  }

  function getReporterStaffId() {
    const input = $('reporter');
    const raw = input?.value.trim() || '';

    if (!raw) {
      state.selectedReporter = null;
      return '';
    }

    if (state.selectedReporter) {
      const candidates = [
        formatStaffLabel(state.selectedReporter),
        staffIdOf(state.selectedReporter),
        staffNameOf(state.selectedReporter)
      ];
      if (candidates.some((value) => normalize(value) === normalize(raw))) {
        return staffIdOf(state.selectedReporter) || '';
      }
    }

    const matched = findReporterMatch(raw);
    if (matched) {
      setReporter(matched);
      return staffIdOf(matched) || '';
    }
    return '';
  }

  function resetMedicationIndex() {
    state.medIndex = null;
    medIndexPromise = null;
    clearApiCache('getMedicationIndex');
  }

  async function prefetchMedicationIndex(force = false) {
    if (force) resetMedicationIndex();
    if (Array.isArray(state.medIndex)) return state.medIndex;
    if (medIndexPromise) return medIndexPromise;

    medIndexPromise = apiGet('getMedicationIndex', {}, { useCache: !force })
      .then((result) => {
        const rows = Array.isArray(result?.items) ? result.items : [];
        state.medIndex = rows
          .map(normalizeMedicationItem)
          .filter((item) => item.displayName || item.genericName || item.brandName);
        medIndexPromise = null;
        return state.medIndex;
      })
      .catch((err) => {
        state.medIndex = null;
        medIndexPromise = null;
        throw err;
      });

    return medIndexPromise;
  }

  function medicationValueOf(item, keys) {
    for (const key of keys) {
      const value = item?.[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
    return '';
  }

  function normalizeMedicationItem(item) {
    const genericName = medicationValueOf(item, ['genericName', 'GenericName', 'generic', 'Generic']);
    const brandName = medicationValueOf(item, ['brandName', 'BrandName', 'brand', 'Brand']);
    const form = medicationValueOf(item, ['form', 'Form', 'dosageForm', 'DosageForm']);
    const displayName = medicationValueOf(item, ['displayName', 'DisplayName', 'name', 'Name']) ||
      [genericName, brandName, form].filter(Boolean).join(' ');
    const drugGroup = medicationValueOf(item, ['drugGroup', 'DrugGroup', 'majorClass', 'MajorClass']);
    const subclass = medicationValueOf(item, ['subclass', 'Subclass', 'subClass', 'SubClass']);
    const search = normalizeSearch(
      [displayName, genericName, brandName, form, drugGroup, subclass].join(' ')
    );

    return Object.assign({}, item, {
      displayName,
      genericName,
      brandName,
      form,
      drugGroup,
      subclass,
      search
    });
  }

  function scoreMedication(item, key, terms) {
    const display = normalizeSearch(item.displayName);
    const generic = normalizeSearch(item.genericName);
    const brand = normalizeSearch(item.brandName);

    if (display === key || generic === key || brand === key) return 1200;
    if (display.startsWith(key)) return 1050;
    if (generic.startsWith(key)) return 1000;
    if (brand.startsWith(key)) return 960;
    if (display.includes(key)) return 850;
    if (generic.includes(key)) return 800;
    if (brand.includes(key)) return 760;
    if (item.search?.includes(key)) return 620;
    if (terms.length > 1 && terms.every((term) => item.search?.includes(term))) return 540;
    return 0;
  }

  function searchMedicationLocal(query) {
    const key = normalizeSearch(query);
    if (!key || !Array.isArray(state.medIndex)) return [];

    const terms = key.split(' ').filter(Boolean);
    return state.medIndex
      .map((item) => ({ item, score: scoreMedication(item, key, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) =>
        b.score - a.score ||
        String(a.item.displayName || '').localeCompare(String(b.item.displayName || ''), 'th')
      )
      .slice(0, 15)
      .map((entry) => entry.item);
  }

  function formatMedicationLabel(item) {
    const main = item?.displayName || item?.genericName || item?.brandName || '';
    const meta = [item?.genericName, item?.brandName, item?.form].filter(Boolean).join(' • ');
    return { main, meta };
  }

  function medicationSuggestionNode(item, query) {
    const wrapper = document.createDocumentFragment();
    const label = formatMedicationLabel(item);
    const strong = document.createElement('strong');
    appendHighlightedText(strong, label.main, query);

    const metaParts = [
      label.meta || '-',
      item.drugGroup || '-',
      item.subclass || '-'
    ];
    const meta = createElement('div', {
      className: 'small text-muted',
      text: metaParts.join(' • ')
    });
    wrapper.append(strong, meta);
    return wrapper;
  }

  function selectDrug(slot, item) {
    const normalized = normalizeMedicationItem(item || {});
    state[slot === 1 ? 'selectedDrug1' : 'selectedDrug2'] = normalized;

    const input = $(slot === 1 ? 'drug1' : 'drug2');
    if (input) input.value = normalized.displayName || '';

    const suggest = $(slot === 1 ? 'drug1Suggest' : 'drug2Suggest');
    if (suggest) suggest.style.display = 'none';

    if (slot === 1) {
      const drugGroup = $('drugGroup');
      const subclass = $('subclass');

      if (drugGroup) {
        if (
          normalized.drugGroup &&
          !Array.from(drugGroup.options).some((option) => option.value === normalized.drugGroup)
        ) {
          drugGroup.add(new Option(normalized.drugGroup, normalized.drugGroup));
        }
        drugGroup.value = normalized.drugGroup || '';
      }

      if (subclass) {
        if (
          normalized.subclass &&
          !Array.from(subclass.options).some((option) => option.value === normalized.subclass)
        ) {
          subclass.add(new Option(normalized.subclass, normalized.subclass));
        }
        subclass.value = normalized.subclass || '';
      }
    }
  }

  function autoSelectMedicationIfExact(slot) {
    const input = $(slot === 1 ? 'drug1' : 'drug2');
    const raw = input?.value.trim() || '';
    if (!raw || !Array.isArray(state.medIndex)) return;

    const key = normalizeSearch(raw);
    const exact = state.medIndex.find((item) =>
      [item.displayName, item.genericName, item.brandName]
        .some((value) => normalizeSearch(value) === key)
    );
    if (exact) selectDrug(slot, exact);
  }

  function getVizParams() {
    return {
      startDate: $('vizStart')?.value || '',
      endDate: $('vizEnd')?.value || '',
      department: $('vizDept')?.value || '',
      source: $('vizSource')?.value || '',
      severity: $('vizSeverity')?.value || '',
      process: $('vizProcess')?.value || '',
      drugGroup: $('vizDrugGroup')?.value || '',
      subclass: $('vizSubclass')?.value || '',
      generic: $('vizGeneric')?.value || '',
      consult: $('vizConsult')?.value || '',
      errorType: $('vizErrorType')?.value || '',
      specialty: $('vizSpecialty')?.value || '',
      doctor: $('vizDoctor')?.value || '',
      doctorType: $('vizDoctorType')?.value || ''
    };
  }

  async function loadVisualization(force = false) {
    const button = $('btnRefreshViz');
    if (button) {
      button.disabled = true;
      button.textContent = 'Loading…';
    }

    try {
      const data = await apiGet('getVisualization', getVizParams(), { useCache: !force });
      renderVisualization(data || {});
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'รีเฟรช';
      }
    }
  }

  function renderVisualization(data) {
    const metrics = data.metrics || {};
    state.vizRows = Array.isArray(data.rows) ? data.rows : [];

    text('metricTotal', String(metrics.total || 0));
    text('metricThisMonth', String(metrics.thisMonth || 0));
    text('metricConsultAdjusted', `${Number(metrics.consultAdjustedPct || 0).toFixed(1)}%`);
    text('metricFullTime', `${Number(metrics.fullTimePct || 0).toFixed(1)}%`);

    const aggregates = data.aggregates || {};
    barChart('chartDept', aggregates.byDepartment || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    doughnutChart('chartSeverity', aggregates.bySeverity || [], 'label', 'count');
    barChart('chartProcess', aggregates.byProcess || [], 'label', 'count', { indexAxis: 'y', limit: 12 });
    lineChart('chartMonth', aggregates.byMonth || [], 'label', 'count');
    barChart('chartDrugGroup', aggregates.byDrugGroup || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    barChart('chartDrugName', aggregates.byDrugName || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    barChart('chartDoctor', aggregates.byDoctor || [], 'label', 'count', { indexAxis: 'y', limit: 20 });

    renderDrugGroupSeverityMatrix('drugGroupSeverityMatrix', aggregates.drugGroupBySeverity || []);
    renderTwoSeriesBars(
      'consultBySourceBars',
      aggregates.consultBySource || [],
      'adjusted',
      'notAdjusted',
      'ปรับแผน',
      'ยืนยันเดิม'
    );
    renderTwoSeriesBars(
      'errorTypeBySourceBars',
      aggregates.errorTypeBySource || [],
      'medRec',
      'other',
      'Med Rec/Home Med',
      'Other'
    );
    renderReporterTable(aggregates.byReporter || []);
  }

  function chartBase(id) {
    const canvas = $(id);
    if (!canvas || !window.Chart) return null;
    if (state.charts[id]) {
      state.charts[id].destroy();
      state.charts[id] = null;
    }
    return canvas.getContext('2d');
  }

  function barChart(id, rows, labelKey, valueKey, opts = {}) {
    const ctx = chartBase(id);
    if (!ctx) return;
    const data = (rows || []).slice(0, opts.limit || 20);

    state.charts[id] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map((row) => row?.[labelKey] || '-'),
        datasets: [{ label: 'Reports', data: data.map((row) => Number(row?.[valueKey]) || 0) }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: opts.indexAxis || 'x',
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true }, y: { beginAtZero: true } }
      }
    });
  }

  function doughnutChart(id, rows, labelKey, valueKey) {
    const ctx = chartBase(id);
    if (!ctx) return;
    const data = rows || [];

    state.charts[id] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map((row) => row?.[labelKey] || '-'),
        datasets: [{ data: data.map((row) => Number(row?.[valueKey]) || 0) }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }

  function lineChart(id, rows, labelKey, valueKey) {
    const ctx = chartBase(id);
    if (!ctx) return;
    const data = rows || [];

    state.charts[id] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map((row) => row?.[labelKey] || '-'),
        datasets: [{
          label: 'Reports',
          data: data.map((row) => Number(row?.[valueKey]) || 0),
          tension: 0.25
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  function renderTwoSeriesBars(id, rows, aKey, bKey, aLabel, bLabel) {
    const host = $(id);
    if (!host) return;
    clearElement(host);

    const legend = createElement('div', { className: 'd-flex gap-3 small mb-2' });
    [
      { label: aLabel, className: 'seg-a', background: '#007f8f' },
      { label: bLabel, className: 'seg-b', background: '#78cdd1' }
    ].forEach((item) => {
      const span = document.createElement('span');
      const swatch = createElement('i', { className: `badge ${item.className} me-1`, text: ' ' });
      swatch.style.backgroundColor = item.background;
      span.append(swatch, document.createTextNode(item.label));
      legend.appendChild(span);
    });
    host.appendChild(legend);

    if (!rows?.length) {
      host.appendChild(createElement('div', { className: 'text-muted small', text: 'ไม่พบข้อมูล' }));
      return;
    }

    rows.forEach((row) => {
      const a = Number(row?.[aKey]) || 0;
      const b = Number(row?.[bKey]) || 0;
      const total = a + b;
      const percentA = total ? (a / total) * 100 : 0;

      const item = createElement('div', { className: 'row-item' });
      const labelLine = createElement('div', { className: 'label-line' });
      labelLine.append(
        createElement('strong', { text: row?.source || '-' }),
        createElement('span', { text: total })
      );

      const bar = createElement('div', { className: 'bar' });
      const segA = createElement('span', { className: 'seg-a' });
      const segB = createElement('span', { className: 'seg-b' });
      segA.style.width = `${Math.max(0, Math.min(100, percentA))}%`;
      segB.style.width = `${Math.max(0, Math.min(100, 100 - percentA))}%`;
      bar.append(segA, segB);
      item.append(labelLine, bar);
      host.appendChild(item);
    });
  }

  function renderDrugGroupSeverityMatrix(id, rows) {
    const host = $(id);
    if (!host) return;
    clearElement(host);

    if (!Array.isArray(rows) || !rows.length) {
      host.appendChild(createElement('div', { className: 'text-muted small', text: 'ไม่พบข้อมูล' }));
      return;
    }

    const severityOrder = ['A-B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const table = createElement('table', { className: 'table table-sm align-middle mb-0' });
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    headRow.appendChild(createElement('th', { text: 'Drug Group' }));
    const totalHead = createElement('th', { className: 'text-end', text: 'Total' });
    headRow.appendChild(totalHead);
    severityOrder.forEach((severity) => {
      headRow.appendChild(createElement('th', { className: 'text-end', text: severity }));
    });
    thead.appendChild(headRow);

    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const severity = row?.severity || {};
      tr.appendChild(createElement('td', { text: row?.label || '-' }));
      tr.appendChild(createElement('td', {
        className: 'text-end fw-semibold',
        text: Number(row?.total) || 0
      }));
      severityOrder.forEach((level) => {
        tr.appendChild(createElement('td', {
          className: 'text-end',
          text: Number(severity?.[level]) || 0
        }));
      });
      tbody.appendChild(tr);
    });

    table.append(thead, tbody);
    host.appendChild(table);
  }

  function normalizeStaffIdForLookup(value) {
    const id = String(value || '').trim();
    return /^\d{1,5}$/.test(id) ? id.padStart(6, '0') : id;
  }

  function renderReporterTable(rows) {
    const body = $('tableReporterBody');
    if (!body) return;
    clearElement(body);

    const list = (rows || []).slice(0, 20);
    if (!list.length) {
      const tr = document.createElement('tr');
      const td = createElement('td', {
        className: 'text-muted text-center',
        text: 'No data'
      });
      td.colSpan = 3;
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    list.forEach((row) => {
      const label = String(row?.label || '').trim();
      const normalizedLabel = normalizeStaffIdForLookup(label);
      const staff = (state.ref.staff || []).find((item) =>
        normalizeStaffIdForLookup(staffIdOf(item)) === normalizedLabel
      );

      const tr = document.createElement('tr');
      tr.appendChild(createElement('td', { text: label }));
      tr.appendChild(createElement('td', { text: staffNameOf(staff) || 'Unknown' }));
      tr.appendChild(createElement('td', {
        className: 'text-end fw-semibold',
        text: Number(row?.count) || 0
      }));
      body.appendChild(tr);
    });
  }

  function exportSafeValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string' && /^[=+\-@]/.test(value)) return `'${value}`;
    return value;
  }

  function exportSafeRows(rows) {
    return (rows || []).map((row) => {
      const out = {};
      Object.entries(row || {}).forEach(([key, value]) => {
        out[key] = exportSafeValue(value);
      });
      return out;
    });
  }

  function bangkokDateStamp() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const map = {};
    parts.forEach((part) => {
      if (part.type !== 'literal') map[part.type] = part.value;
    });
    return `${map.year}-${map.month}-${map.day}`;
  }

  async function exportXlsx() {
    if (!window.XLSX) {
      toast('ไม่พบ XLSX library', 'error');
      return;
    }
    if (!requireAdmin()) {
      toast('Export raw data ต้องยืนยัน Admin StaffID ที่หน้า Manage Data ก่อน', 'warning');
      return;
    }

    const button = $('btnExportXlsx');
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparing…';
    }

    try {
      const params = Object.assign({}, getVizParams(), {
        includeRows: 'true',
        adminStaffId: state.admin.staffId
      });
      const data = await apiGet('getVisualization', params, { useCache: false });
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (!rows.length) {
        toast('ไม่มีข้อมูลสำหรับ Export', 'warning');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(exportSafeRows(rows));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'PrescribingErrors');
      XLSX.writeFile(wb, `prescribing-error-${bangkokDateStamp()}.xlsx`);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Export .XLSX';
      }
    }
  }

  function appendNoDataRow(body, columns, message = 'No data') {
    const tr = document.createElement('tr');
    const td = createElement('td', { className: 'text-muted', text: message });
    td.colSpan = columns;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  function actionButton(label, toneClass, attrName, attrValue) {
    const button = createElement('button', {
      className: `btn btn-sm ${toneClass}`,
      text: label,
      type: 'button'
    });
    button.setAttribute(attrName, String(attrValue || ''));
    return button;
  }

  function renderManageData(data) {
    state.manage = data || { doctors: [], staff: [], departments: [], medications: [] };

    const doctorBody = $('doctorTableBody');
    if (doctorBody) {
      clearElement(doctorBody);
      if (!state.manage.doctors?.length) appendNoDataRow(doctorBody, 5);
      else {
        state.manage.doctors.forEach((doctor) => {
          const tr = document.createElement('tr');
          [doctor.name, doctor.department, doctor.specialty, doctor.type]
            .forEach((value) => tr.appendChild(createElement('td', { text: value || '' })));

          const actions = createElement('td', { className: 'text-end' });
          actions.append(
            actionButton('Edit', 'btn-outline-primary me-1', 'data-edit-doctor', doctor.name),
            actionButton('Delete', 'btn-outline-danger', 'data-del-doctor', doctor.name)
          );
          tr.appendChild(actions);
          doctorBody.appendChild(tr);
        });
      }
    }

    const staffBody = $('staffTableBody');
    if (staffBody) {
      clearElement(staffBody);
      if (!state.manage.staff?.length) appendNoDataRow(staffBody, 4);
      else {
        state.manage.staff.forEach((staff) => {
          const tr = document.createElement('tr');
          [staff.staffId, staff.name, staff.role]
            .forEach((value) => tr.appendChild(createElement('td', { text: value || '' })));

          const actions = createElement('td', { className: 'text-end' });
          actions.append(
            actionButton('Edit', 'btn-outline-primary me-1', 'data-edit-staff', staff.staffId),
            actionButton('Delete', 'btn-outline-danger', 'data-del-staff', staff.staffId)
          );
          tr.appendChild(actions);
          staffBody.appendChild(tr);
        });
      }
    }

    const departmentBody = $('departmentTableBody');
    if (departmentBody) {
      clearElement(departmentBody);
      if (!state.manage.departments?.length) appendNoDataRow(departmentBody, 2);
      else {
        state.manage.departments.forEach((department) => {
          const tr = document.createElement('tr');
          tr.appendChild(createElement('td', { text: department || '' }));
          const actions = createElement('td', { className: 'text-end' });
          actions.append(
            actionButton('Edit', 'btn-outline-primary me-1', 'data-edit-dept', department),
            actionButton('Delete', 'btn-outline-danger', 'data-del-dept', department)
          );
          tr.appendChild(actions);
          departmentBody.appendChild(tr);
        });
      }
    }

    const medicationBody = $('medicationTableBody');
    if (medicationBody) {
      clearElement(medicationBody);
      if (!state.manage.medications?.length) appendNoDataRow(medicationBody, 5);
      else {
        state.manage.medications.forEach((medication) => {
          const tr = document.createElement('tr');
          [
            medication.genericName,
            medication.brandName,
            medication.form,
            medication.drugGroup,
            medication.subclass
          ].forEach((value) => tr.appendChild(createElement('td', { text: value || '' })));
          medicationBody.appendChild(tr);
        });
      }
    }
  }

  function renderManageLocked() {
    state.manage = { doctors: [], staff: [], departments: [], medications: [] };
    [
      ['doctorTableBody', 5],
      ['staffTableBody', 4],
      ['departmentTableBody', 2],
      ['medicationTableBody', 5]
    ].forEach(([id, columns]) => {
      const body = $(id);
      if (!body) return;
      clearElement(body);
      appendNoDataRow(body, columns, 'กรุณาตรวจสอบ Admin StaffID ก่อน');
    });
  }

  async function loadManageData() {
    if (!state.admin.ok) {
      renderManageLocked();
      return null;
    }
    const data = await apiGet(
      'getManageData',
      { adminStaffId: state.admin.staffId },
      { useCache: false }
    );
    renderManageData(data);
    return data;
  }

  function requireAdmin() {
    if (!state.admin.ok) {
      toast('กรุณาตรวจสอบ Admin StaffID ก่อน', 'warning');
      return false;
    }
    return true;
  }

  function updateAdminBadge() {
    const el = $('adminBadge');
    if (!el) return;
    el.className = `badge align-self-center ${state.admin.ok ? 'text-bg-success' : 'text-bg-secondary'}`;
    el.textContent = state.admin.ok
      ? `Admin: ${state.admin.name || state.admin.staffId}`
      : 'Not verified';
  }

  function modal(id) {
    return bootstrap.Modal.getOrCreateInstance($(id));
  }

  function openDoctorModal(doctor = {}) {
    $('doctorOriginalName').value = doctor.name || '';
    $('doctorName').value = doctor.name || '';
    $('doctorDept').value = doctor.department || '';
    $('doctorSpecialty').value = doctor.specialty || '';
    $('doctorTypeEdit').value = doctor.type || '';
    modal('doctorModal').show();
  }

  function openStaffModal(staff = {}) {
    $('staffOriginalId').value = staff.staffId || '';
    $('staffIdEdit').value = staff.staffId || '';
    $('staffName').value = staff.name || '';
    $('staffRole').value = staff.role || 'User';
    modal('staffModal').show();
  }

  function openDepartmentModal(name = '') {
    $('departmentOriginalName').value = name || '';
    $('departmentNameEdit').value = name || '';
    modal('departmentModal').show();
  }

  async function saveDoctor() {
    if (!requireAdmin()) return;
    await runAdminMutation('saveDoctor', {
      adminStaffId: state.admin.staffId,
      originalName: $('doctorOriginalName').value,
      name: $('doctorName').value.trim(),
      department: $('doctorDept').value,
      specialty: $('doctorSpecialty').value.trim(),
      type: $('doctorTypeEdit').value
    });
    modal('doctorModal').hide();
    await loadReferenceData(true);
    await loadManageData();
    toast('บันทึก Doctor แล้ว', 'success');
  }

  async function saveStaff() {
    if (!requireAdmin()) return;

    const originalStaffId = $('staffOriginalId').value;
    const verifiedAdminId = state.admin.staffId;
    const result = await runAdminMutation('saveStaff', {
      adminStaffId: verifiedAdminId,
      originalStaffId,
      staffId: $('staffIdEdit').value.trim(),
      name: $('staffName').value.trim(),
      role: $('staffRole').value
    });

    if (normalize(originalStaffId) === normalize(verifiedAdminId) && result?.staff) {
      const stillAdmin = normalize(result.staff.role) === 'admin';
      state.admin = {
        ok: stillAdmin,
        staffId: result.staff.staffId || '',
        name: result.staff.name || '',
        role: result.staff.role || ''
      };
      updateAdminBadge();
    }

    modal('staffModal').hide();
    await loadReferenceData(true);
    if (state.admin.ok) await loadManageData();
    else renderManageLocked();
    toast('บันทึก Staff แล้ว', 'success');
  }

  async function saveDepartment() {
    if (!requireAdmin()) return;
    await runAdminMutation('saveDepartment', {
      adminStaffId: state.admin.staffId,
      originalName: $('departmentOriginalName').value,
      department: $('departmentNameEdit').value.trim()
    });
    modal('departmentModal').hide();
    await loadReferenceData(true);
    await loadManageData();
    toast('บันทึก Department แล้ว', 'success');
  }

  async function handleManageActions(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const editDoctor = target.getAttribute('data-edit-doctor');
    if (editDoctor) {
      openDoctorModal((state.manage.doctors || []).find((doctor) => doctor.name === editDoctor) || {});
      return;
    }

    const editStaff = target.getAttribute('data-edit-staff');
    if (editStaff) {
      openStaffModal((state.manage.staff || []).find((staff) => staff.staffId === editStaff) || {});
      return;
    }

    const editDepartment = target.getAttribute('data-edit-dept');
    if (editDepartment) {
      openDepartmentModal(editDepartment);
      return;
    }

    const deleteDoctor = target.getAttribute('data-del-doctor');
    if (deleteDoctor && requireAdmin() && window.confirm(`Delete doctor: ${deleteDoctor}?`)) {
      await runAdminMutation('deleteDoctor', {
        adminStaffId: state.admin.staffId,
        name: deleteDoctor
      });
      await loadReferenceData(true);
      await loadManageData();
      toast('ลบ Doctor แล้ว', 'success');
      return;
    }

    const deleteStaff = target.getAttribute('data-del-staff');
    if (deleteStaff && requireAdmin() && window.confirm(`Delete staff: ${deleteStaff}?`)) {
      await runAdminMutation('deleteStaff', {
        adminStaffId: state.admin.staffId,
        staffId: deleteStaff
      });
      await loadReferenceData(true);
      await loadManageData();
      toast('ลบ Staff แล้ว', 'success');
      return;
    }

    const deleteDepartment = target.getAttribute('data-del-dept');
    if (deleteDepartment && requireAdmin() && window.confirm(`Delete department: ${deleteDepartment}?`)) {
      await runAdminMutation('deleteDepartment', {
        adminStaffId: state.admin.staffId,
        department: deleteDepartment
      });
      await loadReferenceData(true);
      await loadManageData();
      toast('ลบ Department แล้ว', 'success');
    }
  }

  function expectedUploadHeaders(type) {
    if (type === 'Doctors') return ['Name', 'Department', 'Specialty', 'Type'];
    if (type === 'Medications') {
      return ['GenericName', 'BrandName', 'Form', 'DisplayName', 'DrugGroup', 'Subclass'];
    }
    return [];
  }

  function validateUploadSchema(type, headers, rows) {
    const expected = expectedUploadHeaders(type);
    const normalizedHeaders = new Set((headers || []).map((header) => normalizeSearch(header)));
    const missing = expected.filter((header) => !normalizedHeaders.has(normalizeSearch(header)));
    if (missing.length) {
      throw new Error(`Missing required column(s): ${missing.join(', ')}`);
    }
    if (!rows?.length) throw new Error('File is empty');

    if (type === 'Doctors') {
      rows.forEach((row, index) => {
        if (!String(row?.Name || '').trim()) {
          throw new Error(`Doctor Name is required at row ${index + 2}`);
        }
      });
    }

    if (type === 'Medications') {
      rows.forEach((row, index) => {
        if (![row?.GenericName, row?.BrandName, row?.DisplayName]
          .some((value) => String(value || '').trim())) {
          throw new Error(
            `Medication row ${index + 2} must contain GenericName, BrandName, or DisplayName`
          );
        }
      });
    }
  }

  function readExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        try {
          const bytes = new Uint8Array(event.target.result);
          const workbook = window.XLSX.read(bytes, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];

          const matrix = window.XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: '',
            raw: false
          });
          const headers = (matrix[0] || []).map((header) => String(header || '').trim());
          const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

          resolve({ headers, rows });
        } catch (err) {
          reject(new Error('Failed to parse Excel/CSV file'));
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  function handleBulkUpload(type) {
    if (!requireAdmin()) return;

    const fileInput = $('fileUpload');
    if (!fileInput) return;

    fileInput.onchange = async (event) => {
      const file = event.target.files?.[0];
      fileInput.value = '';
      if (!file) return;

      await runSafely(async () => {
        const parsed = await readExcelFile(file);
        validateUploadSchema(type, parsed.headers, parsed.rows);

        if (!window.confirm(
          `Are you sure you want to replace all ${type} data with ${parsed.rows.length} rows?`
        )) {
          return;
        }

        const button = $(`btnUpload${type}`);
        if (button) {
          button.disabled = true;
          button.textContent = 'Uploading...';
        }

        try {
          await runAdminMutation(`upload${type}`, {
            adminStaffId: state.admin.staffId,
            rows: parsed.rows
          });

          clearApiCache();
          await loadReferenceData(true);

          if (type === 'Medications') {
            await prefetchMedicationIndex(true);
          }

          await loadManageData();
          toast(`อัปโหลดข้อมูล ${type} เรียบร้อยแล้ว`, 'success');
        } finally {
          if (button) {
            button.disabled = false;
            button.textContent = 'Upload CSV/Excel';
          }
        }
      }, `upload${type}`);
    };

    fileInput.click();
  }

  function showView(view) {
    document.querySelectorAll('.app-view').forEach((el) => el.classList.add('d-none'));
    $(`view-${view}`)?.classList.remove('d-none');

    document.querySelectorAll('[data-view-link]').forEach((link) => {
      link.classList.toggle('active', link.dataset.viewLink === view);
    });

    try {
      history.replaceState(null, '', `#${view}`);
    } catch (_) {}

    if (view === 'manage') {
      if (state.admin.ok) runSafely(() => loadManageData(), 'loadManageData');
      else renderManageLocked();
    }

    if (view === 'visualization') {
      runSafely(() => loadVisualization(false), 'loadVisualization');
    }
  }

  function attachEvents() {
    // Strict HN mode: trim only; never insert hyphens or zero-pad.
    $('hn')?.addEventListener('blur', (event) => {
      event.target.value = String(event.target.value || '').trim();
    });

    document.querySelectorAll('[data-view-link]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        showView(link.dataset.viewLink);
      });
    });

    $('btnSaveApiUrl')?.addEventListener('click', () => {
      setApiUrl($('apiUrlInput')?.value || '');
    });

    $('btnPing')?.addEventListener('click', () => runSafely(async () => {
      const health = await apiGet('health', {}, { useCache: false });
      setApiStatus('Connected', 'success');
      const tzNote = health?.timeZoneReady === false ? ` | Timezone: ${health.timeZone}` : '';
      toast(`API OK: ${health?.version || CONFIG.VERSION}${tzNote}`, health?.timeZoneReady === false ? 'warning' : 'success');
    }, 'health'));

    $('btnRefreshRef')?.addEventListener('click', () => runSafely(async () => {
      clearApiCache();
      await loadReferenceData(true);
      await prefetchMedicationIndex(true);
      toast('รีเฟรชข้อมูลอ้างอิงแล้ว', 'success');
    }, 'refreshReference'));

    $('btnResetReport')?.addEventListener('click', resetReportForm);

    const reportForm = $('reportForm');
    if (reportForm) {
      reportForm.addEventListener('submit', (event) => {
        event.preventDefault();
        runSafely(async () => {
          const basePayload = getReportPayload();
          const validationError = validateReport(basePayload);
          if (validationError) {
            toast(validationError, 'warning');
            return;
          }

          const payload = attachRequestId(basePayload);
          const button = $('btnSubmitReport');
          if (button) {
            button.disabled = true;
            button.textContent = 'Saving…';
          }

          try {
            const result = await submitReportReliable(payload);
            const reportId = result?.reportId ? ` (${result.reportId})` : '';
            const duplicateNote = result?.duplicate ? ' — ระบบตรวจพบรายการซ้ำและไม่สร้างแถวใหม่' : '';
            const reconcileNote = result?.reconciled ? ' — ยืนยันผลผ่าน RequestID' : '';
            toast(`บันทึกรายงานสำเร็จ${reportId}${duplicateNote}${reconcileNote}`, 'success');
            resetReportForm();
          } finally {
            if (button) {
              button.disabled = false;
              button.textContent = 'บันทึก';
            }
          }
        }, 'submitReport');
      });
    }

    let doctorTimer;
    $('doctorSearch')?.addEventListener('input', () => {
      state.selectedDoctor = null;
      if ($('specialty')) $('specialty').value = '';
      if ($('doctorType')) $('doctorType').value = '';

      window.clearTimeout(doctorTimer);
      doctorTimer = window.setTimeout(() => {
        const query = $('doctorSearch').value;
        showSuggest(
          'doctorSuggest',
          doctorQuery(query),
          (doctor) => doctorSuggestionNode(doctor, query),
          (doctor) => {
            state.selectedDoctor = doctor;
            $('doctorSearch').value = doctor.name || '';
            $('specialty').value = doctor.specialty || '';
            $('doctorType').value = doctor.type || '';
          }
        );
      }, 120);
    });

    $('department')?.addEventListener('change', () => {
      state.selectedDoctor = null;
      if ($('doctorSearch')) $('doctorSearch').value = '';
      if ($('specialty')) $('specialty').value = '';
      if ($('doctorType')) $('doctorType').value = '';
    });

    let reporterTimer;
    $('reporter')?.addEventListener('input', () => {
      state.selectedReporter = null;
      window.clearTimeout(reporterTimer);
      reporterTimer = window.setTimeout(() => {
        const query = $('reporter').value;
        showSuggest(
          'reporterSuggest',
          reporterQuery(query),
          (staff) => reporterSuggestionNode(staff, query),
          setReporter
        );
      }, 120);
    });

    ['drug1', 'drug2'].forEach((id, index) => {
      const slot = index + 1;
      let timer;

      $(id)?.addEventListener('focus', () => {
        prefetchMedicationIndex().catch((err) => {
          console.error('prefetchMedicationIndex', err);
        });
      });

      $(id)?.addEventListener('input', () => {
        state[slot === 1 ? 'selectedDrug1' : 'selectedDrug2'] = null;

        if (slot === 1) {
          if ($('drugGroup')) $('drugGroup').value = '';
          if ($('subclass')) $('subclass').value = '';
        }

        window.clearTimeout(timer);
        timer = window.setTimeout(async () => {
          try {
            await prefetchMedicationIndex();
            const query = $(id).value;
            showSuggest(
              `${id}Suggest`,
              searchMedicationLocal(query),
              (item) => medicationSuggestionNode(item, query),
              (item) => selectDrug(slot, item)
            );
          } catch (err) {
            const box = $(`${id}Suggest`);
            if (box) box.style.display = 'none';
            console.error('Medication search unavailable', err);
          }
        }, 140);
      });

      $(id)?.addEventListener('blur', () => {
        window.setTimeout(() => autoSelectMedicationIfExact(slot), 160);
      });
    });

    $('btnRefreshViz')?.addEventListener('click', () =>
      runSafely(() => loadVisualization(true), 'refreshVisualization')
    );
    $('btnApplyViz')?.addEventListener('click', () =>
      runSafely(() => loadVisualization(false), 'applyVisualization')
    );
    $('btnResetViz')?.addEventListener('click', () => {
      [
        'vizStart', 'vizEnd', 'vizDept', 'vizSource', 'vizSeverity', 'vizProcess',
        'vizDrugGroup', 'vizSubclass', 'vizGeneric', 'vizConsult', 'vizErrorType',
        'vizSpecialty', 'vizDoctor', 'vizDoctorType'
      ].forEach((id) => {
        if ($(id)) $(id).value = '';
      });
      runSafely(() => loadVisualization(true), 'resetVisualization');
    });

    $('btnExportXlsx')?.addEventListener('click', () => runSafely(exportXlsx, 'exportXlsx'));

    $('btnVerifyAdmin')?.addEventListener('click', () => runSafely(async () => {
      const staffId = $('adminStaffId')?.value.trim() || '';
      if (!STAFF_ID_PATTERN.test(staffId)) {
        state.admin = { ok: false, staffId, name: '', role: '' };
        updateAdminBadge();
        renderManageLocked();
        toast('Admin StaffID ต้องมี 6 ตัวอักษร', 'warning');
        return;
      }

      const result = await apiGet('verifyAdmin', { staffId }, { useCache: false });
      state.admin = {
        ok: !!result?.ok,
        staffId,
        name: result?.name || '',
        role: result?.role || ''
      };
      updateAdminBadge();

      if (state.admin.ok) {
        await loadManageData();
        toast('ยืนยัน Admin สำเร็จ', 'success');
      } else {
        renderManageLocked();
        toast('StaffID นี้ไม่มี Role = Admin', 'warning');
      }
    }, 'verifyAdmin'));

    $('btnReloadManage')?.addEventListener('click', () => {
      if (!requireAdmin()) return;
      runSafely(() => loadManageData(), 'reloadManage');
    });

    $('btnAddDoctor')?.addEventListener('click', () => {
      if (requireAdmin()) openDoctorModal();
    });
    $('btnAddStaff')?.addEventListener('click', () => {
      if (requireAdmin()) openStaffModal();
    });
    $('btnAddDepartment')?.addEventListener('click', () => {
      if (requireAdmin()) openDepartmentModal();
    });

    $('btnSaveDoctor')?.addEventListener('click', () => runSafely(saveDoctor, 'saveDoctor'));
    $('btnSaveStaff')?.addEventListener('click', () => runSafely(saveStaff, 'saveStaff'));
    $('btnSaveDepartment')?.addEventListener('click', () => runSafely(saveDepartment, 'saveDepartment'));

    $('btnUploadDoctors')?.addEventListener('click', () => handleBulkUpload('Doctors'));
    $('btnUploadMedications')?.addEventListener('click', () => handleBulkUpload('Medications'));

    document.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      [
        ['doctorSearch', 'doctorSuggest'],
        ['reporter', 'reporterSuggest'],
        ['drug1', 'drug1Suggest'],
        ['drug2', 'drug2Suggest']
      ].forEach(([inputId, boxId]) => {
        if (!target.closest(`#${inputId}`) && !target.closest(`#${boxId}`)) {
          const box = $(boxId);
          if (box) box.style.display = 'none';
        }
      });

      runSafely(() => handleManageActions(event), 'manageAction');
    });
  }

  async function init() {
    renderApiUrl();
    attachEvents();
    updateAdminBadge();
    renderManageLocked();

    try {
      await loadReferenceData(false);
      await prefetchMedicationIndex();
    } catch (err) {
      toast(err?.message || 'โหลดข้อมูลตั้งต้นไม่สำเร็จ', 'error');
      setApiStatus('Failed', 'danger');
    }

    const hash = (location.hash || '#home').replace('#', '');
    showView(['home', 'manage', 'visualization'].includes(hash) ? hash : 'home');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
