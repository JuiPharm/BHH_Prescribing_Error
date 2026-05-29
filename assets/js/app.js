(function () {
  'use strict';

  const CONFIG = window.PE_CONFIG || {};
  const API = window.PE_API;
  const SOURCE_VALUES = ['IV CHEMO', 'OPD PHARMACY PHARMACY', 'IPD PHARMACY PHARMACY'];
  const state = {
    ref: null,
    med: [],
    admin: null,
    visualization: null
  };

  const $ = function (id) { return document.getElementById(id); };
  const text = function (id, value) { const el = $(id); if (el) el.textContent = value == null ? '' : String(value); };
  const val = function (id) { const el = $(id); return el ? String(el.value || '').trim() : ''; };
  const setVal = function (id, value) { const el = $(id); if (el) el.value = value == null ? '' : String(value); };
  const escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>'"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c];
    });
  };

  function toast(message, type) {
    const wrap = $('toastWrap');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'toast ' + (type || '');
    div.textContent = message;
    wrap.appendChild(div);
    window.setTimeout(function () { div.remove(); }, 4500);
  }

  function setApiStatus(message, type) {
    const el = $('apiStatus');
    if (!el) return;
    el.textContent = message;
    el.className = 'badge ' + (type || 'neutral');
  }

  function renderApiUrl() {
    const url = API.getApiUrl();
    const urlText = $('apiUrlText');
    if (urlText) {
      urlText.textContent = '';
      urlText.style.display = 'none';
    }
    const input = $('apiUrlInput');
    if (input) {
      input.value = url || '';
      input.disabled = !!CONFIG.LOCK_API_URL;
    }
    const saveBtn = $('saveApiUrl');
    if (saveBtn) saveBtn.disabled = !!CONFIG.LOCK_API_URL;
    setApiStatus(url && url.indexOf('YOUR_DEPLOYMENT_ID') === -1 ? 'Ready' : 'Not configured', url && url.indexOf('YOUR_DEPLOYMENT_ID') === -1 ? 'success' : 'danger');
  }

  function normalizeHN(input) {
    const s = String(input || '').trim();
    const dashed = s.match(/^07-(\d{2})-(\d{1,6})$/);
    if (dashed) return '07-' + dashed[1] + '-' + dashed[2].padStart(6, '0');
    const digits = s.replace(/[^0-9]/g, '');
    const compact = digits.match(/^07(\d{2})(\d{1,6})$/);
    if (compact) return '07-' + compact[1] + '-' + compact[2].padStart(6, '0');
    return s;
  }

  function validateHN(value) {
    return /^07-\d{2}-\d{6}$/.test(value);
  }

  function normalizeStaffId(input) {
    return String(input || '').trim().slice(0, 6);
  }

  function validateStaffId(value) {
    return /^[A-Za-z0-9]{6}$/.test(value);
  }

  function fillSelect(id, values, placeholder) {
    const el = $(id);
    if (!el) return;
    const current = el.value;
    const arr = (values || []).filter(Boolean);
    el.innerHTML = '';
    if (placeholder !== false) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = placeholder || 'เลือก';
      el.appendChild(opt);
    }
    arr.forEach(function (v) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      el.appendChild(opt);
    });
    if (current && arr.indexOf(current) !== -1) el.value = current;
  }

  function fillDatalist(id, values) {
    const el = $(id);
    if (!el) return;
    const unique = Array.from(new Set((values || []).filter(Boolean)));
    el.innerHTML = unique.map(function (v) { return '<option value="' + escapeHtml(v) + '"></option>'; }).join('');
  }

  function unique(values) {
    return Array.from(new Set((values || []).map(function (v) { return String(v || '').trim(); }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b); });
  }

  async function loadReferenceData(force) {
    setApiStatus('Connecting…', 'warn');
    const ref = await API.request('getReferenceData', {}, { noCache: !!force });
    state.ref = ref;
    renderReferenceData(ref);
    text('lastSync', formatDateTime(ref.lastSync || new Date().toISOString()));
    setApiStatus('Connected', 'success');
    return ref;
  }

  async function prefetchMedicationIndex(force) {
    const data = await API.request('getMedicationIndex', {}, { noCache: !!force, timeoutMs: 45000 });
    state.med = (data && data.items) || [];
    renderMedicationData();
    return state.med;
  }

  function renderReferenceData(ref) {
    const lists = ref.lists || {};
    fillSelect('prescribingErrorFrom', SOURCE_VALUES, 'เลือก');
    fillSelect('department', ref.departments || [], 'เลือก');
    fillSelect('consult', lists.consultResults || [], 'เลือก');
    fillSelect('errorType', lists.errorTypes || [], 'เลือก');
    fillSelect('medicationReconciliation', lists.medicationReconciliation || [], 'เลือก');
    fillSelect('severityLevel', lists.severityLevels || [], 'เลือก');

    fillDatalist('doctorList', (ref.doctors || []).map(function (d) { return d.name; }));
    fillDatalist('staffList', (ref.staff || []).map(function (s) { return s.staffId + ' - ' + s.name; }).concat((ref.staff || []).map(function (s) { return s.staffId; })));
    fillDatalist('drugGroupList', lists.drugGroups || []);
    fillDatalist('subclassList', lists.subclasses || []);

    fillSelect('filterDepartment', ref.departments || [], 'Department');
    fillSelect('filterSource', SOURCE_VALUES, 'Source');
    fillSelect('filterSeverity', lists.severityLevels || [], 'Severity');
    fillSelect('filterProcess', lists.medicationReconciliation || [], 'Process');
    fillSelect('filterConsult', lists.consultResults || [], 'Consult');
    fillSelect('filterErrorType', lists.errorTypes || [], 'Error type');

    renderManageTables();
  }

  function renderMedicationData() {
    const medLabels = [];
    state.med.forEach(function (m) {
      if (m.displayName) medLabels.push(m.displayName);
      const generic = m.genericName || '';
      const brand = m.brandName ? ' (' + m.brandName + ')' : '';
      const form = m.form ? ' - ' + m.form : '';
      if (generic) medLabels.push(generic + brand + form);
    });
    fillDatalist('medicationList', medLabels);
    const lists = (state.ref && state.ref.lists) || {};
    fillDatalist('drugGroupList', unique((lists.drugGroups || []).concat(state.med.map(function (m) { return m.drugGroup; }))));
    fillDatalist('subclassList', unique((lists.subclasses || []).concat(state.med.map(function (m) { return m.subclass; }))));
  }

  function findDoctor(name) {
    const n = String(name || '').trim().toLowerCase();
    return ((state.ref && state.ref.doctors) || []).find(function (d) { return String(d.name || '').trim().toLowerCase() === n; });
  }

  function findMedication(name) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return null;
    return state.med.find(function (m) {
      return [m.displayName, m.genericName, m.brandName].some(function (v) { return String(v || '').trim().toLowerCase() === n; });
    }) || state.med.find(function (m) {
      return [m.displayName, m.genericName, m.brandName].some(function (v) { return String(v || '').trim().toLowerCase().indexOf(n) !== -1; });
    });
  }

  function autoFillDoctor() {
    const d = findDoctor(val('doctor'));
    setVal('specialty', d ? d.specialty : '');
    setVal('doctorType', d ? d.type : '');
    if (d && d.department && !val('department')) setVal('department', d.department);
  }

  function autoFillMedication() {
    const m = findMedication(val('drug1'));
    if (!m) return;
    if (m.drugGroup) setVal('drugGroup', m.drugGroup);
    if (m.subclass) setVal('subclass', m.subclass);
  }

  function parseStaffInput(input) {
    const raw = String(input || '').trim();
    const first = raw.split(/[\s-]+/)[0];
    return normalizeStaffId(first || raw);
  }

  async function handleSubmitReport(e) {
    e.preventDefault();
    const btn = $('submitReportBtn');
    const hn = normalizeHN(val('hn'));
    setVal('hn', hn);
    const reporterStaffId = parseStaffInput(val('reporterStaffId'));
    setVal('reporterStaffId', reporterStaffId);

    if (!validateHN(hn)) {
      toast('HN ต้องอยู่ในรูปแบบ 07-XX-XXXXXX เช่น 07-16-003914', 'error');
      $('hn').focus();
      return;
    }
    if (!validateStaffId(reporterStaffId)) {
      toast('Staff ID ผู้รายงานต้องเป็น Text 6 ตัวอักษร', 'error');
      $('reporterStaffId').focus();
      return;
    }
    if (SOURCE_VALUES.indexOf(val('prescribingErrorFrom')) === -1) {
      toast('PrescribingErrorFrom ต้องเลือกจาก 3 รายการที่กำหนด', 'error');
      return;
    }

    const payload = {
      prescribingErrorFrom: val('prescribingErrorFrom'),
      hn: hn,
      eventDate: val('eventDate'),
      eventTime: val('eventTime'),
      department: val('department'),
      doctor: val('doctor'),
      specialty: val('specialty'),
      doctorType: val('doctorType'),
      errorDetails: val('errorDetails'),
      consult: val('consult'),
      errorType: val('errorType'),
      medicationReconciliation: val('medicationReconciliation'),
      reporterStaffId: reporterStaffId,
      drug1: val('drug1'),
      drug2: val('drug2'),
      drugGroup: val('drugGroup'),
      subclass: val('subclass'),
      severityLevel: val('severityLevel'),
      clientVersion: CONFIG.VERSION || '',
      userAgent: navigator.userAgent || ''
    };

    try {
      if (btn) btn.disabled = true;
      const res = await API.request('submitReport', payload, { noCache: true, ttl: 0, timeoutMs: 45000 });
      API.clearApiCache();
      toast(res.duplicate ? 'ข้อมูลซ้ำ ระบบไม่บันทึกซ้ำ: ' + res.reportId : 'บันทึกสำเร็จ: ' + res.reportId, 'success');
      $('reportForm').reset();
      setTodayDefaults();
      await loadReferenceData(true);
    } catch (err) {
      toast(err.message || 'บันทึกไม่สำเร็จ', 'error');
      setApiStatus('Failed', 'danger');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function setTodayDefaults() {
    const now = new Date();
    if (!$('eventDate').value) $('eventDate').value = now.toISOString().slice(0, 10);
    if (!$('eventTime').value) $('eventTime').value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  }

  async function pingApi() {
    try {
      setApiStatus('Pinging…', 'warn');
      const data = await API.request('health', {}, { noCache: true, ttl: 0, timeoutMs: 20000 });
      setApiStatus('Connected', 'success');
      toast('API connected: ' + (data.version || ''), 'success');
    } catch (err) {
      setApiStatus('Failed', 'danger');
      toast(err.message || 'API Connection Failed', 'error');
    }
  }

  function showView(name) {
    ['home', 'manage', 'visualization'].forEach(function (v) {
      const section = $('view-' + v);
      if (section) section.classList.toggle('active', v === name);
      document.querySelectorAll('[data-nav="' + v + '"]').forEach(function (btn) { btn.classList.toggle('active', v === name); });
    });
    if (name === 'visualization') loadVisualization(false).catch(function (err) { toast(err.message, 'error'); });
    if (name === 'manage') renderManageTables();
    location.hash = name;
  }

  function adminStaffId() {
    return normalizeStaffId(val('adminStaffId'));
  }

  async function verifyAdmin() {
    const id = adminStaffId();
    setVal('adminStaffId', id);
    if (!validateStaffId(id)) {
      toast('Admin StaffID ต้องเป็น 6 ตัวอักษร', 'error');
      return;
    }
    try {
      const res = await API.request('verifyAdmin', { staffId: id }, { noCache: true, ttl: 0 });
      state.admin = res && res.ok ? res : null;
      updateAdminBadge();
      toast(res.ok ? 'ยืนยัน Admin สำเร็จ: ' + res.name : 'ไม่พบสิทธิ์ Admin', res.ok ? 'success' : 'error');
    } catch (err) {
      toast(err.message || 'Verify ไม่สำเร็จ', 'error');
    }
  }

  function updateAdminBadge() {
    const el = $('adminBadge');
    if (!el) return;
    if (state.admin && state.admin.ok) {
      el.textContent = 'Admin: ' + state.admin.name;
      el.className = 'badge success';
    } else {
      el.textContent = 'Not verified';
      el.className = 'badge neutral';
    }
  }

  function requireAdminBeforeEdit() {
    if (!state.admin || !state.admin.ok) {
      toast('กรุณา Verify Admin ก่อนแก้ไขข้อมูล', 'error');
      return false;
    }
    return true;
  }

  async function saveDoctor() {
    if (!requireAdminBeforeEdit()) return;
    const payload = {
      adminStaffId: adminStaffId(),
      name: val('doctorNameManage'),
      department: val('doctorDepartmentManage'),
      specialty: val('doctorSpecialtyManage'),
      type: val('doctorTypeManage')
    };
    await adminAction('saveDoctor', payload, 'บันทึก Doctor สำเร็จ');
    ['doctorNameManage', 'doctorDepartmentManage', 'doctorSpecialtyManage'].forEach(function (id) { setVal(id, ''); });
  }

  async function saveStaff() {
    if (!requireAdminBeforeEdit()) return;
    const staffId = normalizeStaffId(val('staffIdManage'));
    setVal('staffIdManage', staffId);
    if (!validateStaffId(staffId)) return toast('StaffID ต้องมี 6 ตัวอักษร', 'error');
    const payload = { adminStaffId: adminStaffId(), staffId: staffId, name: val('staffNameManage'), role: val('staffRoleManage') };
    await adminAction('saveStaff', payload, 'บันทึก Staff สำเร็จ');
    ['staffIdManage', 'staffNameManage'].forEach(function (id) { setVal(id, ''); });
  }

  async function saveDepartment() {
    if (!requireAdminBeforeEdit()) return;
    const payload = { adminStaffId: adminStaffId(), department: val('departmentManage') };
    await adminAction('saveDepartment', payload, 'บันทึก Department สำเร็จ');
    setVal('departmentManage', '');
  }

  async function adminAction(action, payload, successMessage) {
    try {
      await API.request(action, payload, { noCache: true, ttl: 0, timeoutMs: 30000 });
      API.clearApiCache();
      toast(successMessage, 'success');
      await loadReferenceData(true);
    } catch (err) {
      toast(err.message || 'ดำเนินการไม่สำเร็จ', 'error');
    }
  }

  async function deleteDoctor(name) {
    if (!requireAdminBeforeEdit() || !confirm('ลบ Doctor: ' + name + '?')) return;
    await adminAction('deleteDoctor', { adminStaffId: adminStaffId(), name: name }, 'ลบ Doctor สำเร็จ');
  }

  async function deleteStaff(staffId) {
    if (!requireAdminBeforeEdit() || !confirm('ลบ Staff: ' + staffId + '?')) return;
    await adminAction('deleteStaff', { adminStaffId: adminStaffId(), staffId: staffId }, 'ลบ Staff สำเร็จ');
  }

  async function deleteDepartment(department) {
    if (!requireAdminBeforeEdit() || !confirm('ลบ Department: ' + department + '?')) return;
    await adminAction('deleteDepartment', { adminStaffId: adminStaffId(), department: department }, 'ลบ Department สำเร็จ');
  }

  function renderManageTables() {
    const ref = state.ref || { doctors: [], staff: [], departments: [] };
    const doctorRows = (ref.doctors || []).map(function (d) {
      return '<tr><td>' + escapeHtml(d.name) + '</td><td>' + escapeHtml(d.department) + '</td><td>' + escapeHtml(d.specialty) + '</td><td>' + escapeHtml(d.type) + '</td><td><button class="btn small" data-edit-doctor="' + escapeHtml(d.name) + '">Edit</button> <button class="btn small danger" data-delete-doctor="' + escapeHtml(d.name) + '">Delete</button></td></tr>';
    }).join('');
    const staffRows = (ref.staff || []).map(function (s) {
      return '<tr><td>' + escapeHtml(s.staffId) + '</td><td>' + escapeHtml(s.name) + '</td><td>' + escapeHtml(s.role) + '</td><td><button class="btn small" data-edit-staff="' + escapeHtml(s.staffId) + '">Edit</button> <button class="btn small danger" data-delete-staff="' + escapeHtml(s.staffId) + '">Delete</button></td></tr>';
    }).join('');
    const deptRows = (ref.departments || []).map(function (d) {
      return '<tr><td>' + escapeHtml(d) + '</td><td><button class="btn small" data-edit-department="' + escapeHtml(d) + '">Edit</button> <button class="btn small danger" data-delete-department="' + escapeHtml(d) + '">Delete</button></td></tr>';
    }).join('');
    const dt = $('doctorTable'); if (dt) dt.innerHTML = doctorRows || '<tr><td colspan="5" class="muted">ไม่มีข้อมูล</td></tr>';
    const st = $('staffTable'); if (st) st.innerHTML = staffRows || '<tr><td colspan="4" class="muted">ไม่มีข้อมูล</td></tr>';
    const de = $('departmentTable'); if (de) de.innerHTML = deptRows || '<tr><td colspan="2" class="muted">ไม่มีข้อมูล</td></tr>';
  }

  async function loadVisualization(force) {
    const filters = getFilters();
    const data = await API.request('getVisualization', filters, { noCache: !!force, timeoutMs: 45000 });
    state.visualization = data;
    renderVisualization(data);
    return data;
  }

  function getFilters() {
    return {
      startDate: val('filterStartDate'),
      endDate: val('filterEndDate'),
      department: val('filterDepartment'),
      source: val('filterSource'),
      severity: val('filterSeverity'),
      process: val('filterProcess'),
      drugGroup: val('filterDrugGroup'),
      subclass: val('filterSubclass'),
      generic: val('filterGeneric'),
      consult: val('filterConsult'),
      errorType: val('filterErrorType'),
      specialty: val('filterSpecialty'),
      doctor: val('filterDoctor'),
      doctorType: val('filterDoctorType')
    };
  }

  function resetFilters() {
    ['filterStartDate', 'filterEndDate', 'filterDepartment', 'filterSource', 'filterSeverity', 'filterProcess', 'filterDrugGroup', 'filterSubclass', 'filterGeneric', 'filterConsult', 'filterErrorType', 'filterSpecialty', 'filterDoctor', 'filterDoctorType'].forEach(function (id) { setVal(id, ''); });
    loadVisualization(true).catch(function (err) { toast(err.message, 'error'); });
  }

  function renderVisualization(data) {
    const m = data.metrics || {};
    text('metricTotal', number(m.total));
    text('metricMonth', number(m.thisMonth));
    text('metricConsult', percent(m.consultAdjustedPct));
    text('metricFullTime', percent(m.fullTimePct));
    const a = data.aggregates || {};
    renderBars('chartDepartment', a.byDepartment);
    renderBars('chartSeverity', a.bySeverity);
    renderBars('chartProcess', a.byProcess);
    renderBars('chartMonth', a.byMonth);
    renderBars('chartDrugGroup', a.byDrugGroup);
    renderBars('chartDrugName', a.byDrugName);
    renderBars('chartDoctor', a.byDoctor);
    renderMatrix('tableDrugGroupSeverity', a.drugGroupBySeverity);
    renderMatrix('tableConsultBySource', a.consultBySource);
    renderMatrix('tableErrorTypeBySource', a.errorTypeBySource);
  }

  function renderBars(id, rows) {
    const el = $(id);
    if (!el) return;
    rows = (rows || []).slice(0, 15);
    if (!rows.length) { el.innerHTML = '<p class="muted">ไม่มีข้อมูล</p>'; return; }
    const max = Math.max.apply(null, rows.map(function (r) { return Number(r.count || 0); })) || 1;
    el.innerHTML = rows.map(function (r) {
      const pct = Math.max(2, Number(r.count || 0) / max * 100);
      return '<div class="chart-bar"><div title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div><div>' + number(r.count) + '</div></div>';
    }).join('');
  }

  function matrixCounts(row) {
    if (row.counts) return row.counts;
    if (row.severity) return row.severity;
    if (row.adjusted !== undefined || row.notAdjusted !== undefined) {
      return { 'ปรับแผน': row.adjusted || 0, 'อื่น ๆ': row.notAdjusted || 0 };
    }
    if (row.medRec !== undefined || row.other !== undefined) {
      return { 'Med Rec / Home Med': row.medRec || 0, 'Other': row.other || 0 };
    }
    const out = {};
    Object.keys(row || {}).forEach(function (k) {
      if (['label', 'source', 'drugGroup', 'total'].indexOf(k) === -1 && typeof row[k] === 'number') out[k] = row[k];
    });
    return out;
  }

  function renderMatrix(id, rows) {
    const el = $(id);
    if (!el) return;
    rows = rows || [];
    if (!rows.length) { el.innerHTML = '<p class="muted">ไม่มีข้อมูล</p>'; return; }
    const normalized = rows.map(function (row) {
      const counts = matrixCounts(row);
      const total = row.total !== undefined ? row.total : Object.keys(counts).reduce(function (sum, k) { return sum + Number(counts[k] || 0); }, 0);
      return { label: row.label || row.source || row.drugGroup || '-', counts: counts, total: total };
    });
    const columns = unique(normalized.reduce(function (acc, row) { return acc.concat(Object.keys(row.counts || {})); }, []));
    el.innerHTML = '<div class="table-wrap"><table><thead><tr><th>รายการ</th>' + columns.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' + normalized.map(function (row) {
      return '<tr><td>' + escapeHtml(row.label) + '</td>' + columns.map(function (c) { return '<td>' + number((row.counts || {})[c] || 0) + '</td>'; }).join('') + '<td>' + number(row.total || 0) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function exportCsv() {
    const rows = (state.visualization && state.visualization.rows) || [];
    if (!rows.length) return toast('ไม่มีข้อมูลสำหรับ Export', 'error');
    const headers = unique(rows.reduce(function (acc, r) { return acc.concat(Object.keys(r)); }, []));
    const csv = [headers.join(',')].concat(rows.map(function (r) {
      return headers.map(function (h) { return '"' + String(r[h] == null ? '' : r[h]).replace(/"/g, '""') + '"'; }).join(',');
    })).join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'prescribing-error-export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function formatDateTime(value) {
    try { return new Date(value).toLocaleString('th-TH'); } catch (_) { return String(value || ''); }
  }
  function number(value) { return Number(value || 0).toLocaleString('th-TH'); }
  function percent(value) { return (Number(value || 0)).toFixed(1) + '%'; }

  function attachEvents() {
    document.querySelectorAll('[data-nav]').forEach(function (btn) {
      btn.addEventListener('click', function () { showView(btn.getAttribute('data-nav')); });
    });
    $('reportForm').addEventListener('submit', handleSubmitReport);
    $('hn').addEventListener('blur', function () { setVal('hn', normalizeHN(val('hn'))); });
    $('reporterStaffId').addEventListener('blur', function () { setVal('reporterStaffId', parseStaffInput(val('reporterStaffId'))); });
    $('doctor').addEventListener('change', autoFillDoctor);
    $('doctor').addEventListener('blur', autoFillDoctor);
    $('drug1').addEventListener('change', autoFillMedication);
    $('drug1').addEventListener('blur', autoFillMedication);
    $('refreshReference').addEventListener('click', function () { API.clearApiCache(); loadReferenceData(true).then(function () { return prefetchMedicationIndex(true); }).then(function () { toast('รีเฟรชข้อมูลอ้างอิงสำเร็จ', 'success'); }).catch(function (err) { toast(err.message, 'error'); }); });
    $('pingApi').addEventListener('click', pingApi);
    $('openApiSettings').addEventListener('click', function () { renderApiUrl(); $('apiModal').classList.add('active'); });
    $('closeApiSettings').addEventListener('click', function () { $('apiModal').classList.remove('active'); });
    $('cancelApiUrl').addEventListener('click', function () { $('apiModal').classList.remove('active'); });
    $('saveApiUrl').addEventListener('click', function () {
      const ok = API.setApiUrl(val('apiUrlInput'));
      renderApiUrl();
      toast(ok ? 'บันทึก API URL แล้ว' : 'LOCK_API_URL=true กรุณาแก้ใน config.js', ok ? 'success' : 'error');
      if (ok) $('apiModal').classList.remove('active');
    });
    $('verifyAdmin').addEventListener('click', verifyAdmin);
    $('reloadManage').addEventListener('click', function () { loadReferenceData(true).catch(function (err) { toast(err.message, 'error'); }); });
    $('saveDoctor').addEventListener('click', saveDoctor);
    $('saveStaff').addEventListener('click', saveStaff);
    $('saveDepartment').addEventListener('click', saveDepartment);
    $('refreshVisualization').addEventListener('click', function () { loadVisualization(true).catch(function (err) { toast(err.message, 'error'); }); });
    $('applyFilters').addEventListener('click', function () { loadVisualization(true).catch(function (err) { toast(err.message, 'error'); }); });
    $('resetFilters').addEventListener('click', resetFilters);
    $('exportCsv').addEventListener('click', exportCsv);

    document.addEventListener('click', function (e) {
      const t = e.target;
      if (!t || !t.getAttribute) return;
      const ed = t.getAttribute('data-edit-doctor');
      const dd = t.getAttribute('data-delete-doctor');
      const es = t.getAttribute('data-edit-staff');
      const ds = t.getAttribute('data-delete-staff');
      const eDep = t.getAttribute('data-edit-department');
      const dDep = t.getAttribute('data-delete-department');
      if (ed) {
        const d = (state.ref.doctors || []).find(function (x) { return x.name === ed; });
        if (d) { setVal('doctorNameManage', d.name); setVal('doctorDepartmentManage', d.department); setVal('doctorSpecialtyManage', d.specialty); setVal('doctorTypeManage', d.type || 'Full-time'); }
      }
      if (dd) deleteDoctor(dd);
      if (es) {
        const s = (state.ref.staff || []).find(function (x) { return x.staffId === es; });
        if (s) { setVal('staffIdManage', s.staffId); setVal('staffNameManage', s.name); setVal('staffRoleManage', s.role || 'User'); }
      }
      if (ds) deleteStaff(ds);
      if (eDep) setVal('departmentManage', eDep);
      if (dDep) deleteDepartment(dDep);
    });
  }

  async function init() {
    renderApiUrl();
    attachEvents();
    setTodayDefaults();
    const hash = (location.hash || '#home').replace('#', '');
    showView(['home', 'manage', 'visualization'].indexOf(hash) !== -1 ? hash : 'home');
    try {
      await loadReferenceData(false);
      prefetchMedicationIndex(false).catch(function () {});
    } catch (err) {
      setApiStatus('Failed', 'danger');
      toast(err.message || 'โหลดข้อมูลตั้งต้นไม่สำเร็จ', 'error');
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
