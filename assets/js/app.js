/* Prescribing Error GH Pages Frontend
 *
 * After deploying Apps Script as a Web App, set the /exec URL in:
 * - UI: API Connection > ตั้งค่า
 * - or localStorage key: pe_api_url
 *
 * Notes:
 * - Cross-origin (GitHub Pages -> Apps Script) works reliably with JSONP (GET + callback).
 * - POST responses may be blocked by CORS; this client falls back to no-cors fire-and-forget for POST,
 *   then refreshes data via JSONP.
 */

const DEFAULT_API_URL = '';
const API_URL_STORAGE_KEY = 'https://script.google.com/macros/s/AKfycbzo3N4o8mk9GNTyylyok8sMDpC66s1LQUMIiMsDapK4oBhZqWaFwteerDdct6cb50JN/exec';

function normalizeApiUrl_(value) {
  const v = (value || '').toString().trim();
  if (!v) return '';
  return v.replace(/\/+$/, '');
}

function getApiUrl_() {
  const fromQS = new URLSearchParams(window.location.search).get('api');
  if (fromQS) return normalizeApiUrl_(decodeURIComponent(fromQS));
  const fromStorage = localStorage.getItem(API_URL_STORAGE_KEY);
  if (fromStorage) return normalizeApiUrl_(fromStorage);
  return normalizeApiUrl_(DEFAULT_API_URL);
}

function setApiUrl_(value) {
  const v = normalizeApiUrl_(value);
  if (v) localStorage.setItem(API_URL_STORAGE_KEY, v);
  else localStorage.removeItem(API_URL_STORAGE_KEY);
  renderApiUrl_();
  return v;
}

function getApiUrlOrThrow_() {
  const v = getApiUrl_();
  if (!v) throw new Error('ยังไม่ได้ตั้งค่า Web App URL (กดปุ่ม “ตั้งค่า” ในส่วน API Connection)');
  return v;
}

function renderApiUrl_() {
  const el = document.getElementById('apiUrlText');
  if (!el) return;
  const v = getApiUrl_();
  el.textContent = v || '-';
}

const state = {
  ref: null,
  selectedDoctor: null,
  admin: { staffId: '', role: 'Not verified', ok: false, name: '' },
  charts: { dept: null, specialty: null, drugGroup: null, doctor: null, severity: null, month: null },
};

