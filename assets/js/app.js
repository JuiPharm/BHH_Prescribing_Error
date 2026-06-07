/* Prescribing Error Frontend
 * Works with both:
 * - Google Apps Script backend via JSONP GET + POST fallback
 * - Supabase Edge Function backend via normal fetch
 */
(function () {
  'use strict';

  const CONFIG = Object.assign({ API_URL: 'https://script.google.com/macros/s/AKfycbyIy7tJrZEAeesfARaBVgPaPCt4WXqcLRCIPOJ2_zPWxWCxWZO0pjYrJeCF6m-DEdjF/exec', API_MODE: 'jsonp', LOCK_API_URL: true, VERSION: '1.4.0' }, window.PE_CONFIG || {});
  const API_URL_STORAGE_KEY = 'pe_api_url';
  const API_CACHE_TTL = { getReferenceData: 10 * 60 * 1000, getVisualization: 90 * 1000, getMedicationIndex: 30 * 60 * 1000 };

  const state = {
    ref: { departments: [], doctors: [], staff: [], lists: {} },
    selectedDoctor: null,
    selectedReporter: null,
    selectedDrug1: null,
    selectedDrug2: null,
    medIndex: null,
    admin: { ok: false, staffId: '', name: '', role: 'Not verified' },
    manage: { doctors: [], staff: [], departments: [] },
    vizRows: [],
    charts: {}
  };

  function $(id) { return document.getElementById(id); }
  function text(id, value) { const el = $(id); if (el) el.textContent = value; }
  function normalize(value) { return String(value || '').trim().toLowerCase(); }
  function normalizeSearch(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
  function fmtDateTime(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }); }
  function toast(message, type = 'info') {
    const host = $('toastHost'); if (!host) return;
    const el = document.createElement('div');
    const tone = type === 'error' ? 'danger' : type;
    el.className = 'toast align-items-center show';
    el.innerHTML = `<div class="d-flex"><div class="toast-body"><span class="badge text-bg-${escapeHtml(tone)} me-2">${escapeHtml(type.toUpperCase())}</span>${escapeHtml(message)}</div><button type="button" class="btn-close me-2 m-auto"></button></div>`;
    host.appendChild(el); el.querySelector('.btn-close')?.addEventListener('click', () => el.remove());
    setTimeout(() => { if (el.isConnected) el.remove(); }, 4500);
  }

  function normalizeApiUrl(value) { const v = String(value || '').trim(); return v ? v.replace(/\/+$/, '') : ''; }
  function getApiUrl() {
    const qs = new URLSearchParams(window.location.search).get('api');
    if (qs) return normalizeApiUrl(decodeURIComponent(qs));
    const def = normalizeApiUrl(CONFIG.API_URL);
    if (CONFIG.LOCK_API_URL) return def;
    return normalizeApiUrl(localStorage.getItem(API_URL_STORAGE_KEY)) || def;
  }
  function setApiUrl(value) {
    if (CONFIG.LOCK_API_URL) localStorage.removeItem(API_URL_STORAGE_KEY);
    else if (normalizeApiUrl(value)) localStorage.setItem(API_URL_STORAGE_KEY, normalizeApiUrl(value));
    else localStorage.removeItem(API_URL_STORAGE_KEY);
    renderApiUrl();
  }
  function renderApiUrl() {
    const url = getApiUrl();
    if (!url) setApiStatus('Not configured', 'danger');
  }
  function setApiStatus(label, tone = 'secondary') {
    const el = $('apiStatusText'); if (!el) return;
    el.textContent = label;
    el.classList.remove('text-success', 'text-danger', 'text-warning', 'text-secondary');
    el.classList.add('text-' + (['success', 'danger', 'warning', 'secondary'].includes(tone) ? tone : 'secondary'));
  }

  function cacheKey(action, params) { return `pe_api_cache:${CONFIG.VERSION}:${action}:${JSON.stringify(params || {})}`; }
  function getCache(action, params) {
    const ttl = API_CACHE_TTL[action]; if (!ttl) return null;
    try {
      const raw = sessionStorage.getItem(cacheKey(action, params)); if (!raw) return null;
      const hit = JSON.parse(raw); if (!hit || Date.now() - hit.ts > ttl) return null;
      return hit.data;
    } catch (_) { return null; }
  }
  function setCache(action, params, data) {
    if (!API_CACHE_TTL[action]) return;
    try { sessionStorage.setItem(cacheKey(action, params), JSON.stringify({ ts: Date.now(), data })); } catch (_) {}
  }
  function clearApiCache() {
    try { Object.keys(sessionStorage).filter(k => k.startsWith('pe_api_cache:')).forEach(k => sessionStorage.removeItem(k)); } catch (_) {}
  }

  async function apiGet(action, params = {}, { useCache = true } = {}) {
    const cached = useCache ? getCache(action, params) : null;
    if (cached) return cached;
    const base = getApiUrl(); if (!base) throw new Error('ยังไม่ได้ตั้งค่า API URL');
    const url = new URL(base);
    url.searchParams.set('action', action);
    Object.entries(params || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });

    let data;
    if (CONFIG.API_MODE === 'fetch') {
      const res = await fetch(url.toString(), { method: 'GET' });
      const json = await res.json();
      if (!json || json.success !== true) throw new Error(json?.message || json?.error || 'API error');
      data = json.data;
    } else {
      data = await new Promise((resolve, reject) => {
        const cbName = `__pe_cb_${Math.random().toString(36).slice(2)}`;
        let done = false;
        let script;
        function cleanup() { if (done) return; done = true; try { delete window[cbName]; } catch (_) {} if (script?.parentNode) script.parentNode.removeChild(script); }
        window[cbName] = (payload) => { cleanup(); if (!payload || payload.success !== true) reject(new Error(payload?.message || 'API error')); else resolve(payload.data); };
        url.searchParams.set('callback', cbName);
        url.searchParams.set('_', String(Date.now()));
        script = document.createElement('script'); script.src = url.toString(); script.async = true;
        script.onerror = () => { cleanup(); reject(new Error('เชื่อมต่อ API ไม่สำเร็จ')); };
        document.head.appendChild(script);
      });
    }
    setCache(action, params, data);
    return data;
  }

  async function apiPost(action, data = {}) {
    const base = getApiUrl(); if (!base) throw new Error('ยังไม่ได้ตั้งค่า API URL');
    const payload = JSON.stringify({ action, data });
    if (CONFIG.API_MODE === 'fetch') {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload });
      const json = await res.json();
      if (!json || json.success !== true) throw new Error(json?.message || json?.error || 'API error');
      clearApiCache();
      return json.data;
    }
    const options = { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: payload };
    try {
      const res = await fetch(base, options);
      const text = await res.text();
      const json = JSON.parse(text);
      if (!json || json.success !== true) throw new Error(json?.message || 'API error');
      clearApiCache();
      return json.data;
    } catch (_) {
      await fetch(base, Object.assign({}, options, { mode: 'no-cors' }));
      clearApiCache();
      return { opaque: true };
    }
  }

  function renderOptions(selectEl, items, opts = {}) {
    if (!selectEl) return;
    const { placeholder = '-', valueKey = null, labelKey = null } = opts;
    selectEl.innerHTML = '';
    const ph = document.createElement('option'); ph.value = ''; ph.textContent = placeholder; selectEl.appendChild(ph);
    (items || []).forEach((item) => {
      const opt = document.createElement('option');
      opt.value = valueKey ? String(item[valueKey] ?? '') : String(item ?? '');
      opt.textContent = labelKey ? String(item[labelKey] ?? '') : String(item ?? '');
      selectEl.appendChild(opt);
    });
  }

  function uniqueSorted(values) { return Array.from(new Set((values || []).map(v => String(v || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)); }

  function staffIdOf(s) { return String(s?.staffId ?? s?.StaffID ?? s?.staff_id ?? s?.id ?? '').trim(); }
  function staffNameOf(s) { return String(s?.name ?? s?.Name ?? s?.staffName ?? s?.staff_name ?? '').trim(); }
  function staffRoleOf(s) { return String(s?.role ?? s?.Role ?? 'User').trim() || 'User'; }
  function normalizeStaffList(list) {
    return (Array.isArray(list) ? list : [])
      .map(s => ({ staffId: staffIdOf(s), name: staffNameOf(s), role: staffRoleOf(s) }))
      .filter(s => s.staffId && s.name);
  }

  function renderReferenceData(ref) {
    state.ref = ref || { departments: [], doctors: [], staff: [], lists: {} };
    state.ref.staff = normalizeStaffList(state.ref.staff);
    const lists = state.ref.lists || {};
    
    const errorTypesSorted = (lists.errorTypes || []).slice().sort((a, b) => {
      const aLow = String(a).toLowerCase();
      const bLow = String(b).toLowerCase();
      const aIsOther = aLow.includes('other') || aLow.includes('อื่นๆ');
      const bIsOther = bLow.includes('other') || bLow.includes('อื่นๆ');
      if (aIsOther && !bIsOther) return 1;
      if (!aIsOther && bIsOther) return -1;
      return aLow.localeCompare(bLow, 'th');
    });

    renderOptions($('prescribingErrorFrom'), lists.prescribingErrorFrom || [], { placeholder: 'เลือก…' });
    renderOptions($('consult'), lists.consultResults || [], { placeholder: 'เลือก…' });
    renderOptions($('errorType'), errorTypesSorted, { placeholder: 'เลือก…' });
    const processList = uniqueSorted([...(lists.medicationReconciliation || []), 'Med Rec Transfer', 'None of Above']);
    renderOptions($('medicationReconciliation'), processList, { placeholder: 'เลือก…' });
    renderOptions($('drugGroup'), lists.drugGroups || [], { placeholder: 'เลือก…' });
    renderOptions($('subclass'), lists.subclasses || [], { placeholder: 'เลือก…' });
    renderOptions($('severityLevel'), lists.severityLevels || [], { placeholder: 'เลือก…' });
    renderOptions($('department'), state.ref.departments || [], { placeholder: 'เลือกแผนก…' });
    state.selectedReporter = null;
    const reporterInput = $('reporter');
    if (reporterInput && reporterInput.tagName !== 'SELECT') reporterInput.value = '';
    renderOptions($('doctorDept'), state.ref.departments || [], { placeholder: '-' });

    renderVizList('vizDept', 'All departments', state.ref.departments || []);
    renderVizList('vizSource', 'All sources', lists.prescribingErrorFrom || []);
    renderVizList('vizSeverity', 'All severity', lists.severityLevels || []);
    renderVizList('vizProcess', 'All process', processList);
    renderVizList('vizDrugGroup', 'All drug groups', lists.drugGroups || []);
    renderVizList('vizSubclass', 'All subclasses', lists.subclasses || []);
    renderVizList('vizGeneric', 'All generics', lists.generics || []);
    renderVizList('vizConsult', 'All consult results', lists.consultResults || []);
    renderVizList('vizErrorType', 'All error types', errorTypesSorted);
    renderVizList('vizSpecialty', 'All specialties', uniqueSorted((state.ref.doctors || []).map(d => d.specialty)));
    renderVizList('vizDoctor', 'All doctors', uniqueSorted((state.ref.doctors || []).map(d => d.name)));
    renderVizList('vizDoctorType', 'All doctor types', uniqueSorted((state.ref.doctors || []).map(d => d.type)));
  }
  function renderVizList(id, labelAll, items) { renderOptions($(id), items || [], { placeholder: labelAll }); }

  async function loadReferenceData(force = false) {
    text('lastSyncText', 'Loading…'); setApiStatus('Connecting…', 'secondary');
    const ref = await apiGet('getReferenceData', {}, { useCache: !force });
    renderReferenceData(ref); text('lastSyncText', fmtDateTime(new Date())); setApiStatus('Connected', 'success');
  }

  function getReportPayload() {
    return {
      prescribingErrorFrom: $('prescribingErrorFrom')?.value.trim() || '',
      hn: $('hn')?.value.trim() || '', eventDate: $('eventDate')?.value || '', eventTime: $('eventTime')?.value || '',
      department: $('department')?.value.trim() || '', doctor: state.selectedDoctor?.name || $('doctorSearch')?.value.trim() || '',
      specialty: $('specialty')?.value.trim() || '', doctorType: $('doctorType')?.value.trim() || '',
      errorDetails: $('errorDetails')?.value.trim() || '', consult: $('consult')?.value.trim() || '', errorType: $('errorType')?.value.trim() || '',
      medicationReconciliation: $('medicationReconciliation')?.value.trim() || '', reporter: getReporterStaffId(), reporterInput: $('reporter')?.value.trim() || '',
      drug1: $('drug1')?.value.trim() || '', drug2: $('drug2')?.value.trim() || '',
      drugGroup: $('drugGroup')?.value.trim() || '', subclass: $('subclass')?.value.trim() || '', severityLevel: $('severityLevel')?.value.trim() || '',
      clientVersion: CONFIG.VERSION, userAgent: navigator.userAgent
    };
  }
  function validateReport(p) {
    const required = [['prescribingErrorFrom','Prescribing Error จาก'],['hn','HN'],['eventDate','วันที่เกิดเหตุการณ์'],['eventTime','เวลา'],['department','Department'],['doctor','รายชื่อแพทย์'],['errorDetails','รายละเอียด'],['consult','Consult'],['errorType','ประเภท'],['medicationReconciliation','Process'],['reporter','ผู้รายงาน'],['drug1','ยา 1'],['drugGroup','กลุ่มยา'],['severityLevel','Severity']];
    const missing = required.filter(([k]) => !String(p[k] || '').trim()).map(([, label]) => label);
    if (p.reporterInput && !p.reporter) return 'กรุณาเลือกผู้รายงานจากรายการ Staff ที่ระบบแสดงขึ้นมา';
    if (missing.length) return 'กรอกข้อมูลไม่ครบ: ' + missing.join(', ');
    if (!/^07-\d{2}-\d{6}$/.test(p.hn)) return 'HN ไม่ถูกต้อง (ต้องเป็น 07-XX-YYYYYY)';
    return '';
  }
  function resetReportForm() {
    $('reportForm')?.reset();
    ['prescribingErrorFrom','hn','eventDate','eventTime','department','doctorSearch','specialty','doctorType','errorDetails','consult','errorType','medicationReconciliation','reporter','drug1','drug2','drugGroup','subclass','severityLevel'].forEach(id => { const el = $(id); if (el) el.value = ''; });
    ['doctorSuggest','reporterSuggest','drug1Suggest','drug2Suggest'].forEach(id => { const el = $(id); if (el) el.style.display = 'none'; });
    state.selectedDoctor = state.selectedReporter = state.selectedDrug1 = state.selectedDrug2 = null;
    $('prescribingErrorFrom')?.focus();
  }

  function doctorQuery(q) {
    const key = normalize(q); if (!key) return [];
    const dept = normalize($('department')?.value);
    const doctors = state.ref.doctors || [];
    let list = dept ? doctors.filter(d => normalize(d.department) === dept) : doctors;
    if (dept && !list.length) list = doctors;
    return list.filter(d => normalize(`${d.name} ${d.department} ${d.specialty} ${d.type}`).includes(key)).slice(0, 12);
  }
  function showSuggest(boxId, items, render, onSelect) {
    const box = $(boxId); if (!box) return;
    box.innerHTML = ''; if (!items || !items.length) { box.style.display = 'none'; return; }
    items.forEach(item => { const div = document.createElement('div'); div.className = 'item'; div.innerHTML = render(item); div.addEventListener('click', () => { onSelect(item); box.style.display = 'none'; }); box.appendChild(div); });
    box.style.display = 'block';
  }
  function highlight(text, q) { const raw = String(text || ''); const query = String(q || '').trim(); if (!raw || !query) return escapeHtml(raw); return escapeHtml(raw).replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), m => `<mark>${m}</mark>`); }

  function formatStaffLabel(s) {
    if (!s) return '';
    return [staffIdOf(s), staffNameOf(s)].map(v => String(v || '').trim()).filter(Boolean).join(' - ');
  }
  function reporterQuery(q) {
    const key = normalize(q);
    if (!key) return [];
    return (state.ref.staff || [])
      .filter(s => normalize(`${staffIdOf(s)} ${staffNameOf(s)} ${staffRoleOf(s)}`).includes(key))
      .slice(0, 12);
  }
  function findReporterMatch(value) {
    const key = normalize(value);
    if (!key) return null;
    return (state.ref.staff || []).find(s =>
      normalize(staffIdOf(s)) === key ||
      normalize(staffNameOf(s)) === key ||
      normalize(formatStaffLabel(s)) === key
    ) || null;
  }
  function setReporter(s) {
    state.selectedReporter = s || null;
    const input = $('reporter');
    if (input) input.value = s ? formatStaffLabel(s) : '';
  }
  function getReporterStaffId() {
    const input = $('reporter');
    const raw = input?.value.trim() || '';
    if (!raw) {
      state.selectedReporter = null;
      return '';
    }
    if (state.selectedReporter) {
      const selectedLabel = formatStaffLabel(state.selectedReporter);
      if ([selectedLabel, staffIdOf(state.selectedReporter), staffNameOf(state.selectedReporter)].some(v => normalize(v) === normalize(raw))) {
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

  let medIndexPromise = null;
  async function prefetchMedicationIndex() {
    if (Array.isArray(state.medIndex)) return state.medIndex;
    if (medIndexPromise) return medIndexPromise;
    medIndexPromise = apiGet('getMedicationIndex', {}, { useCache: true }).then(res => {
      const rows = Array.isArray(res?.items) ? res.items : [];
      state.medIndex = rows.map(normalizeMedicationItem).filter(it => it.displayName || it.genericName || it.brandName);
      return state.medIndex;
    }).catch(() => { state.medIndex = []; return []; });
    return medIndexPromise;
  }
  function medicationValueOf(item, keys) {
    for (const key of keys) {
      const value = item && item[key];
      if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
    }
    return '';
  }
  function normalizeMedicationItem(item) {
    const genericName = medicationValueOf(item, ['genericName', 'GenericName', 'generic', 'Generic']);
    const brandName = medicationValueOf(item, ['brandName', 'BrandName', 'brand', 'Brand']);
    const form = medicationValueOf(item, ['form', 'Form', 'dosageForm', 'DosageForm']);
    const displayName = medicationValueOf(item, ['displayName', 'DisplayName', 'name', 'Name']) || [genericName, brandName, form].filter(Boolean).join(' ');
    const drugGroup = medicationValueOf(item, ['drugGroup', 'DrugGroup', 'majorClass', 'MajorClass']);
    const subclass = medicationValueOf(item, ['subclass', 'Subclass', 'subClass', 'SubClass']);
    const code = medicationValueOf(item, ['code', 'Code', 'drugCode', 'DrugCode', 'itemCode', 'ItemCode']);
    const searchText = normalizeSearch([displayName, genericName, brandName, form, drugGroup, subclass, code].join(' '));
    return Object.assign({}, item, { displayName, genericName, brandName, form, drugGroup, subclass, code, search: searchText });
  }
  function searchMedicationLocal(q) {
    const key = normalizeSearch(q);
    if (!key || !Array.isArray(state.medIndex)) return [];
    const terms = key.split(' ').filter(Boolean);
    return state.medIndex
      .map(it => ({ it, score: scoreMedication(it, key, terms) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || String(a.it.displayName || '').localeCompare(String(b.it.displayName || '')))
      .slice(0, 15)
      .map(x => x.it);
  }
  function scoreMedication(it, key, terms) {
    const d = normalizeSearch(it.displayName), g = normalizeSearch(it.genericName), b = normalizeSearch(it.brandName), c = normalizeSearch(it.code);
    if (d === key || g === key || b === key || c === key) return 1200;
    if (d.startsWith(key)) return 1050;
    if (g.startsWith(key)) return 1000;
    if (b.startsWith(key)) return 960;
    if (c.startsWith(key)) return 940;
    if (d.includes(key)) return 850;
    if (g.includes(key)) return 800;
    if (b.includes(key)) return 760;
    if (it.search?.includes(key)) return 620;
    if (terms.length > 1 && terms.every(t => it.search?.includes(t))) return 540;
    return 0;
  }
  function formatMedicationLabel(item) {
    const main = item?.displayName || item?.genericName || item?.brandName || '';
    const meta = [item?.genericName, item?.brandName, item?.form].filter(Boolean).join(' • ');
    return { main, meta };
  }
  function selectDrug(slot, item) {
    const normalized = normalizeMedicationItem(item || {});
    state[slot === 1 ? 'selectedDrug1' : 'selectedDrug2'] = normalized;
    const input = $(slot === 1 ? 'drug1' : 'drug2'); if (input) input.value = normalized.displayName || '';
    const suggest = $(slot === 1 ? 'drug1Suggest' : 'drug2Suggest'); if (suggest) suggest.style.display = 'none';
    if (slot === 1) {
      const dg = $('drugGroup'); const sc = $('subclass');
      if (dg) { if (normalized.drugGroup && ![...dg.options].some(o => o.value === normalized.drugGroup)) dg.add(new Option(normalized.drugGroup, normalized.drugGroup)); dg.value = normalized.drugGroup || ''; }
      if (sc) { if (normalized.subclass && ![...sc.options].some(o => o.value === normalized.subclass)) sc.add(new Option(normalized.subclass, normalized.subclass)); sc.value = normalized.subclass || ''; }
    }
  }
  function autoSelectMedicationIfExact(slot) {
    const input = $(slot === 1 ? 'drug1' : 'drug2');
    const raw = input?.value.trim() || '';
    if (!raw || !Array.isArray(state.medIndex)) return;
    const key = normalizeSearch(raw);
    const exact = state.medIndex.find(it => [it.displayName, it.genericName, it.brandName, it.code].some(v => normalizeSearch(v) === key));
    if (exact) selectDrug(slot, exact);
  }

  function getVizParams() {
    return {
      startDate: $('vizStart')?.value || '', endDate: $('vizEnd')?.value || '', department: $('vizDept')?.value || '',
      source: $('vizSource')?.value || '', severity: $('vizSeverity')?.value || '', process: $('vizProcess')?.value || '',
      drugGroup: $('vizDrugGroup')?.value || '', subclass: $('vizSubclass')?.value || '', generic: $('vizGeneric')?.value || '',
      consult: $('vizConsult')?.value || '', errorType: $('vizErrorType')?.value || '', specialty: $('vizSpecialty')?.value || '',
      doctor: $('vizDoctor')?.value || '', doctorType: $('vizDoctorType')?.value || ''
    };
  }
  async function loadVisualization(force = false) {
    const btn = $('btnRefreshViz'); if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const data = await apiGet('getVisualization', getVizParams(), { useCache: !force });
      renderVisualization(data || {});
    } finally { if (btn) { btn.disabled = false; btn.textContent = 'รีเฟรช'; } }
  }
  function renderVisualization(data) {
    const metrics = data.metrics || {};
    state.vizRows = data.rows || [];
    text('metricTotal', String(metrics.total || 0));
    text('metricThisMonth', String(metrics.thisMonth || 0));
    text('metricConsultAdjusted', `${Number(metrics.consultAdjustedPct || 0).toFixed(1)}%`);
    text('metricFullTime', `${Number(metrics.fullTimePct || 0).toFixed(1)}%`);
    const ag = data.aggregates || {};
    barChart('chartDept', ag.byDepartment || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    doughnutChart('chartSeverity', ag.bySeverity || [], 'label', 'count');
    barChart('chartProcess', ag.byProcess || [], 'label', 'count', { indexAxis: 'y', limit: 12 });
    lineChart('chartMonth', ag.byMonth || [], 'label', 'count');
    barChart('chartDrugGroup', ag.byDrugGroup || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    barChart('chartDrugName', ag.byDrugName || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    barChart('chartDoctor', ag.byDoctor || [], 'label', 'count', { indexAxis: 'y', limit: 20 });
    renderDrugGroupSeverityMatrix('drugGroupSeverityMatrix', ag.drugGroupBySeverity || []);
    renderTwoSeriesBars('consultBySourceBars', ag.consultBySource || [], 'adjusted', 'notAdjusted', 'ปรับแผน', 'ยืนยันเดิม');
    renderTwoSeriesBars('errorTypeBySourceBars', ag.errorTypeBySource || [], 'medRec', 'other', 'Med Rec/Home Med', 'Other');
    const FALLBACK_STAFF = {
      "510489": "ภญ.สุมาลี พิทักษ์ลิมนุวงศ์", "516859": "ภญ.ชรินธร อัครวิเนค", "541560": "ภญ.เมย์รยา แซ่โค้ว",
      "541561": "ภญ.นฤมล กิติไพรวัลย์", "544265": "ภญ.นันทรัตน์ ธีรโรจนวงศ์", "553032": "ภญ.กุลริสา สุวรรณโณ",
      "506759": "ภญ.ศิริพร สุขรา", "558192": "ภญ.ปิยวรรณ รติวิทยกุล", "560857": "ภญ.นนทพร ธีรกุลพจนีย์",
      "561621": "ภญ.วริญญา หมัดชา", "506760": "ภญ.ศาริสา แซลิ่ม", "581581": "ภญ.อาทิตยา หมัดสุเด็น",
      "581580": "ภญ.ชนิกานต์ แสงจันทร์", "595363": "ภญ.อมลมณี ทศพิธนิจธเนศ", "597921": "ภญ.โชติกา พิริยะเพียรพันธ์",
      "599878": "ภญ.ชุตินันท์ หงส์ศิลาทอง", "610103": "ภญ.ธมลวรรณ คิดถูก", "520294": "ภก.ธวัชชัย แซ่ลิ่ม",
      "071067": "ภญ.เบญจมาศ เตชวิวรรธน์", "508140": "ภญ.นิภาภัทร ชีวศรีรุ่งเรือง", "521093": "ภญ.เพ็ญผกา วิจักษณ์กุล",
      "522474": "ภญ.สิริมา จิระนคร", "071037": "ภญ.สหัตยา พงศ์ประยูร", "616163": "ภญ.ปุณยวีร์ กิจชาญวิทย์",
      "552591": "ภญ.หทัยชนก ธีรธาดากุล", "621995": "ภญ.ดวงธิดา ปรีดาชัยกุล", "070633": "K.สุดฤทัย พิธกิจ",
      "070934": "K.อาซ๊ะ หลีเส็น", "071168": "K.วรรณนภา ไชยกูล", "071205": "K.นันทภัค สุขสว่างผล",
      "504325": "K.สินีนาฎ พงศาปาน", "506185": "K.ยุพดี เพชร์สุด", "070767": "K.ยุพเรศ ผดุง",
      "190130": "K.จิรา ศักดิ์ศรี", "070142": "K.โภควิน หนูเสน", "013493": "K.รัตยา แลแว",
      "523287": "K.ภัทรินทร์ ชูจันทร์", "534747": "K.สิทธิเดช จิตดี", "533985": "K.ชนิตา ชายเกตุ",
      "539873": "K.รุ่งทิวา ประดิษฐ์", "091996": "K.แวซง แวดือราแม", "561359": "K.ซาวีย๊ะ อาบูดาโอ๊ะ",
      "505702": "K.ศราวุธ เสนดำ", "595431": "K.การีหม๊ะ ยานยา", "070957": "ภก.นันทพล สมประยูร",
      "528513": "K.จิตาภรณ์", "512019": "K.ซันนียา"
    };

    const reporterBody = $('tableReporterBody');
    if (reporterBody) {
      reporterBody.innerHTML = (ag.byReporter || []).slice(0, 20).map(r => {
        let name = 'Unknown';
        const lbl = String(r.label).trim();
        const normLabel = /^\d{1,5}$/.test(lbl) ? lbl.padStart(6, '0') : lbl;
        
        const staffObj = (state.staff || []).find(s => {
          const sId = String(s.staffId).trim();
          const normS = /^\d{1,5}$/.test(sId) ? sId.padStart(6, '0') : sId;
          return normS === normLabel;
        });
        
        if (staffObj && staffObj.name) name = staffObj.name;
        else if (FALLBACK_STAFF[normLabel]) name = FALLBACK_STAFF[normLabel];
        else if (FALLBACK_STAFF[lbl]) name = FALLBACK_STAFF[lbl];
        
        return `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(name)}</td><td class="text-end fw-semibold">${r.count}</td></tr>`;
      }).join('') || '<tr><td colspan="3" class="text-muted text-center">No data</td></tr>';
    }
  }
  function chartBase(id) {
    const canvas = $(id); if (!canvas || !window.Chart) return null;
    if (state.charts[id]) { state.charts[id].destroy(); state.charts[id] = null; }
    return canvas.getContext('2d');
  }
  function barChart(id, rows, labelKey, valueKey, opts = {}) {
    const ctx = chartBase(id); if (!ctx) return;
    const data = (rows || []).slice(0, opts.limit || 20);
    state.charts[id] = new Chart(ctx, { type: 'bar', data: { labels: data.map(r => r[labelKey] || '-'), datasets: [{ label: 'Reports', data: data.map(r => Number(r[valueKey]) || 0) }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: opts.indexAxis || 'x', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true }, y: { beginAtZero: true } } } });
  }
  function doughnutChart(id, rows, labelKey, valueKey) {
    const ctx = chartBase(id); if (!ctx) return;
    const data = rows || [];
    state.charts[id] = new Chart(ctx, { type: 'doughnut', data: { labels: data.map(r => r[labelKey] || '-'), datasets: [{ data: data.map(r => Number(r[valueKey]) || 0) }] }, options: { responsive: true, maintainAspectRatio: false } });
  }
  function lineChart(id, rows, labelKey, valueKey) {
    const ctx = chartBase(id); if (!ctx) return;
    const data = rows || [];
    state.charts[id] = new Chart(ctx, { type: 'line', data: { labels: data.map(r => r[labelKey] || '-'), datasets: [{ label: 'Reports', data: data.map(r => Number(r[valueKey]) || 0), tension: .25 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  }
  function renderTwoSeriesBars(id, rows, aKey, bKey, aLabel, bLabel) {
    const el = $(id); if (!el) return;
    el.innerHTML = `<div class="d-flex gap-3 small mb-2"><span><i class="badge" style="background:#007f8f">&nbsp;</i> ${escapeHtml(aLabel)}</span><span><i class="badge" style="background:#78cdd1">&nbsp;</i> ${escapeHtml(bLabel)}</span></div>`;
    if (!rows || !rows.length) { el.innerHTML += '<div class="text-muted small">ไม่พบข้อมูล</div>'; return; }
    rows.forEach(r => {
      const a = Number(r[aKey]) || 0, b = Number(r[bKey]) || 0, total = a + b;
      const pa = total ? (a / total * 100) : 0;
      const div = document.createElement('div'); div.className = 'row-item';
      div.innerHTML = `<div class="label-line"><strong>${escapeHtml(r.source || '-')}</strong><span>${total}</span></div><div class="bar"><span class="seg-a" style="width:${pa}%"></span><span class="seg-b" style="width:${100 - pa}%"></span></div>`;
      el.appendChild(div);
    });
  }
  function renderDrugGroupSeverityMatrix(id, rows) {
    const el = $(id); if (!el) return;
    const severityOrder = ['A-B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    if (!Array.isArray(rows) || !rows.length) { el.innerHTML = '<div class="text-muted small">ไม่พบข้อมูล</div>'; return; }
    const html = [`<table class="table table-sm align-middle mb-0"><thead><tr><th>Drug Group</th><th class="text-end">Total</th>${severityOrder.map(s => `<th class="text-end">${escapeHtml(s)}</th>`).join('')}</tr></thead><tbody>`];
    rows.forEach(r => {
      const sev = r.severity || {};
      html.push(`<tr><td>${escapeHtml(r.label || '-')}</td><td class="text-end fw-semibold">${Number(r.total) || 0}</td>${severityOrder.map(s => `<td class="text-end">${Number(sev[s]) || 0}</td>`).join('')}</tr>`);
    });
    html.push('</tbody></table>');
    el.innerHTML = html.join('');
  }
  function exportXlsx() {
    if (!window.XLSX) return toast('ไม่พบ XLSX library', 'error');
    const rows = state.vizRows || [];
    if (!rows.length) return toast('ไม่มีข้อมูลสำหรับ Export', 'warning');
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'PrescribingErrors');
    XLSX.writeFile(wb, `prescribing-error-${new Date().toISOString().slice(0,10)}.xlsx`);
  }

  function renderManageData(data) {
    state.manage = data || { doctors: [], staff: [], departments: [], medications: [] };
    const doctorBody = $('doctorTableBody'); if (doctorBody) doctorBody.innerHTML = (state.manage.doctors || []).map(d => `<tr><td>${escapeHtml(d.name)}</td><td>${escapeHtml(d.department)}</td><td>${escapeHtml(d.specialty)}</td><td>${escapeHtml(d.type)}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary" data-edit-doctor="${escapeHtml(d.name)}">Edit</button> <button class="btn btn-sm btn-outline-danger" data-del-doctor="${escapeHtml(d.name)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No data</td></tr>';
    const staffBody = $('staffTableBody'); if (staffBody) staffBody.innerHTML = (state.manage.staff || []).map(s => `<tr><td>${escapeHtml(s.staffId)}</td><td>${escapeHtml(s.name)}</td><td>${escapeHtml(s.role)}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary" data-edit-staff="${escapeHtml(s.staffId)}">Edit</button> <button class="btn btn-sm btn-outline-danger" data-del-staff="${escapeHtml(s.staffId)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="4" class="text-muted">No data</td></tr>';
    const depBody = $('departmentTableBody'); if (depBody) depBody.innerHTML = (state.manage.departments || []).map(d => `<tr><td>${escapeHtml(d)}</td><td class="text-end"><button class="btn btn-sm btn-outline-primary" data-edit-dept="${escapeHtml(d)}">Edit</button> <button class="btn btn-sm btn-outline-danger" data-del-dept="${escapeHtml(d)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="2" class="text-muted">No data</td></tr>';
    const medBody = $('medicationTableBody'); if (medBody) medBody.innerHTML = (state.manage.medications || []).map(m => `<tr><td>${escapeHtml(m.genericName || '')}</td><td>${escapeHtml(m.brandName || '')}</td><td>${escapeHtml(m.form || '')}</td><td>${escapeHtml(m.drugGroup || '')}</td><td>${escapeHtml(m.subclass || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="text-muted">No data</td></tr>';
  }
  async function loadManageData() { const data = await apiGet('getManageData', {}, { useCache: false }); renderManageData(data); }
  function requireAdmin() { if (!state.admin.ok) { toast('กรุณาตรวจสอบ Admin StaffID ก่อน', 'warning'); return false; } return true; }
  function updateAdminBadge() { const el = $('adminBadge'); if (!el) return; el.className = 'badge align-self-center ' + (state.admin.ok ? 'text-bg-success' : 'text-bg-secondary'); el.textContent = state.admin.ok ? `Admin: ${state.admin.name || state.admin.staffId}` : 'Not verified'; }

  function attachEvents() {
    $('hn')?.addEventListener('blur', (e) => {
      let val = String(e.target.value || '').trim();
      if (!val) return;
      const dashed = val.match(/^07-(\d{2})-(\d{1,6})$/);
      if (dashed) {
        e.target.value = '07-' + dashed[1] + '-' + dashed[2].padStart(6, '0');
        return;
      }
      const digits = val.replace(/[^0-9]/g, '');
      const compact = digits.match(/^07(\d{2})(\d{1,6})$/);
      if (compact) {
        e.target.value = '07-' + compact[1] + '-' + compact[2].padStart(6, '0');
      }
    });
    document.querySelectorAll('[data-view-link]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showView(a.dataset.viewLink); }));
    $('btnSaveApiUrl')?.addEventListener('click', () => setApiUrl($('apiUrlInput')?.value || ''));
    $('btnPing')?.addEventListener('click', async () => { try { const h = await apiGet('health', {}, { useCache: false }); setApiStatus('Connected', 'success'); toast(`API OK: ${h.version || CONFIG.VERSION}`, 'success'); } catch (e) { setApiStatus('Failed', 'danger'); toast(e.message, 'error'); } });
    $('btnRefreshRef')?.addEventListener('click', async () => { clearApiCache(); await loadReferenceData(true); toast('รีเฟรชข้อมูลอ้างอิงแล้ว', 'success'); });
    $('btnResetReport')?.addEventListener('click', resetReportForm);
    $('reportForm')?.addEventListener('submit', async (e) => { e.preventDefault(); const p = getReportPayload(); const err = validateReport(p); if (err) return toast(err, 'warning'); const btn = $('btnSubmitReport'); try { if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; } await apiPost('submitReport', p); toast('บันทึกรายงานสำเร็จ', 'success'); resetReportForm(); } catch (ex) { toast(ex.message || 'บันทึกไม่สำเร็จ', 'error'); } finally { if (btn) { btn.disabled = false; btn.textContent = 'บันทึก'; } } });

    let doctorTimer; $('doctorSearch')?.addEventListener('input', () => { clearTimeout(doctorTimer); doctorTimer = setTimeout(() => { const q = $('doctorSearch').value; showSuggest('doctorSuggest', doctorQuery(q), d => `<strong>${highlight(d.name, q)}</strong><div class="small text-muted">${escapeHtml(d.department || '-')} • ${escapeHtml(d.specialty || '-')} • ${escapeHtml(d.type || '-')}</div>`, d => { state.selectedDoctor = d; $('doctorSearch').value = d.name || ''; $('specialty').value = d.specialty || ''; $('doctorType').value = d.type || ''; }); }, 120); });
    $('department')?.addEventListener('change', () => { state.selectedDoctor = null; $('doctorSearch').value = ''; $('specialty').value = ''; $('doctorType').value = ''; });

    let reporterTimer; $('reporter')?.addEventListener('input', () => { state.selectedReporter = null; clearTimeout(reporterTimer); reporterTimer = setTimeout(() => { const q = $('reporter').value; showSuggest('reporterSuggest', reporterQuery(q), s => `<strong>${highlight(formatStaffLabel(s), q)}</strong><div class="small text-muted">Role: ${escapeHtml(staffRoleOf(s))}</div>`, setReporter); }, 120); });

    ['drug1', 'drug2'].forEach((id, idx) => {
      let timer; const slot = idx + 1;
      $(id)?.addEventListener('focus', prefetchMedicationIndex);
      $(id)?.addEventListener('input', () => {
        state[slot === 1 ? 'selectedDrug1' : 'selectedDrug2'] = null;
        if (slot === 1) { const dg = $('drugGroup'); const sc = $('subclass'); if (dg) dg.value = ''; if (sc) sc.value = ''; }
        clearTimeout(timer);
        timer = setTimeout(async () => {
          await prefetchMedicationIndex();
          const q = $(id).value;
          showSuggest(
            id + 'Suggest',
            searchMedicationLocal(q),
            it => {
              const label = formatMedicationLabel(it);
              return `<strong>${highlight(label.main, q)}</strong><div class="small text-muted">${escapeHtml(label.meta || '-')} • ${escapeHtml(it.drugGroup || '-')} • ${escapeHtml(it.subclass || '-')}</div>`;
            },
            it => selectDrug(slot, it)
          );
        }, 140);
      });
      $(id)?.addEventListener('blur', () => setTimeout(() => autoSelectMedicationIfExact(slot), 160));
    });

    $('btnRefreshViz')?.addEventListener('click', () => loadVisualization(true).catch(e => toast(e.message, 'error')));
    $('btnApplyViz')?.addEventListener('click', () => loadVisualization(false).catch(e => toast(e.message, 'error')));
    $('btnResetViz')?.addEventListener('click', () => { ['vizStart','vizEnd','vizDept','vizSource','vizSeverity','vizProcess','vizDrugGroup','vizSubclass','vizGeneric','vizConsult','vizErrorType','vizSpecialty','vizDoctor','vizDoctorType'].forEach(id => { if ($(id)) $(id).value = ''; }); loadVisualization(true).catch(e => toast(e.message, 'error')); });
    $('btnExportXlsx')?.addEventListener('click', exportXlsx);

    $('btnVerifyAdmin')?.addEventListener('click', async () => { try { const staffId = $('adminStaffId')?.value.trim() || ''; const res = await apiGet('verifyAdmin', { staffId }, { useCache: false }); state.admin = { ok: !!res.ok, staffId, name: res.name || '', role: res.role || '' }; updateAdminBadge(); toast(state.admin.ok ? 'ยืนยัน Admin สำเร็จ' : 'ไม่ใช่ Admin', state.admin.ok ? 'success' : 'warning'); } catch (e) { toast(e.message, 'error'); } });
    $('btnReloadManage')?.addEventListener('click', () => loadManageData().catch(e => toast(e.message, 'error')));
    $('btnAddDoctor')?.addEventListener('click', () => openDoctorModal());
    $('btnAddStaff')?.addEventListener('click', () => openStaffModal());
    $('btnAddDepartment')?.addEventListener('click', () => openDepartmentModal());
    $('btnSaveDoctor')?.addEventListener('click', saveDoctor);
    $('btnSaveStaff')?.addEventListener('click', saveStaff);
    $('btnSaveDepartment')?.addEventListener('click', saveDepartment);
    $('btnUploadDoctors')?.addEventListener('click', () => handleBulkUpload('Doctors'));
    $('btnUploadMedications')?.addEventListener('click', () => handleBulkUpload('Medications'));
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('#doctorSearch') && !target.closest('#doctorSuggest')) { const b = $('doctorSuggest'); if (b) b.style.display = 'none'; }
      if (!target.closest('#reporter') && !target.closest('#reporterSuggest')) { const b = $('reporterSuggest'); if (b) b.style.display = 'none'; }
      if (!target.closest('#drug1') && !target.closest('#drug1Suggest')) { const b = $('drug1Suggest'); if (b) b.style.display = 'none'; }
      if (!target.closest('#drug2') && !target.closest('#drug2Suggest')) { const b = $('drug2Suggest'); if (b) b.style.display = 'none'; }
      handleManageActions(e);
    });
  }
  function showView(view) {
    document.querySelectorAll('.app-view').forEach(el => el.classList.add('d-none'));
    $(`view-${view}`)?.classList.remove('d-none');
    document.querySelectorAll('[data-view-link]').forEach(a => a.classList.toggle('active', a.dataset.viewLink === view));
    if (view === 'manage') loadManageData().catch(e => toast(e.message, 'error'));
    if (view === 'visualization') loadVisualization(false).catch(e => toast(e.message, 'error'));
  }
  function modal(id) { return bootstrap.Modal.getOrCreateInstance($(id)); }
  function openDoctorModal(d = {}) { $('doctorOriginalName').value = d.name || ''; $('doctorName').value = d.name || ''; $('doctorDept').value = d.department || ''; $('doctorSpecialty').value = d.specialty || ''; $('doctorTypeEdit').value = d.type || ''; modal('doctorModal').show(); }
  function openStaffModal(s = {}) { $('staffOriginalId').value = s.staffId || ''; $('staffIdEdit').value = s.staffId || ''; $('staffName').value = s.name || ''; $('staffRole').value = s.role || 'User'; modal('staffModal').show(); }
  function openDepartmentModal(name = '') { $('departmentOriginalName').value = name || ''; $('departmentNameEdit').value = name || ''; modal('departmentModal').show(); }
  async function saveDoctor() { if (!requireAdmin()) return; await apiPost('saveDoctor', { adminStaffId: state.admin.staffId, originalName: $('doctorOriginalName').value, name: $('doctorName').value.trim(), department: $('doctorDept').value, specialty: $('doctorSpecialty').value.trim(), type: $('doctorTypeEdit').value }); modal('doctorModal').hide(); await loadReferenceData(true); await loadManageData(); toast('บันทึก Doctor แล้ว', 'success'); }
  async function saveStaff() { if (!requireAdmin()) return; await apiPost('saveStaff', { adminStaffId: state.admin.staffId, originalStaffId: $('staffOriginalId').value, staffId: $('staffIdEdit').value.trim(), name: $('staffName').value.trim(), role: $('staffRole').value }); modal('staffModal').hide(); await loadReferenceData(true); await loadManageData(); toast('บันทึก Staff แล้ว', 'success'); }
  async function saveDepartment() { if (!requireAdmin()) return; await apiPost('saveDepartment', { adminStaffId: state.admin.staffId, originalName: $('departmentOriginalName').value, department: $('departmentNameEdit').value.trim() }); modal('departmentModal').hide(); await loadReferenceData(true); await loadManageData(); toast('บันทึก Department แล้ว', 'success'); }
  async function handleManageActions(e) {
    const t = e.target; if (!(t instanceof Element)) return;
    const dn = t.getAttribute('data-edit-doctor'); if (dn) return openDoctorModal((state.manage.doctors || []).find(d => d.name === dn) || {});
    const ds = t.getAttribute('data-edit-staff'); if (ds) return openStaffModal((state.manage.staff || []).find(s => s.staffId === ds) || {});
    const dd = t.getAttribute('data-edit-dept'); if (dd) return openDepartmentModal(dd);
    const delDoctor = t.getAttribute('data-del-doctor'); if (delDoctor && requireAdmin() && confirm(`Delete doctor: ${delDoctor}?`)) { await apiPost('deleteDoctor', { adminStaffId: state.admin.staffId, name: delDoctor }); await loadReferenceData(true); await loadManageData(); }
    const delStaff = t.getAttribute('data-del-staff'); if (delStaff && requireAdmin() && confirm(`Delete staff: ${delStaff}?`)) { await apiPost('deleteStaff', { adminStaffId: state.admin.staffId, staffId: delStaff }); await loadReferenceData(true); await loadManageData(); }
    const delDept = t.getAttribute('data-del-dept'); if (delDept && requireAdmin() && confirm(`Delete department: ${delDept}?`)) { await apiPost('deleteDepartment', { adminStaffId: state.admin.staffId, department: delDept }); await loadReferenceData(true); await loadManageData(); }
  }

  function handleBulkUpload(type) {
    if (!requireAdmin()) return;
    const fileInput = $('fileUpload');
    if (!fileInput) return;
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      fileInput.value = ''; // reset
      try {
        const data = await readExcelFile(file);
        if (!data || !data.length) throw new Error('File is empty or invalid format');
        if (!confirm(`Are you sure you want to replace all ${type} data with ${data.length} rows?`)) return;
        
        const btn = $(`btnUpload${type}`);
        if (btn) { btn.disabled = true; btn.textContent = 'Uploading...'; }
        try {
          await apiPost(`upload${type}`, { adminStaffId: state.admin.staffId, rows: data });
          clearApiCache();
          await loadReferenceData(true);
          if (type === 'Medications') {
             sessionStorage.removeItem('pe_cache_getMedicationIndex_');
             await prefetchMedicationIndex();
          }
          await loadManageData();
          toast(`อัปโหลดข้อมูล ${type} เรียบร้อยแล้ว`, 'success');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'Upload CSV/Excel'; }
        }
      } catch (err) {
        toast(`Upload failed: ${err.message}`, 'error');
      }
    };
    fileInput.click();
  }

  function readExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = window.XLSX.read(data, {type: 'array'});
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          const json = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
          resolve(json);
        } catch (err) {
          reject(new Error('Failed to parse Excel file.'));
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  async function init() {
    renderApiUrl(); attachEvents(); updateAdminBadge();
    try { await loadReferenceData(false); await prefetchMedicationIndex(); } catch (e) { toast(e.message || 'โหลดข้อมูลตั้งต้นไม่สำเร็จ', 'error'); setApiStatus('Failed', 'danger'); }
    const hash = (location.hash || '#home').replace('#', ''); showView(['home', 'manage', 'visualization'].includes(hash) ? hash : 'home');
  }
  document.addEventListener('DOMContentLoaded', init);
})();
