/* Prescribing Error GH Pages Frontend
 * Configure API_URL after deploying Apps Script as a Web App.
 * IMPORTANT: use the /exec URL.
 */
const API_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE"; // e.g. https://script.google.com/macros/s/XXXXX/exec

const state = {
  ref: null,
  selectedDoctor: null,
  admin: { staffId: "", role: "Not verified", ok: false, name: "" },
  charts: { dept: null, specialty: null, drugGroup: null, doctor: null, severity: null, month: null },
};

function $(id) { return document.getElementById(id); }

function setText(id, text) { $(id).textContent = text; }

function toast(message, type = "info") {
  const host = $("toastHost");
  const el = document.createElement("div");
  el.className = "toast align-items-center show";
  el.setAttribute("role", "alert");
  el.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">
        <span class="badge rounded-pill me-2 text-bg-${type === "danger" ? "danger" : type === "success" ? "success" : "secondary"}">${type.toUpperCase()}</span>
        ${escapeHtml(message)}
      </div>
      <button type="button" class="btn-close me-2 m-auto" aria-label="Close"></button>
    </div>
  `;
  host.appendChild(el);
  el.querySelector(".btn-close").addEventListener("click", () => el.remove());
  setTimeout(() => { if (el.isConnected) el.remove(); }, 4500);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;"
  }[s]));
}

async function apiGet(action, params = {}) {
  const u = new URL(API_URL);
  u.searchParams.set("action", action);
  u.searchParams.set("t", String(Date.now()));
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || String(v).trim() === "") return;
    u.searchParams.set(k, String(v));
  });

  const res = await fetch(u.toString(), { method: "GET" });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("API returned non-JSON (GET)."); }
  if (!json.success) throw new Error(json.message || "API error");
  return json.data;
}

async function apiPost(action, data = {}) {
  // Avoid preflight: do NOT use application/json
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, data }),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error("API returned non-JSON (POST)."); }
  if (!json.success) throw new Error(json.message || "API error");
  return json.data;
}

function renderOptions(selectEl, options, { placeholder = "-", valueKey = null, labelKey = null } = {}) {
  selectEl.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = placeholder;
  selectEl.appendChild(ph);

  options.forEach((o) => {
    const opt = document.createElement("option");
    if (valueKey && labelKey) {
      opt.value = String(o[valueKey] ?? "");
      opt.textContent = String(o[labelKey] ?? "");
    } else {
      opt.value = String(o);
      opt.textContent = String(o);
    }
    selectEl.appendChild(opt);
  });
}

function fmtDateTime(dt) {
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

async function loadReferenceData() {
  setText("lastSync", "Loading…");
  const ref = await apiGet("getReferenceData");
  state.ref = ref;

  // Dropdown lists
  renderOptions($("prescribingErrorFrom"), ref.lists.prescribingErrorFrom, { placeholder: "เลือก…" });
  renderOptions($("consult"), ref.lists.consultResults, { placeholder: "เลือก…" });
  renderOptions($("errorType"), ref.lists.errorTypes, { placeholder: "เลือก…" });
  renderOptions($("medicationReconciliation"), ref.lists.medicationReconciliation, { placeholder: "เลือก…" });
  renderOptions($("drugGroup"), ref.lists.drugGroups, { placeholder: "เลือก…" });
  renderOptions($("severityLevel"), ref.lists.severityLevels, { placeholder: "เลือก…" });

  // Department
  renderOptions($("department"), ref.departments, { placeholder: "เลือกแผนก…" });

  // Reporter
  const staffOpts = (ref.staff || []).map(s => ({ value: s.staffId, label: `${s.staffId} - ${s.name}` }));
  renderOptions($("reporter"), staffOpts, { placeholder: "เลือกผู้รายงาน…", valueKey: "value", labelKey: "label" });

  // Viz dept filter
  const vizDeptOpts = ["", ...(ref.departments || [])];
  $("vizDept").innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All departments";
  $("vizDept").appendChild(all);
  (ref.departments || []).forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    $("vizDept").appendChild(opt);
  });

  setText("lastSync", fmtDateTime(new Date()));
  toast("โหลดข้อมูลอ้างอิงสำเร็จ", "success");

  // Update doctor modal dept list as well
  renderOptions($("doctorDept"), ref.departments, { placeholder: "-" });
}

function resetReportForm() {
  $("reportForm").reset();
  $("doctorSuggest").style.display = "none";
  state.selectedDoctor = null;
  $("doctorSearch").value = "";
  $("specialty").value = "";
  $("doctorType").value = "";
}

function getReportPayload() {
  const doctorName = state.selectedDoctor?.name || $("doctorSearch").value.trim();

  return {
    prescribingErrorFrom: $("prescribingErrorFrom").value.trim(),
    hn: $("hn").value.trim(),
    eventDate: $("eventDate").value,
    eventTime: $("eventTime").value,
    department: $("department").value.trim(),
    doctor: doctorName,
    specialty: $("specialty").value.trim(),
    doctorType: $("doctorType").value.trim(),
    errorDetails: $("errorDetails").value.trim(),
    consult: $("consult").value.trim(),
    errorType: $("errorType").value.trim(),
    medicationReconciliation: $("medicationReconciliation").value.trim(),
    reporter: $("reporter").value.trim(),
    drug1: $("drug1").value.trim(),
    drug2: $("drug2").value.trim(),
    drugGroup: $("drugGroup").value.trim(),
    severityLevel: $("severityLevel").value.trim(),
  };
}

function reportClientValidate(payload) {
  const required = [
    ["prescribingErrorFrom", "Prescribing Error จาก"],
    ["hn", "HN"],
    ["eventDate", "วันที่เกิดเหตุการณ์"],
    ["eventTime", "เวลาที่เกิดเหตุการณ์"],
    ["department", "Department"],
    ["doctor", "รายชื่อแพทย์"],
    ["errorDetails", "รายละเอียด"],
    ["consult", "Consult"],
    ["errorType", "ประเภท"],
    ["medicationReconciliation", "Medication reconciliation / Home Med"],
    ["reporter", "ผู้รายงาน"],
    ["drug1", "ยา (ตัวที่ 1)"],
    ["drugGroup", "กลุ่มของยา"],
    ["severityLevel", "Severity"],
  ];

  const missing = required.filter(([k]) => !String(payload[k] || "").trim());
  if (missing.length) return `กรอกข้อมูลไม่ครบ: ${missing.map(([,label]) => label).join(", ")}`;

  const hnOk = /^07-\d{2}-\d{6}$/.test(payload.hn);
  if (!hnOk) return "HN ไม่ถูกต้อง (ต้องเป็น 07-XX-YYYYYY)";

  return null;
}

// ---------------- Doctor typeahead ----------------

let doctorSearchTimer = null;

function showDoctorSuggest(items) {
  const box = $("doctorSuggest");
  box.innerHTML = "";
  if (!items.length) {
    box.style.display = "none";
    return;
  }

  items.forEach(d => {
    const item = document.createElement("div");
    item.className = "item";
    item.innerHTML = `
      <div class="fw-semibold">${escapeHtml(d.name)}</div>
      <div class="sub">${escapeHtml(d.department || "-")} • ${escapeHtml(d.specialty || "-")} • ${escapeHtml(d.type || "-")}</div>
    `;
    item.addEventListener("click", () => {
      state.selectedDoctor = d;
      $("doctorSearch").value = d.name;
      $("specialty").value = d.specialty || "";
      $("doctorType").value = d.type || "";
      box.style.display = "none";
    });
    box.appendChild(item);
  });

  box.style.display = "block";
}

function doctorQuery(q) {
  const ref = state.ref;
  if (!ref?.doctors) return [];
  const query = q.trim().toLowerCase();
  if (!query) return [];

  const deptFilter = $("department").value.trim();
  const list = ref.doctors.filter(d => {
    if (!d?.name) return false;
    // Optional: bias to selected department if user has picked one
    if (deptFilter && String(d.department || "").trim() !== deptFilter) return false;
    return true;
  });

  // Allow searching by name/department/specialty
  const matched = list.filter(d => {
    const hay = `${d.name} ${d.department || ""} ${d.specialty || ""} ${d.type || ""}`.toLowerCase();
    return hay.includes(query);
  });

  return matched.slice(0, 12);
}

// ---------------- Admin verification ----------------

async function validateAdmin() {
  const staffId = $("adminStaffId").value.trim();
  if (!staffId) {
    state.admin = { staffId: "", role: "Not verified", ok: false, name: "" };
    $("adminBadge").className = "badge rounded-pill text-bg-secondary";
    setText("adminBadge", "Not verified");
    return;
  }

  try {
    const data = await apiPost("validateStaff", { staffId });
    state.admin = { staffId, role: data.role, ok: data.ok, name: data.name || "" };
    if (data.ok && data.role === "Admin") {
      $("adminBadge").className = "badge rounded-pill text-bg-success";
      setText("adminBadge", `Admin: ${data.name || staffId}`);
      toast("ยืนยันสิทธิ์ Admin สำเร็จ", "success");
    } else if (data.ok) {
      $("adminBadge").className = "badge rounded-pill text-bg-warning";
      setText("adminBadge", `User: ${data.name || staffId}`);
      toast("StaffID นี้เป็น User (ไม่มีสิทธิ์แก้ไขข้อมูล)", "danger");
    } else {
      $("adminBadge").className = "badge rounded-pill text-bg-danger";
      setText("adminBadge", "Not found");
      toast("ไม่พบ StaffID", "danger");
    }
    toggleManageControls();
  } catch (e) {
    toast(e.message, "danger");
  }
}

function requireAdminClient() {
  if (!state.admin.ok) throw new Error("กรุณาตรวจสอบ Admin StaffID ก่อน");
  if (state.admin.role !== "Admin") throw new Error("สิทธิ์ไม่เพียงพอ: Role ไม่ใช่ Admin");
}

function toggleManageControls() {
  const can = state.admin.ok && state.admin.role === "Admin";
  ["btnAddDoctor", "btnAddStaff", "btnAddDept"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.disabled = !can;
  });
}

// ---------------- Manage Data ----------------

async function loadManage() {
  const [docRes, staffRes, deptRes] = await Promise.all([
    apiGet("listDoctors"),
    apiGet("listStaff"),
    apiGet("listDepartments"),
  ]);

  renderDoctorsTable(docRes.doctors || []);
  renderStaffTable(staffRes.staff || []);
  renderDeptTable(deptRes.departments || []);

  // keep reference data in sync for dropdowns/search
  state.ref.doctors = docRes.doctors || [];
  state.ref.staff = staffRes.staff || [];
  state.ref.departments = (deptRes.departments || []).map(d => d.department);
  await loadReferenceData(); // re-render selects with latest

  toggleManageControls();
}

function renderDoctorsTable(doctors) {
  const tb = $("tblDoctors");
  tb.innerHTML = "";
  doctors.forEach(d => {
    const tr = document.createElement("tr");
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
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openDoctorModal(d));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteDoctor(d));
    tb.appendChild(tr);
  });
}

function renderStaffTable(staff) {
  const tb = $("tblStaff");
  tb.innerHTML = "";
  staff.forEach(s => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(s.staffId)}</td>
      <td>${escapeHtml(s.name)}</td>
      <td><span class="badge text-bg-${s.role === "Admin" ? "primary" : "secondary"}">${escapeHtml(s.role)}</span></td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary me-1" data-act="edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-act="del"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;
    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openStaffModal(s));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteStaff(s));
    tb.appendChild(tr);
  });
}

function renderDeptTable(depts) {
  const tb = $("tblDept");
  tb.innerHTML = "";
  // If API returns plain strings, wrap
  (depts || []).forEach((d, idx) => {
    const name = typeof d === "string" ? d : d.department;
    const id = typeof d === "string" ? null : d.id;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(name)}</td>
      <td class="text-end">
        <button class="btn btn-sm btn-outline-secondary me-1" data-act="edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button class="btn btn-sm btn-outline-danger" data-act="del"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;

    tr.querySelector('[data-act="edit"]').addEventListener("click", () => openDeptModal({ id, department: name }));
    tr.querySelector('[data-act="del"]').addEventListener("click", () => deleteDept({ id, department: name }));
    tb.appendChild(tr);
  });
}

// --- Modals (Doctors) ---

let modalDoctor, modalStaff, modalDept;

function openDoctorModal(doctor = null) {
  $("doctorId").value = doctor?.id || "";
  $("doctorName").value = doctor?.name || "";
  $("doctorDept").value = doctor?.department || "";
  $("doctorSpec").value = doctor?.specialty || "";
  $("doctorTypeModal").value = doctor?.type || "";
  setText("modalDoctorTitle", doctor ? "Edit Doctor" : "Add Doctor");
  modalDoctor.show();
}

async function saveDoctor() {
  requireAdminClient();

  const doc = {
    id: $("doctorId").value ? Number($("doctorId").value) : undefined,
    name: $("doctorName").value.trim(),
    department: $("doctorDept").value.trim(),
    specialty: $("doctorSpec").value.trim(),
    type: $("doctorTypeModal").value.trim(),
  };

  if (!doc.name) throw new Error("Doctor name is required.");

  if (doc.id) {
    await apiPost("updateDoctor", { adminStaffId: state.admin.staffId, id: doc.id, doctor: doc });
    toast("แก้ไข Doctor สำเร็จ", "success");
  } else {
    await apiPost("addDoctor", { adminStaffId: state.admin.staffId, doctor: doc });
    toast("เพิ่ม Doctor สำเร็จ", "success");
  }
  modalDoctor.hide();
  await loadManage();
}

async function deleteDoctor(doctor) {
  try {
    requireAdminClient();
    if (!confirm(`ลบ Doctor: ${doctor.name} ?`)) return;
    await apiPost("deleteDoctor", { adminStaffId: state.admin.staffId, id: doctor.id });
    toast("ลบ Doctor สำเร็จ", "success");
    await loadManage();
  } catch (e) {
    toast(e.message, "danger");
  }
}

// --- Modals (Staff) ---

function openStaffModal(staff = null) {
  $("staffRowId").value = staff?.id || "";
  $("staffIdInput").value = staff?.staffId || "";
  $("staffNameInput").value = staff?.name || "";
  $("staffRoleInput").value = staff?.role || "User";
  setText("modalStaffTitle", staff ? "Edit Staff" : "Add Staff");
  modalStaff.show();
}

async function saveStaff() {
  requireAdminClient();

  const st = {
    id: $("staffRowId").value ? Number($("staffRowId").value) : undefined,
    staffId: $("staffIdInput").value.trim(),
    name: $("staffNameInput").value.trim(),
    role: $("staffRoleInput").value.trim(),
  };

  if (!st.staffId || !st.name) throw new Error("StaffID and Name are required.");

  if (st.id) {
    await apiPost("updateStaff", { adminStaffId: state.admin.staffId, id: st.id, staff: st });
    toast("แก้ไข Staff สำเร็จ", "success");
  } else {
    await apiPost("addStaff", { adminStaffId: state.admin.staffId, staff: st });
    toast("เพิ่ม Staff สำเร็จ", "success");
  }
  modalStaff.hide();
  await loadManage();
}

async function deleteStaff(staff) {
  try {
    requireAdminClient();
    if (!confirm(`ลบ Staff: ${staff.staffId} - ${staff.name} ?`)) return;
    await apiPost("deleteStaff", { adminStaffId: state.admin.staffId, id: staff.id });
    toast("ลบ Staff สำเร็จ", "success");
    await loadManage();
  } catch (e) {
    toast(e.message, "danger");
  }
}

// --- Modals (Department) ---

function openDeptModal(dept = null) {
  $("deptRowId").value = dept?.id || "";
  $("deptNameInput").value = dept?.department || "";
  setText("modalDeptTitle", dept ? "Edit Department" : "Add Department");
  modalDept.show();
}

async function saveDept() {
  requireAdminClient();

  const dept = {
    id: $("deptRowId").value ? Number($("deptRowId").value) : undefined,
    department: $("deptNameInput").value.trim(),
  };

  if (!dept.department) throw new Error("Department is required.");

  if (dept.id) {
    await apiPost("updateDepartment", { adminStaffId: state.admin.staffId, id: dept.id, department: dept.department });
    toast("แก้ไข Department สำเร็จ", "success");
  } else {
    await apiPost("addDepartment", { adminStaffId: state.admin.staffId, department: dept.department });
    toast("เพิ่ม Department สำเร็จ", "success");
  }
  modalDept.hide();
  await loadManage();
}

async function deleteDept(dept) {
  try {
    requireAdminClient();
    if (!confirm(`ลบ Department: ${dept.department} ?`)) return;


    await apiPost("deleteDepartment", { adminStaffId: state.admin.staffId, id: dept.id });
    toast("ลบ Department สำเร็จ", "success");
    await loadManage();
  } catch (e) {
    toast(e.message, "danger");
  }
}

// ---------------- Visualization ----------------

async function loadVisualization(params = {}) {
  const data = await apiPost("getVisualization", params);

  // Stats
  setText("statTotal", String(data.stats.totalReports ?? "-"));
  setText("statMonth", String(data.stats.monthReports ?? "-"));
  setText("statConsult", `${data.stats.consultAdjustPct ?? 0}%`);
  setText("statFT", `${data.stats.fulltimePct ?? 0}%`);

  // Charts
  renderDeptChart(data.charts.byDepartment || []);
  renderSpecialtyChart(data.charts.bySpecialty || []);
  renderDrugGroupChart(data.charts.byDrugGroup || []);
  renderDoctorChart(data.charts.byDoctor || []);
  renderSeverityChart(data.charts.bySeverity || []);
  renderMonthChart(data.charts.byMonth || []);
}

function destroyChart(c) { try { c?.destroy(); } catch {} }

function renderDeptChart(series) {
  destroyChart(state.charts.dept);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.dept = new Chart($("chartDept"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Reports", data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { autoSkip: true, maxRotation: 45, minRotation: 0 } } }
    }
  });
}


function renderSpecialtyChart(series) {
  destroyChart(state.charts.specialty);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.specialty = new Chart($("chartSpecialty"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Reports", data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { ticks: { autoSkip: true } }, x: { beginAtZero: true } },
    },
  });
}

function renderDrugGroupChart(series) {
  destroyChart(state.charts.drugGroup);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.drugGroup = new Chart($("chartDrugGroup"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Reports", data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      indexAxis: "y",
      scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false } } },
    },
  });
}

function renderDoctorChart(series) {
  destroyChart(state.charts.doctor);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.doctor = new Chart($("chartDoctor"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Reports", data: values }] },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      indexAxis: "y",
      scales: { x: { beginAtZero: true }, y: { ticks: { autoSkip: false } } },
    },
  });
}

function renderSeverityChart(series) {
  destroyChart(state.charts.severity);
  const labels = series.map(x => x.label);
  const values = series.map(x => x.count);

  state.charts.severity = new Chart($("chartSeverity"), {
    type: "doughnut",
    data: { labels, datasets: [{ data: values }] },
    options: { responsive: true, plugins: { legend: { position: "bottom" } } }
  });
}

function renderMonthChart(series) {
  destroyChart(state.charts.month);
  const labels = series.map(x => x.period);
  const values = series.map(x => x.count);

  state.charts.month = new Chart($("chartMonth"), {
    type: "line",
    data: { labels, datasets: [{ label: "Reports", data: values, tension: 0.25 }] },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });
}

// ---------------- Init ----------------

async function init() {
  $("apiUrlText").textContent = API_URL;

  // Modals
  modalDoctor = new bootstrap.Modal($("modalDoctor"));
  modalStaff = new bootstrap.Modal($("modalStaff"));
  modalDept = new bootstrap.Modal($("modalDept"));

  // Events: reference reload
  $("btnReloadRef").addEventListener("click", async () => {
    try { await loadReferenceData(); } catch (e) { toast(e.message, "danger"); }
  });

  $("btnPing").addEventListener("click", async () => {
    try {
      await apiGet("getReferenceData");
      toast("Ping OK", "success");
    } catch (e) {
      toast(e.message, "danger");
    }
  });

  // Report form
  $("btnResetReport").addEventListener("click", resetReportForm);

  $("department").addEventListener("change", () => {
    // Clear doctor selection when department changes (avoid mismatch)
    state.selectedDoctor = null;
    $("doctorSearch").value = "";
    $("specialty").value = "";
    $("doctorType").value = "";
    $("doctorSuggest").style.display = "none";
  });

  $("doctorSearch").addEventListener("input", (ev) => {
    const q = ev.target.value;
    state.selectedDoctor = null;
    $("specialty").value = "";
    $("doctorType").value = "";

    clearTimeout(doctorSearchTimer);
    doctorSearchTimer = setTimeout(() => {
      const items = doctorQuery(q);
      showDoctorSuggest(items);
    }, 120);
  });

  document.addEventListener("click", (ev) => {
    const box = $("doctorSuggest");
    if (!box.contains(ev.target) && ev.target !== $("doctorSearch")) box.style.display = "none";
  });

  $("reportForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      const payload = getReportPayload();
      const err = reportClientValidate(payload);
      if (err) { toast(err, "danger"); return; }

      $("btnSubmitReport").disabled = true;
      $("btnSubmitReport").innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status"></span>กำลังบันทึก…`;

      await apiPost("submitReport", payload);

      toast("บันทึกข้อมูลสำเร็จ", "success");
      resetReportForm();

      // refresh visualization quickly (best-effort)
      try { await loadVisualization(getVizParamsFromUI()); } catch {}
    } catch (e) {
      toast(e.message, "danger");
    } finally {
      $("btnSubmitReport").disabled = false;
      $("btnSubmitReport").innerHTML = `<i class="fa-solid fa-floppy-disk me-2"></i>บันทึก`;
    }
  });

  // Admin verify
  $("btnValidateAdmin").addEventListener("click", validateAdmin);

  // Manage actions
  $("btnReloadManage").addEventListener("click", async () => {
    try { await loadManage(); } catch (e) { toast(e.message, "danger"); }
  });
  $("btnAddDoctor").addEventListener("click", () => {
    try { requireAdminClient(); openDoctorModal(null); } catch (e) { toast(e.message, "danger"); }
  });
  $("btnAddStaff").addEventListener("click", () => {
    try { requireAdminClient(); openStaffModal(null); } catch (e) { toast(e.message, "danger"); }
  });
  $("btnAddDept").addEventListener("click", () => {
    try { requireAdminClient(); openDeptModal(null); } catch (e) { toast(e.message, "danger"); }
  });

  $("btnSaveDoctor").addEventListener("click", async () => { try { await saveDoctor(); } catch (e) { toast(e.message, "danger"); } });
  $("btnSaveStaff").addEventListener("click", async () => { try { await saveStaff(); } catch (e) { toast(e.message, "danger"); } });
  $("btnSaveDept").addEventListener("click", async () => { try { await saveDept(); } catch (e) { toast(e.message, "danger"); } });

  // Viz
  $("btnVizRefresh").addEventListener("click", async () => {
    try { await loadVisualization(getVizParamsFromUI()); } catch (e) { toast(e.message, "danger"); }
  });
  $("btnVizApply").addEventListener("click", async () => {
    try { await loadVisualization(getVizParamsFromUI()); } catch (e) { toast(e.message, "danger"); }
  });
  $("btnVizReset").addEventListener("click", async () => {
    $("vizStart").value = "";
    $("vizEnd").value = "";
    $("vizDept").value = "";
    try { await loadVisualization({}); } catch (e) { toast(e.message, "danger"); }
  });

  // Initial load
  if (API_URL.includes("PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE")) {
    toast("กรุณาแก้ไข API_URL ใน assets/js/app.js ให้เป็น Web App URL ของ Apps Script ก่อนใช้งาน", "danger");
    return;
  }

  try {
    await loadReferenceData();
    await loadManage();
    await loadVisualization({});
  } catch (e) {
    toast(e.message, "danger");
  }
}

function getVizParamsFromUI() {
  return {
    startDate: $("vizStart").value || "",
    endDate: $("vizEnd").value || "",
    department: $("vizDept").value || "",
  };
}

document.addEventListener("DOMContentLoaded", init);