function $(id) { return document.getElementById(id); }

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function toast(message, type = 'info') {
  const host = $('toastHost');
  if (!host) return;

  const el = document.createElement('div');
  el.className = 'toast align-items-center show';
  el.setAttribute('role', 'alert');

  const allowed = new Set(['primary','secondary','success','danger','warning','info','light','dark']);
  const badgeType = allowed.has(type) ? type : (type === 'error' ? 'danger' : 'secondary');

  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">
        <span class="badge rounded-pill me-2 text-bg-${escapeHtml(String(badgeType))}">${escapeHtml(String(type).toUpperCase())}</span>
        ${escapeHtml(message)}
      </div>
      <button type="button" class="btn-close me-2 m-auto" aria-label="Close"></button>
    </div>
  `;

  host.appendChild(el);
  el.querySelector('.btn-close')?.addEventListener('click', () => el.remove());
  setTimeout(() => { if (el.isConnected) el.remove(); }, 4500);
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  }[s]));
}

async function apiGet(action, params = {}) {
  // JSONP to bypass CORS.
  const baseUrl = getApiUrlOrThrow_();
  const u = new URL(baseUrl);
  u.searchParams.set('action', action);
  u.searchParams.set('t', String(Date.now()));

  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    u.searchParams.set(k, String(v));
  });

  return new Promise((resolve, reject) => {
    const cbName = `__pe_cb_${Math.random().toString(36).slice(2)}`;
    let done = false;

    function cleanup() {
      if (done) return;
      done = true;
      try { delete window[cbName]; } catch (_) {}
      if (script && script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = (payload) => {
      cleanup();
      if (!payload || payload.success !== true) {
        reject(new Error((payload && payload.message) || 'API error'));
        return;
      }
      resolve(payload.data);
    };

    u.searchParams.set('callback', cbName);

    const script = document.createElement('script');
    script.src = u.toString();
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error('เชื่อมต่อ API ไม่สำเร็จ (ตรวจสอบว่า Deploy เป็น Web app และ URL ถูกต้อง)'));
    };

    document.head.appendChild(script);
  });
}

async function apiPost(action, data = {}) {
  // Try normal fetch (read response). If blocked, fall back to no-cors fire-and-forget.
  const url = getApiUrlOrThrow_();
  const payload = JSON.stringify({ action, data });

  const options = {
    method: 'POST',
    redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: payload,
  };

  try {
    const res = await fetch(url, options);
    const text = await res.text();
    const json = JSON.parse(text);

    if (!json || json.success !== true) throw new Error((json && json.message) || 'API error');
    return json.data;
  } catch (_) {
    await fetch(url, { ...options, mode: 'no-cors' });
    return { _opaque: true };
  }
}

function renderOptions(selectEl, options, { placeholder = '-', valueKey = null, labelKey = null } = {}) {
  if (!selectEl) return;

  selectEl.innerHTML = '';
  const ph = document.createElement('option');
  ph.value = '';
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  (options || []).forEach((o) => {
    const opt = document.createElement('option');
    if (valueKey && labelKey) {
      opt.value = String(o[valueKey] ?? '');
      opt.textContent = String(o[labelKey] ?? '');
    } else {
      opt.value = String(o);
      opt.textContent = String(o);
    }
    selectEl.appendChild(opt);
  });
}

function fmtDateTime(dt) {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

// ---------------- Reference data ----------------

function renderReferenceData_(ref) {
  state.ref = ref || { departments: [], doctors: [], staff: [], lists: {} };

  // Dropdown lists
  renderOptions($('prescribingErrorFrom'), state.ref.lists?.prescribingErrorFrom || [], { placeholder: 'เลือก…' });
  renderOptions($('consult'), state.ref.lists?.consultResults || [], { placeholder: 'เลือก…' });
  renderOptions($('errorType'), state.ref.lists?.errorTypes || [], { placeholder: 'เลือก…' });
  renderOptions($('medicationReconciliation'), state.ref.lists?.medicationReconciliation || [], { placeholder: 'เลือก…' });
  renderOptions($('drugGroup'), state.ref.lists?.drugGroups || [], { placeholder: 'เลือก…' });
  renderOptions($('severityLevel'), state.ref.lists?.severityLevels || [], { placeholder: 'เลือก…' });

  // Department
  renderOptions($('department'), state.ref.departments || [], { placeholder: 'เลือกแผนก…' });

  // Reporter
  const staffOpts = (state.ref.staff || []).map(s => ({ value: s.staffId, label: `${s.staffId} - ${s.name}` }));
  renderOptions($('reporter'), staffOpts, { placeholder: 'เลือกผู้รายงาน…', valueKey: 'value', labelKey: 'label' });

  // Viz dept filter
  const vizDept = $('vizDept');
  if (vizDept) {
    vizDept.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'All departments';
    vizDept.appendChild(all);
    (state.ref.departments || []).forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      vizDept.appendChild(opt);
    });
  }

  // Doctor modal dept list
  renderOptions($('doctorDept'), state.ref.departments || [], { placeholder: '-' });
}

async function loadReferenceData() {
  setText('lastSync', 'Loading…');
  const ref = await apiGet('getReferenceData');
  renderReferenceData_(ref);
  setText('lastSync', fmtDateTime(new Date()));
}

// ---------------- Report form ----------------

function resetReportForm() {
  $('reportForm')?.reset();
  $('doctorSuggest') && ($('doctorSuggest').style.display = 'none');
  state.selectedDoctor = null;
  if ($('doctorSearch')) $('doctorSearch').value = '';
  if ($('specialty')) $('specialty').value = '';
  if ($('doctorType')) $('doctorType').value = '';
}

function getReportPayload() {
  const doctorName = state.selectedDoctor?.name || $('doctorSearch')?.value.trim() || '';

  return {
    prescribingErrorFrom: $('prescribingErrorFrom')?.value.trim() || '',
    hn: $('hn')?.value.trim() || '',
    eventDate: $('eventDate')?.value || '',
    eventTime: $('eventTime')?.value || '',
    department: $('department')?.value.trim() || '',
    doctor: doctorName,
    specialty: $('specialty')?.value.trim() || '',
    doctorType: $('doctorType')?.value.trim() || '',
    errorDetails: $('errorDetails')?.value.trim() || '',
    consult: $('consult')?.value.trim() || '',
    errorType: $('errorType')?.value.trim() || '',
    medicationReconciliation: $('medicationReconciliation')?.value.trim() || '',
    reporter: $('reporter')?.value.trim() || '',
    drug1: $('drug1')?.value.trim() || '',
    drug2: $('drug2')?.value.trim() || '',
    drugGroup: $('drugGroup')?.value.trim() || '',
    severityLevel: $('severityLevel')?.value.trim() || '',
  };
}

function reportClientValidate(payload) {
  const required = [
    ['prescribingErrorFrom', 'Prescribing Error จาก'],
    ['hn', 'HN'],
    ['eventDate', 'วันที่เกิดเหตุการณ์'],
    ['eventTime', 'เวลาที่เกิดเหตุการณ์'],
    ['department', 'Department'],
    ['doctor', 'รายชื่อแพทย์'],
    ['errorDetails', 'รายละเอียด'],
    ['consult', 'Consult'],
    ['errorType', 'ประเภท'],
    ['medicationReconciliation', 'Medication reconciliation / Home Med'],
    ['reporter', 'ผู้รายงาน'],
    ['drug1', 'ยา (ตัวที่ 1)'],
    ['drugGroup', 'กลุ่มของยา'],
    ['severityLevel', 'Severity'],
  ];

  const missing = required.filter(([k]) => !String(payload[k] || '').trim());
  if (missing.length) return `กรอกข้อมูลไม่ครบ: ${missing.map(([,label]) => label).join(', ')}`;

  const hnOk = /^07-\d{2}-\d{6}$/.test(payload.hn);
  if (!hnOk) return 'HN ไม่ถูกต้อง (ต้องเป็น 07-XX-YYYYYY)';

  return null;
}

// ---------------- Doctor typeahead ----------------

let doctorSearchTimer = null;

function showDoctorSuggest(items) {
  const box = $('doctorSuggest');
  if (!box) return;

  box.innerHTML = '';
  if (!items.length) {
    box.style.display = 'none';
    return;
  }

  items.forEach(d => {
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <div class="fw-semibold">${escapeHtml(d.name)}</div>
      <div class="sub">${escapeHtml(d.department || '-')} • ${escapeHtml(d.specialty || '-')} • ${escapeHtml(d.type || '-')}</div>
    `;
    item.addEventListener('click', () => {
      state.selectedDoctor = d;
      if ($('doctorSearch')) $('doctorSearch').value = d.name;
      if ($('specialty')) $('specialty').value = d.specialty || '';
      if ($('doctorType')) $('doctorType').value = d.type || '';
      box.style.display = 'none';
    });
    box.appendChild(item);
  });

  box.style.display = 'block';
}

function doctorQuery(q) {
  const ref = state.ref;
  if (!ref?.doctors) return [];

  const query = (q || '').trim().toLowerCase();
  if (!query) return [];

  const deptFilter = $('department')?.value.trim() || '';
  const list = ref.doctors.filter(d => {
    if (!d?.name) return false;
    if (deptFilter && String(d.department || '').trim() !== deptFilter) return false;
    return true;
  });

  const matched = list.filter(d => {
    const hay = `${d.name} ${d.department || ''} ${d.specialty || ''} ${d.type || ''}`.toLowerCase();
    return hay.includes(query);
  });

  return matched.slice(0, 12);
}

// ---------------- Admin verification ----------------

async function validateAdmin() {
  const staffId = $('adminStaffId')?.value.trim() || '';
  if (!staffId) {
    state.admin = { staffId: '', role: 'Not verified', ok: false, name: '' };
    if ($('adminBadge')) $('adminBadge').className = 'badge rounded-pill text-bg-secondary';
    setText('adminBadge', 'Not verified');
    toggleManageControls();
    return;
  }

  try {
    const data = await apiGet('validateStaff', { staffId });
    state.admin = { staffId, role: data.role, ok: data.ok, name: data.name || '' };

    if (data.ok && data.role === 'Admin') {
      if ($('adminBadge')) $('adminBadge').className = 'badge rounded-pill text-bg-success';
      setText('adminBadge', `Admin: ${data.name || staffId}`);
      toast('ยืนยันสิทธิ์ Admin สำเร็จ', 'success');
    } else if (data.ok) {
      if ($('adminBadge')) $('adminBadge').className = 'badge rounded-pill text-bg-warning';
      setText('adminBadge', `User: ${data.name || staffId}`);
      toast('StaffID นี้เป็น User (ไม่มีสิทธิ์แก้ไขข้อมูล)', 'danger');
    } else {
      if ($('adminBadge')) $('adminBadge').className = 'badge rounded-pill text-bg-danger';
      setText('adminBadge', 'Not found');
      toast('ไม่พบ StaffID', 'danger');
    }

    toggleManageControls();
  } catch (e) {
    toast(e.message, 'danger');
  }
}

function requireAdminClient() {
  if (!state.admin.ok) throw new Error('กรุณาตรวจสอบ Admin StaffID ก่อน');
  if (state.admin.role !== 'Admin') throw new Error('สิทธิ์ไม่เพียงพอ: Role ไม่ใช่ Admin');
}

function toggleManageControls() {
  const can = state.admin.ok && state.admin.role === 'Admin';
  ['btnAddDoctor', 'btnAddStaff', 'btnAddDept'].forEach(id => {
    const el = $(id);
    if (el) el.disabled = !can;
  });
}

// ---------------- Manage Data ----------------

async function loadManage() {
  const [docRes, staffRes, deptRes] = await Promise.all([
    apiGet('listDoctors'),
    apiGet('listStaff'),
    apiGet('listDepartments'),
  ]);

  renderDoctorsTable(docRes.doctors || []);
  renderStaffTable(staffRes.staff || []);
  renderDeptTable(deptRes.departments || []);

  // keep typeahead / dropdown data in sync
  if (!state.ref || !state.ref.lists) {
    state.ref = await apiGet('getReferenceData');
  }
  state.ref.doctors = docRes.doctors || [];
  state.ref.staff = staffRes.staff || [];
  state.ref.departments = (deptRes.departments || []).map(d => d.department);
  renderReferenceData_(state.ref);

  toggleManageControls();
}

function renderDoctorsTable(doctors) {
  const tb = $('tblDoctors');
  if (!tb) return;

  tb.innerHTML = '';
  doctors.forEach(d => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.department)}</td>
      <td>${escapeHtml(d.specialty)}</td>
      <td>${escapeHtml(d.type)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary me-1" data-act="edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-act="del"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener('click', () => openDoctorModal(d));
    tr.querySelector('[data-act="del"]').addEventListener('click', () => deleteDoctor(d));
    tb.appendChild(tr);
  });
}

function renderStaffTable(staff) {
  const tb = $('tblStaff');
  if (!tb) return;

  tb.innerHTML = '';
  staff.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(s.staffId)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td><span class="badge text-bg-${s.role === 'Admin' ? 'primary' : 'secondary'}">${escapeHtml(s.role)}</span></td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary me-1" data-act="edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-act="del"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener('click', () => openStaffModal(s));
    tr.querySelector('[data-act="del"]').addEventListener('click', () => deleteStaff(s));
    tb.appendChild(tr);
  });
}

function renderDeptTable(depts) {
  const tb = $('tblDept');
  if (!tb) return;

  tb.innerHTML = '';
  (depts || []).forEach((d) => {
    const name = typeof d === 'string' ? d : d.department;
    const id = typeof d === 'string' ? null : d.id;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary me-1" data-act="edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-act="del"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener('click', () => openDeptModal({ id, department: name }));
    tr.querySelector('[data-act="del"]').addEventListener('click', () => deleteDept({ id, department: name }));
    tb.appendChild(tr);
  });
}

// --- Modals ---
let modalDoctor, modalStaff, modalDept;

function openDoctorModal(doctor = null) {
  $('doctorId').value = doctor?.id || '';
  $('doctorName').value = doctor?.name || '';
  $('doctorDept').value = doctor?.department || '';
  $('doctorSpec').value = doctor?.specialty || '';
  $('doctorTypeModal').value = doctor?.type || '';
  setText('modalDoctorTitle', doctor ? 'Edit Doctor' : 'Add Doctor');
  modalDoctor.show();
}

async function saveDoctor() {
  requireAdminClient();

  const doc = {
    id: $('doctorId').value ? Number($('doctorId').value) : undefined,
    name: $('doctorName').value.trim(),
    department: $('doctorDept').value.trim(),
    specialty: $('doctorSpec').value.trim(),
    type: $('doctorTypeModal').value.trim(),
  };

  if (!doc.name) throw new Error('Doctor name is required.');

  if (doc.id) {
    await apiPost('updateDoctor', { adminStaffId: state.admin.staffId, id: doc.id, doctor: doc });
    toast('แก้ไข Doctor สำเร็จ', 'success');
  } else {
    await apiPost('addDoctor', { adminStaffId: state.admin.staffId, doctor: doc });
    toast('เพิ่ม Doctor สำเร็จ', 'success');
  }

  modalDoctor.hide();
  await loadManage();
}

async function deleteDoctor(doctor) {
  try {
    requireAdminClient();
    if (!confirm(`ลบ Doctor: ${doctor.name} ?`)) return;
    await apiPost('deleteDoctor', { adminStaffId: state.admin.staffId, id: doctor.id });
    toast('ลบ Doctor สำเร็จ', 'success');
    await loadManage();
  } catch (e) {
    toast(e.message, 'danger');
  }
}

function openStaffModal(staff = null) {
  $('staffRowId').value = staff?.id || '';
  $('staffIdInput').value = staff?.staffId || '';
  $('staffNameInput').value = staff?.name || '';
  $('staffRoleInput').value = staff?.role || 'User';
  setText('modalStaffTitle', staff ? 'Edit Staff' : 'Add Staff');
  modalStaff.show();
}

async function saveStaff() {
  requireAdminClient();

  const st = {
    id: $('staffRowId').value ? Number($('staffRowId').value) : undefined,
    staffId: $('staffIdInput').value.trim(),
    name: $('staffNameInput').value.trim(),
    role: $('staffRoleInput').value.trim(),
  };

  if (!st.staffId || !st.name) throw new Error('StaffID and Name are required.');

  if (st.id) {
    await apiPost('updateStaff', { adminStaffId: state.admin.staffId, id: st.id, staff: st });
    toast('แก้ไข Staff สำเร็จ', 'success');
  } else {
    await apiPost('addStaff', { adminStaffId: state.admin.staffId, staff: st });
    toast('เพิ่ม Staff สำเร็จ', 'success');
  }

  modalStaff.hide();
  await loadManage();
}

async function deleteStaff(staff) {
  try {
    requireAdminClient();
    if (!confirm(`ลบ Staff: ${staff.staffId} - ${staff.name} ?`)) return;
    await apiPost('deleteStaff', { adminStaffId: state.admin.staffId, id: staff.id });
    toast('ลบ Staff สำเร็จ', 'success');
    await loadManage();
  } catch (e) {
    toast(e.message, 'danger');
  }
}

function openDeptModal(dept = null) {
  $('deptRowId').value = dept?.id || '';
  $('deptNameInput').value = dept?.department || '';
  setText('modalDeptTitle', dept ? 'Edit Department' : 'Add Department');
  modalDept.show();
}

async function saveDept() {
  requireAdminClient();

  const dept = {
    id: $('deptRowId').value ? Number($('deptRowId').value) : undefined,
    department: $('deptNameInput').value.trim(),
  };

  if (!dept.department) throw new Error('Department is required.');

  if (dept.id) {
    await apiPost('updateDepartment', { adminStaffId: state.admin.staffId, id: dept.id, department: dept.department });
    toast('แก้ไข Department สำเร็จ', 'success');
  } else {
    await apiPost('addDepartment', { adminStaffId: state.admin.staffId, department: dept.department });
    toast('เพิ่ม Department สำเร็จ', 'success');
  }

  modalDept.hide();
  await loadManage();
}

async function deleteDept(dept) {
  try {
    requireAdminClient();
    if (!confirm(`ลบ Department: ${dept.department} ?`)) return;
    await apiPost('deleteDepartment', { adminStaffId: state.admin.staffId, id: dept.id });
    toast('ลบ Department สำเร็จ', 'success');
    await loadManage();
  } catch (e) {
    toast(e.message, 'danger');
  }
}

// ---------------- Visualization ----------------

async function loadVisualization(params = {}) {
  const data = await apiGet('getVisualization', params);

  // Stats
  setText('statTotal', String(data.stats?.totalReports ?? '-'));
  setText('statMonth', String(data.stats?.monthReports ?? '-'));
  setText('statConsult', `${data.stats?.consultAdjustPct ?? 0}%`);
  setText('statFT', `${data.stats?.fulltimePct ?? 0}%`);

  // Charts
  renderDeptChart(data.charts?.byDepartment || []);
  renderSpecialtyChart(data.charts?.bySpecialty || []);
  renderDrugGroupChart(data.charts?.byDrugGroup || []);
  renderDoctorChart(data.charts?.byDoctor || []);
  renderSeverityChart(data.charts?.bySeverity || []);
  renderMonthChart(data.charts?.byMonth || []);
}

function destroyChart(c) { try { c?.destroy(); } catch {} }

function renderDeptChart(series) {
  destroyChart(state.charts.dept);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.dept = new Chart($('chartDept'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reports', data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 } }, y: { beginAtZero: true } },
    },
  });
}

function renderSpecialtyChart(series) {
  destroyChart(state.charts.specialty);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.specialty = new Chart($('chartSpecialty'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reports', data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 } }, y: { beginAtZero: true } },
    },
  });
}

function renderDrugGroupChart(series) {
  destroyChart(state.charts.drugGroup);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.drugGroup = new Chart($('chartDrugGroup'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reports', data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      indexAxis: 'y',
      scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false } } },
    },
  });
}

function renderDoctorChart(series) {
  destroyChart(state.charts.doctor);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.doctor = new Chart($('chartDoctor'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Reports', data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      indexAxis: 'y',
      scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false } } },
    },
  });
}

function renderSeverityChart(series) {
  destroyChart(state.charts.severity);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.severity = new Chart($('chartSeverity'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values }] },
    options: { responsive: true, plugins: { legend: { position: 'bottom' } } },
  });
}

function renderMonthChart(series) {
  destroyChart(state.charts.month);
  const labels = series.map(x => x.period);
  const values = series.map(x => x.count);

  state.charts.month = new Chart($('chartMonth'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Reports', data: values, tension: 0.25 }] },
    options: { responsive: true, plugins: { legend: { display: false } } },
  });
}

// ---------------- Export XLSX ----------------

async function exportXlsx() {
  if (typeof XLSX === 'undefined') {
    throw new Error('ไม่พบไลบรารี XLSX (ตรวจสอบว่าเพิ่ม script xlsx.full.min.js ใน index.html แล้ว)');
  }

  const params = getVizParamsFromUI();
  const data = await apiGet('exportErrors', params);

  const aoa = data.aoa || [];
  if (!aoa.length) {
    toast('ไม่มีข้อมูลสำหรับ Export ตามตัวกรองปัจจุบัน', 'warning');
    return;
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, 'PrescribingErrors');

  const filename = (data.filename || `PrescribingErrors_${new Date().toISOString().slice(0,10)}.xlsx`).replace(/\s+/g, '_');
  XLSX.writeFile(wb, filename);
}

// ---------------- Init ----------------

async function init() {
  renderApiUrl_();

  // Modals
  modalDoctor = new bootstrap.Modal($('modalDoctor'));
  modalStaff = new bootstrap.Modal($('modalStaff'));
  modalDept = new bootstrap.Modal($('modalDept'));

  // Events: reference reload
  $('btnReloadRef')?.addEventListener('click', async () => {
    try {
      await loadReferenceData();
      toast('โหลดข้อมูลอ้างอิงสำเร็จ', 'success');
    } catch (e) {
      toast(e.message, 'danger');
    }
  });

  $('btnPing')?.addEventListener('click', async () => {
    try {
      const info = await apiGet('ping');
      toast(`Ping OK (${info.spreadsheetName || ''})`, 'success');
    } catch (e) {
      toast(e.message, 'danger');
    }
  });

  // Report form
  $('btnResetReport')?.addEventListener('click', resetReportForm);

  $('department')?.addEventListener('change', () => {
    state.selectedDoctor = null;
    if ($('doctorSearch')) $('doctorSearch').value = '';
    if ($('specialty')) $('specialty').value = '';
    if ($('doctorType')) $('doctorType').value = '';
    if ($('doctorSuggest')) $('doctorSuggest').style.display = 'none';
  });

  $('doctorSearch')?.addEventListener('input', (ev) => {
    const q = ev.target.value;
    state.selectedDoctor = null;
    if ($('specialty')) $('specialty').value = '';
    if ($('doctorType')) $('doctorType').value = '';

    clearTimeout(doctorSearchTimer);
    doctorSearchTimer = setTimeout(() => {
      const items = doctorQuery(q);
      showDoctorSuggest(items);
    }, 120);
  });

  document.addEventListener('click', (ev) => {
    const box = $('doctorSuggest');
    const search = $('doctorSearch');
    if (!box || !search) return;
    if (!box.contains(ev.target) && ev.target !== search) box.style.display = 'none';
  });

  $('reportForm')?.addEventListener('submit', async (ev) => {
    ev.preventDefault();

    try {
      const payload = getReportPayload();
      const err = reportClientValidate(payload);
      if (err) { toast(err, 'danger'); return; }

      const btn = $('btnSubmitReport');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status"></span>กำลังบันทึก…';
      }

      await apiPost('submitReport', payload);
      toast('บันทึกข้อมูลสำเร็จ', 'success');
      resetReportForm();

      // best-effort refresh visualization
      try { await loadVisualization(getVizParamsFromUI()); } catch {}

    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      const btn = $('btnSubmitReport');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-floppy-disk me-2"></i>บันทึก';
      }
    }
  });

  // Admin verify
  $('btnValidateAdmin')?.addEventListener('click', validateAdmin);

  // Manage actions
  $('btnReloadManage')?.addEventListener('click', async () => {
    try { await loadManage(); toast('โหลดข้อมูลในระบบสำเร็จ', 'success'); } catch (e) { toast(e.message, 'danger'); }
  });

  $('btnAddDoctor')?.addEventListener('click', () => {
    try { requireAdminClient(); openDoctorModal(null); } catch (e) { toast(e.message, 'danger'); }
  });
  $('btnAddStaff')?.addEventListener('click', () => {
    try { requireAdminClient(); openStaffModal(null); } catch (e) { toast(e.message, 'danger'); }
  });
  $('btnAddDept')?.addEventListener('click', () => {
    try { requireAdminClient(); openDeptModal(null); } catch (e) { toast(e.message, 'danger'); }
  });

  $('btnSaveDoctor')?.addEventListener('click', async () => { try { await saveDoctor(); } catch (e) { toast(e.message, 'danger'); } });
  $('btnSaveStaff')?.addEventListener('click', async () => { try { await saveStaff(); } catch (e) { toast(e.message, 'danger'); } });
  $('btnSaveDept')?.addEventListener('click', async () => { try { await saveDept(); } catch (e) { toast(e.message, 'danger'); } });

  // Viz
  $('btnVizRefresh')?.addEventListener('click', async () => {
    try { await loadVisualization(getVizParamsFromUI()); } catch (e) { toast(e.message, 'danger'); }
  });
  $('btnVizApply')?.addEventListener('click', async () => {
    try { await loadVisualization(getVizParamsFromUI()); } catch (e) { toast(e.message, 'danger'); }
  });
  $('btnVizReset')?.addEventListener('click', async () => {
    if ($('vizStart')) $('vizStart').value = '';
    if ($('vizEnd')) $('vizEnd').value = '';
    if ($('vizDept')) $('vizDept').value = '';
    try { await loadVisualization({}); } catch (e) { toast(e.message, 'danger'); }
  });
  $('btnExportXlsx')?.addEventListener('click', async () => {
    try { await exportXlsx(); } catch (e) { toast(e.message, 'danger'); }
  });

  // API settings modal
  const modalEl = document.getElementById('modalApi');
  const apiModal = modalEl ? new bootstrap.Modal(modalEl) : null;

  $('btnApiSettings')?.addEventListener('click', () => {
    if (!apiModal) return;
    $('apiUrlInput').value = getApiUrl_();
    apiModal.show();
  });

  $('btnSaveApiUrl')?.addEventListener('click', async () => {
    if (!apiModal) return;
    const v = setApiUrl_($('apiUrlInput').value);
    apiModal.hide();
    if (!v) {
      toast('กรุณาใส่ Web App URL ให้ถูกต้อง', 'danger');
      return;
    }
    toast('บันทึก Web App URL แล้ว', 'success');
    await safeInitialLoad_();
  });

  async function safeInitialLoad_() {
    try {
      if (!getApiUrl_()) {
        if (apiModal) apiModal.show();
        return;
      }
      await loadReferenceData();
      toast('โหลด Reference สำเร็จ', 'success');
      await loadManage();
      await loadVisualization({});
    } catch (e) {
      toast(e.message || 'เชื่อมต่อ API ไม่สำเร็จ', 'danger');
    }
  }

  // Initial load
  await safeInitialLoad_();
}

function getVizParamsFromUI() {
  return {
    startDate: $('vizStart')?.value || '',
    endDate: $('vizEnd')?.value || '',
    department: $('vizDept')?.value || '',
  };
}

document.addEventListener('DOMContentLoaded', init);
