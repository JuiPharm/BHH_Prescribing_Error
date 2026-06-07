/**
 * BHH Prescribing Error Reporting API
 * Backend: Google Apps Script + Google Sheets database
 * Compatible with GitHub Pages frontend using JSONP GET + text/plain POST/no-cors fallback.
 * Version: gas-sheet-fixed-source-error-type-v6-after-recovery-2026-06-07
 *
 * Required Script Property for standalone script:
 *   SHEET_ID = <Google Sheet ID>
 * If this script is bound to the target Google Sheet, SHEET_ID is optional.
 */

const APP_VERSION = 'gas-sheet-fixed-source-error-type-v6-after-recovery-2026-06-07';


// Fixed business rules for data written to Google Sheets.
// HN is always stored as text and must be in canonical format 07-XX-XXXXXX.
// StaffID / ReporterStaffID are always stored as text and must contain exactly 6 alphanumeric characters.
// PrescribingErrorFrom must be one of the 3 approved source values below.
// Error type dropdown must include the 4 requested values below in addition to existing values.
const HN_PATTERN = /^07-\d{2}-\d{6}$/;
const STAFF_ID_PATTERN = /^[A-Za-z0-9]{6}$/;
const REQUIRED_PRESCRIBING_ERROR_FROM = [
  'IV CHEMO',
  'OPD PHARMACY',
  'IPD PHARMACY'
];

const REQUIRED_ERROR_TYPES = [
  'Wrong quantity',
  'Incomplete order',
  'Wrong Route',
  'Wrong Dosage from'
];

const SHEET_NAMES = {
  departments: 'department',
  staff: 'Staff',
  doctors: 'Doctor',
  medications: 'Medication',
  lists: 'Lists',
  reports: 'PrescribingErrors',
  audit: 'AuditLog'
};

const HEADERS = {
  department: ['Department'],
  Staff: ['StaffID', 'Name', 'Role'],
  Doctor: ['Name', 'Department', 'Specialty', 'Type'],
  Medication: ['GenericName', 'BrandName', 'Form', 'DisplayName', 'DrugGroup', 'Subclass'],
  Lists: ['Category', 'Value', 'SortOrder'],
  PrescribingErrors: [
    'Timestamp', 'ReportID', 'PrescribingErrorFrom', 'HN', 'EventDate', 'EventTime',
    'Department', 'Doctor', 'Specialty', 'DoctorType', 'ErrorDetails', 'Consult',
    'ErrorType', 'MedicationReconciliation', 'ReporterStaffID', 'Drug1', 'Drug2',
    'DrugGroup', 'Subclass', 'SeverityLevel', 'CreatedBy', 'ClientVersion', 'UserAgent'
  ],
  AuditLog: ['Timestamp', 'Actor', 'Action', 'EntityType', 'EntityId', 'Before', 'After', 'Result', 'Message']
};

const DEFAULT_LISTS = {
  prescribingErrorFrom: REQUIRED_PRESCRIBING_ERROR_FROM,
  consultResults: ['ปรับแผน', 'ยืนยันเดิม', 'ไม่ได้ Consult'],
  errorTypes: REQUIRED_ERROR_TYPES.concat([
    'Wrong drug', 'Wrong dose', 'Wrong frequency', 'Wrong route', 'Wrong duration',
    'Omission', 'Duplication', 'Allergy', 'Contraindication', 'Drug interaction',
    'Renal dose adjustment', 'Medication reconciliation', 'Other'
  ]),
  medicationReconciliation: ['Med Rec Admission', 'Med Rec Transfer', 'Med Rec Discharge', 'Home Med', 'None of Above'],
  drugGroups: ['Antibiotics', 'Antihypertensive', 'Anticoagulant/Antiplatelet', 'Antidiabetic', 'CNS', 'Analgesic', 'GI', 'Respiratory', 'Other'],
  subclasses: ['Penicillin', 'Cephalosporin', 'Beta-blocker', 'ACEI/ARB', 'DOAC', 'Insulin', 'Opioid', 'PPI', 'Other'],
  severityLevels: ['A-B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
};

const DEFAULT_DEPARTMENTS = [
  'Ward 5', 'Ward 6', 'Ward 7', 'Ward 8', 'Ward 9', 'Ward 10', 'Ward 11', 'Ward 12',
  'ICU', 'OR', 'CathLab', 'Nursery', 'LR', 'OPD MED', 'OPD OBG', 'OPD PED', 'ER',
  'OPD HEART', 'BREAST Clinic', 'OPD ORTHO', 'OPD SURGERY', 'VACCINE Clinic',
  'WELLNESS Center', 'OPD Neuro', 'DENTAL', 'OPD GI', 'HEMATOLOGY', 'OPD EYE',
  'OPD ENT', 'Rehabilitation'
];

const LIST_CATEGORY_ALIASES = {
  prescribingerrorfrom: 'prescribingErrorFrom',
  source: 'prescribingErrorFrom',
  sources: 'prescribingErrorFrom',
  consult: 'consultResults',
  consultresults: 'consultResults',
  errortype: 'errorTypes',
  errortypes: 'errorTypes',
  medicationreconciliation: 'medicationReconciliation',
  process: 'medicationReconciliation',
  druggroup: 'drugGroups',
  druggroups: 'drugGroups',
  subclass: 'subclasses',
  subclasses: 'subclasses',
  severity: 'severityLevels',
  severitylevel: 'severityLevels',
  severitylevels: 'severityLevels'
};

/** Initial setup. Run this once after attaching the script to a spreadsheet. */
function setup() {
  const ss = getSpreadsheet_();
  ensureAllSheets_();
  seedDefaultData_();
  syncFixedListCategories_();
  applyPlainTextFormats_();
  logAudit_('system', 'setup', 'System', ss.getId(), '', '', 'OK', 'Setup completed');
  return { ok: true, version: APP_VERSION, spreadsheetId: ss.getId(), url: ss.getUrl() };
}

/** Alias for setup, convenient from Apps Script Run menu. */
function install() {
  return setup();
}

/** Run once if existing data was previously stored as number/date instead of text. */
function migrateTextFieldsAndLists() {
  ensureAllSheets_();
  syncFixedListCategories_();
  applyPlainTextFormats_();
  normalizeExistingStaffIds_();
  normalizeExistingReportTextFields_();
  logAudit_('system', 'migrateTextFieldsAndLists', 'System', getSpreadsheet_().getId(), '', '', 'OK', 'Text fields and fixed lists migrated');
  return { ok: true, version: APP_VERSION, message: 'Migration completed' };
}


/**
 * Recover failed submitReport rows from AuditLog into PrescribingErrors.
 * Use when AuditLog has ERROR rows caused by the old lock bug:
 *   Cannot read properties of null (reading 'waitLock')
 *
 * How to run:
 *   1) Save this Code.gs
 *   2) Run setup()
 *   3) Run recoverAuditLogErrorsToPrescribingErrors()
 *
 * The function is idempotent: it builds a fingerprint from the report fields and
 * skips rows that are already in PrescribingErrors or duplicated in AuditLog.
 */
function recoverAuditLogErrorsToPrescribingErrors(options) {
  options = options || {};
  ensureAllSheets_();
  syncFixedListCategories_();
  applyPlainTextFormats_();

  const lock = getSafeLock_();
  lock.waitLock(30000);

  const summary = {
    ok: true,
    version: APP_VERSION,
    scanned: 0,
    recovered: 0,
    skipped: 0,
    failed: 0,
    recoveredReportIds: [],
    failures: []
  };

  try {
    const auditSheet = getSheet_(SHEET_NAMES.audit);
    const auditHeaders = getHeaders_(auditSheet);
    if (auditSheet.getLastRow() < 2) return summary;

    const values = auditSheet.getRange(2, 1, auditSheet.getLastRow() - 1, auditHeaders.length).getValues();
    const existing = buildExistingReportFingerprintSet_();
    const batchSeen = {};

    values.forEach(function (row, i) {
      const auditRowNo = i + 2;
      const auditObj = {};
      auditHeaders.forEach(function (h, c) { auditObj[h] = row[c]; });

      try {
        const action = String(val_(auditObj, 'Action') || '').trim();
        const entityId = String(val_(auditObj, 'EntityId') || '').trim();
        const result = String(val_(auditObj, 'Result') || '').trim();
        const message = String(val_(auditObj, 'Message') || '').trim();

        // Recover only failed submitReport records. By default, focus on the waitLock error.
        if (normalize_(result) !== 'error') { summary.skipped++; return; }
        if (normalize_(action) !== 'dopost.error') { summary.skipped++; return; }
        if (entityId && normalize_(entityId) !== 'submitreport') { summary.skipped++; return; }
        if (options.onlyWaitLock !== false && message && message.indexOf('waitLock') === -1) { summary.skipped++; return; }

        summary.scanned++;

        const payload = parseJsonObjectFromAuditText_(val_(auditObj, 'After') || val_(auditObj, 'Before'));
        if (!payload) {
          summary.skipped++;
          return;
        }

        normalizeLegacyAuditPayload_(payload);
        const p = normalizeReportPayload_(payload);
        validateReport_(p);

        const fp = reportFingerprint_(p);
        if (existing[fp] || batchSeen[fp]) {
          summary.skipped++;
          return;
        }

        const reportId = appendRecoveredReport_(p, auditRowNo);
        existing[fp] = true;
        batchSeen[fp] = true;
        summary.recovered++;
        summary.recoveredReportIds.push(reportId);
      } catch (err) {
        summary.failed++;
        summary.failures.push({ auditRow: auditRowNo, message: errorMessage_(err) });
      }
    });

    logAudit_('system', 'recoverAuditLogErrorsToPrescribingErrors', 'PrescribingErrors', 'batch', '', JSON.stringify(summary), summary.failed ? 'PARTIAL' : 'OK', 'Recovered failed AuditLog submitReport rows');
    return summary;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function appendRecoveredReport_(p, auditRowNo) {
  const sheet = getSheet_(SHEET_NAMES.reports);
  const headers = getHeaders_(sheet);
  const reportId = nextReportId_();
  const now = new Date();
  const obj = {
    Timestamp: now,
    ReportID: reportId,
    PrescribingErrorFrom: p.prescribingErrorFrom,
    HN: p.hn,
    EventDate: p.eventDate,
    EventTime: p.eventTime,
    Department: p.department,
    Doctor: p.doctor,
    Specialty: p.specialty,
    DoctorType: p.doctorType,
    ErrorDetails: p.errorDetails,
    Consult: p.consult,
    ErrorType: p.errorType,
    MedicationReconciliation: p.medicationReconciliation,
    ReporterStaffID: p.reporterStaffId,
    Drug1: p.drug1,
    Drug2: p.drug2,
    DrugGroup: p.drugGroup,
    Subclass: p.subclass,
    SeverityLevel: p.severityLevel,
    CreatedBy: 'Recovered from AuditLog row ' + auditRowNo,
    ClientVersion: p.clientVersion || 'auditlog-recovery',
    UserAgent: p.userAgent || ''
  };

  const targetRow = sheet.getLastRow() + 1;
  applyPlainTextForRow_(sheet, headers, targetRow, ['ReportID', 'HN', 'ReporterStaffID']);
  sheet.getRange(targetRow, 1, 1, headers.length).setValues([headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; })]);
  logAudit_(obj.ReporterStaffID, 'recoverAuditLog.row', 'PrescribingErrors', reportId, 'AuditLog row ' + auditRowNo, JSON.stringify(obj), 'OK', 'Recovered from failed AuditLog payload');
  return reportId;
}

function buildExistingReportFingerprintSet_() {
  const set = {};
  getRows_(SHEET_NAMES.reports).forEach(function (r) {
    const p = {
      hn: val_(r, 'HN'),
      eventDate: val_(r, 'EventDate'),
      eventTime: val_(r, 'EventTime'),
      department: val_(r, 'Department'),
      doctor: val_(r, 'Doctor'),
      drug1: val_(r, 'Drug1'),
      drug2: val_(r, 'Drug2'),
      errorDetails: val_(r, 'ErrorDetails'),
      reporterStaffId: val_(r, 'ReporterStaffID')
    };
    const fp = reportFingerprint_(p);
    if (fp) set[fp] = true;
  });
  return set;
}

function parseJsonObjectFromAuditText_(text) {
  const s = String(text === undefined || text === null ? '' : text).trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch (_) {}
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

function normalizeLegacyAuditPayload_(p) {
  if (!p || typeof p !== 'object') return p;

  // Old frontend sent these 2 duplicated values. Convert them to the approved list.
  const source = String(p.prescribingErrorFrom || '').trim();
  const sourceKey = normalizeKey_(source);
  if (sourceKey === 'opdpharmacypharmacy') p.prescribingErrorFrom = 'OPD PHARMACY';
  if (sourceKey === 'ipdpharmacypharmacy') p.prescribingErrorFrom = 'IPD PHARMACY';

  // Support old field names if they appear in older AuditLog rows.
  if (!p.reporter && p.reporterStaffID) p.reporter = p.reporterStaffID;
  if (!p.reporter && p.reporterStaffId) p.reporter = p.reporterStaffId;
  if (!p.severityLevel && p.severity) p.severityLevel = p.severity;
  if (!p.medicationReconciliation && p.process) p.medicationReconciliation = p.process;

  return p;
}

/** JSONP/GET endpoint for GitHub Pages frontend. */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const callback = params.callback || '';
  try {
    const action = String(params.action || 'health').trim();
    const data = parseGetData_(params);
    const result = dispatch_(action, data, params);
    return output_({ success: true, data: result }, callback);
  } catch (err) {
    logAuditSafe_('system', 'doGet.error', 'API', params.action || '', '', '', 'ERROR', err);
    return output_({ success: false, message: errorMessage_(err), version: APP_VERSION }, callback);
  }
}

/** POST endpoint for form submission / admin actions. */
function doPost(e) {
  let action = '';
  let data = {};
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const json = JSON.parse(body || '{}');
    action = String(json.action || (e.parameter && e.parameter.action) || '').trim();
    data = json.data || json.payload || {};
    const result = dispatch_(action, data, (e && e.parameter) || {});
    return output_({ success: true, data: result }, '');
  } catch (err) {
    logAuditSafe_('system', 'doPost.error', 'API', action, '', JSON.stringify(data || {}), 'ERROR', err);
    return output_({ success: false, message: errorMessage_(err), version: APP_VERSION }, '');
  }
}

function dispatch_(action, data, params) {
  ensureAllSheets_();
  switch (action) {
    case 'health':
      return health_();
    case 'setup':
      return setup();
    case 'getReferenceData':
      return getReferenceData_();

    // Backward-compatible aliases for older frontend versions.
    case 'listStaff':
      return getReferenceData_().staff;
    case 'listDoctors':
      return getReferenceData_().doctors;
    case 'listDepartments':
      return getReferenceData_().departments;
    case 'validateStaff':
      return validateStaff_(data.staffId || data.staffID || params.staffId || params.staffID || '');
    case 'getMedicationIndex':
      return getMedicationIndex_();
    case 'getVisualization':
      return getVisualization_(data || params || {});
    case 'getManageData':
      return getManageData_();
    case 'verifyAdmin':
      return verifyAdmin_(data.staffId || params.staffId || '');
    case 'submitReport':
      return submitReport_(data || {});
    case 'recoverAuditLogErrors':
      return recoverAuditLogErrorsToPrescribingErrors(data || {});
    case 'saveDoctor':
      return saveDoctor_(data || {});
    case 'deleteDoctor':
      return deleteDoctor_(data || {});
    case 'saveStaff':
      return saveStaff_(data || {});
    case 'deleteStaff':
      return deleteStaff_(data || {});
    case 'saveDepartment':
      return saveDepartment_(data || {});
    case 'deleteDepartment':
      return deleteDepartment_(data || {});
    case 'uploadDoctors':
      return uploadData_(SHEET_NAMES.doctors, data || {});
    case 'uploadMedications':
      return uploadData_(SHEET_NAMES.medications, data || {});
    default:
      throw new Error('Unknown action: ' + action);
  }
}

function health_() {
  const ss = getSpreadsheet_();
  return {
    ok: true,
    version: APP_VERSION,
    spreadsheetId: ss.getId(),
    spreadsheetName: ss.getName(),
    time: new Date().toISOString()
  };
}

function getReferenceData_() {
  let cache;
  try { cache = CacheService.getScriptCache(); } catch(_) {}
  if (cache) {
    const cached = cache.get('pe_ref_data');
    if (cached) {
      try { return JSON.parse(cached); } catch(_) {}
    }
  }

  const departments = getColumnValues_(SHEET_NAMES.departments, 'Department');
  const doctors = getRows_(SHEET_NAMES.doctors).map(function (r) {
    return {
      name: val_(r, 'Name'),
      department: val_(r, 'Department'),
      specialty: val_(r, 'Specialty'),
      type: val_(r, 'Type')
    };
  }).filter(function (r) { return r.name; });
  const staff = getRows_(SHEET_NAMES.staff).map(function (r) {
    return {
      staffId: val_(r, 'StaffID'),
      name: val_(r, 'Name'),
      role: val_(r, 'Role') || 'User'
    };
  }).filter(function (r) { return r.staffId && r.name; });
  const lists = getLists_();
  const medItems = getMedicationRows_();
  lists.drugGroups = uniqueSorted_((lists.drugGroups || []).concat(medItems.map(function (m) { return m.drugGroup; })));
  lists.subclasses = uniqueSorted_((lists.subclasses || []).concat(medItems.map(function (m) { return m.subclass; })));
  lists.generics = uniqueSorted_(medItems.map(function (m) { return m.genericName; }));
  
  const result = {
    departments: departments,
    doctors: doctors,
    staff: staff,
    lists: lists,
    version: APP_VERSION,
    lastSync: new Date().toISOString()
  };

  if (cache) {
    try {
      const json = JSON.stringify(result);
      if (json.length < 90000) cache.put('pe_ref_data', json, 900);
    } catch(_) {}
  }
  
  return result;
}

function getMedicationIndex_() {
  return {
    items: getMedicationRows_(),
    version: APP_VERSION,
    lastSync: new Date().toISOString()
  };
}

function getManageData_() {
  const ref = getReferenceData_();
  return {
    doctors: ref.doctors,
    staff: ref.staff,
    departments: ref.departments,
    medications: getMedicationRows_()
  };
}

function verifyAdmin_(staffId) {
  const id = normalizeStaffId_(staffId);
  if (!id || !STAFF_ID_PATTERN.test(id)) return { ok: false, staffId: id || '', name: '', role: '' };
  const rows = getRows_(SHEET_NAMES.staff);
  const hit = rows.find(function (r) { return same_(val_(r, 'StaffID'), id); });
  const role = hit ? val_(hit, 'Role') : '';
  return {
    ok: normalize_(role) === 'admin',
    staffId: id,
    name: hit ? val_(hit, 'Name') : '',
    role: role || ''
  };
}


function validateStaff_(staffId) {
  const id = normalizeStaffId_(staffId);
  if (!id || !STAFF_ID_PATTERN.test(id)) return { ok: false, staffId: id || '', name: '', role: '', message: 'StaffID ต้องเป็น Text 6 ตัวอักษร' };
  const rows = getRows_(SHEET_NAMES.staff);
  const hit = rows.find(function (r) { return same_(val_(r, 'StaffID'), id); });
  if (!hit) return { ok: false, staffId: id, name: '', role: '', message: 'ไม่พบ StaffID' };
  return {
    ok: true,
    staffId: id,
    name: val_(hit, 'Name'),
    role: val_(hit, 'Role') || 'User',
    message: 'Staff verified'
  };
}

function submitReport_(payload) {
  const p = normalizeReportPayload_(payload || {});
  validateReport_(p);

  const lock = getSafeLock_();
  lock.waitLock(15000);
  try {
    const sheet = getSheet_(SHEET_NAMES.reports);
    const headers = getHeaders_(sheet);
    const fingerprint = reportFingerprint_(p);
    const duplicate = findRecentDuplicateReport_(fingerprint);
    if (duplicate) {
      logAudit_(p.reporterStaffId, 'submitReport.duplicate', 'PrescribingErrors', duplicate.reportId, '', JSON.stringify(p), 'OK', 'Duplicate ignored by fingerprint');
      return { reportId: duplicate.reportId, duplicate: true };
    }

    const reportId = nextReportId_();
    const now = new Date();
    const obj = {
      Timestamp: now,
      ReportID: reportId,
      PrescribingErrorFrom: p.prescribingErrorFrom,
      HN: p.hn,
      EventDate: p.eventDate,
      EventTime: p.eventTime,
      Department: p.department,
      Doctor: p.doctor,
      Specialty: p.specialty,
      DoctorType: p.doctorType,
      ErrorDetails: p.errorDetails,
      Consult: p.consult,
      ErrorType: p.errorType,
      MedicationReconciliation: p.medicationReconciliation,
      ReporterStaffID: p.reporterStaffId,
      Drug1: p.drug1,
      Drug2: p.drug2,
      DrugGroup: p.drugGroup,
      Subclass: p.subclass,
      SeverityLevel: p.severityLevel,
      CreatedBy: activeUserEmail_(),
      ClientVersion: p.clientVersion,
      UserAgent: p.userAgent
    };
    const targetRow = sheet.getLastRow() + 1;
    applyPlainTextForRow_(sheet, headers, targetRow, ['ReportID', 'HN', 'ReporterStaffID']);
    sheet.getRange(targetRow, 1, 1, headers.length).setValues([headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; })]);
    logAudit_(obj.ReporterStaffID, 'submitReport', 'PrescribingErrors', reportId, '', JSON.stringify(obj), 'OK', 'Report created');
    return { reportId: reportId, duplicate: false };
  } finally {
    lock.releaseLock();
  }
}

function saveDoctor_(payload) {
  requireAdmin_(payload.adminStaffId);
  const obj = {
    Name: String(payload.name || '').trim(),
    Department: String(payload.department || '').trim(),
    Specialty: String(payload.specialty || '').trim(),
    Type: String(payload.type || '').trim()
  };
  if (!obj.Name) throw new Error('Doctor name is required');
  upsertRow_(SHEET_NAMES.doctors, 'Name', payload.originalName || obj.Name, obj);
  logAudit_(payload.adminStaffId, 'saveDoctor', 'Doctor', obj.Name, payload.originalName || '', JSON.stringify(obj), 'OK', 'Doctor saved');
  clearRefCache_();
  return { ok: true, doctor: toDoctor_(obj) };
}

function deleteDoctor_(payload) {
  requireAdmin_(payload.adminStaffId);
  deleteByKey_(SHEET_NAMES.doctors, 'Name', payload.name);
  logAudit_(payload.adminStaffId, 'deleteDoctor', 'Doctor', payload.name, '', '', 'OK', 'Doctor deleted');
  clearRefCache_();
  return { ok: true };
}

function saveStaff_(payload) {
  const adminStaffId = assertStaffId_(payload.adminStaffId, 'Admin StaffID');
  requireAdmin_(adminStaffId);
  const obj = {
    StaffID: assertStaffId_(payload.staffId, 'StaffID'),
    Name: String(payload.name || '').trim(),
    Role: String(payload.role || 'User').trim() || 'User'
  };
  const originalStaffId = payload.originalStaffId ? assertStaffId_(payload.originalStaffId, 'Original StaffID') : obj.StaffID;
  if (!obj.Name) throw new Error('Name is required');
  upsertRow_(SHEET_NAMES.staff, 'StaffID', originalStaffId, obj);
  logAudit_(adminStaffId, 'saveStaff', 'Staff', obj.StaffID, originalStaffId || '', JSON.stringify(obj), 'OK', 'Staff saved');
  clearRefCache_();
  return { ok: true, staff: { staffId: obj.StaffID, name: obj.Name, role: obj.Role } };
}

function deleteStaff_(payload) {
  const adminStaffId = assertStaffId_(payload.adminStaffId, 'Admin StaffID');
  const staffId = assertStaffId_(payload.staffId, 'StaffID');
  requireAdmin_(adminStaffId);
  if (same_(staffId, adminStaffId)) throw new Error('ไม่สามารถลบ Admin ที่กำลังใช้งานได้');
  deleteByKey_(SHEET_NAMES.staff, 'StaffID', staffId);
  logAudit_(adminStaffId, 'deleteStaff', 'Staff', staffId, '', '', 'OK', 'Staff deleted');
  clearRefCache_();
  return { ok: true };
}

function saveDepartment_(payload) {
  requireAdmin_(payload.adminStaffId);
  const department = String(payload.department || '').trim();
  if (!department) throw new Error('Department is required');
  upsertRow_(SHEET_NAMES.departments, 'Department', payload.originalName || department, { Department: department });
  logAudit_(payload.adminStaffId, 'saveDepartment', 'department', department, payload.originalName || '', JSON.stringify({ Department: department }), 'OK', 'Department saved');
  clearRefCache_();
  return { ok: true, department: department };
}

function deleteDepartment_(payload) {
  requireAdmin_(payload.adminStaffId);
  deleteByKey_(SHEET_NAMES.departments, 'Department', payload.department);
  logAudit_(payload.adminStaffId, 'deleteDepartment', 'department', payload.department, '', '', 'OK', 'Department deleted');
  clearRefCache_();
  return { ok: true };
}

function clearRefCache_() {
  try { CacheService.getScriptCache().remove('pe_ref_data'); } catch(_) {}
}

function uploadData_(sheetName, payload) {
  requireAdmin_(payload.adminStaffId);
  const rows = payload.rows;
  if (!Array.isArray(rows) || !rows.length) throw new Error('No data found to upload');
  const sheet = getSheet_(sheetName);
  const headers = HEADERS[sheetName];
  if (!headers) throw new Error('Invalid sheet name for upload');
  
  const newValues = rows.map(function(r) {
    return headers.map(function(h) { return String(r[h] || '').trim(); });
  });
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, Math.max(lastCol, headers.length)).clearContent();
  }
  
  applyPlainTextColumns_(sheet, plainTextHeadersForSheet_(sheetName));
  sheet.getRange(2, 1, newValues.length, headers.length).setValues(newValues);
  
  logAudit_(payload.adminStaffId, 'uploadData', sheetName, '', '', JSON.stringify({ count: newValues.length }), 'OK', 'Bulk upload ' + sheetName);
  clearRefCache_();
  return { ok: true, count: newValues.length };
}

function getVisualization_(params) {
  const p = params || {};
  const rows = getReportRowsForVisualization_().filter(function (r) { return matchFilters_(r, p); });
  const metrics = buildMetrics_(rows);
  const aggregates = {
    byDepartment: countBy_(rows, 'department'),
    bySeverity: countBy_(rows, 'severityLevel'),
    byProcess: countBy_(rows, 'medicationReconciliation'),
    byMonth: countByMonth_(rows),
    byDrugGroup: countDrugGroup_(rows),
    byDrugName: countDrugNames_(rows),
    byDoctor: countBy_(rows, 'doctor'),
    drugGroupBySeverity: matrixDrugGroupSeverity_(rows),
    consultBySource: consultBySource_(rows),
    errorTypeBySource: errorTypeBySource_(rows)
  };
  return { metrics: metrics, aggregates: aggregates, rows: rows, version: APP_VERSION };
}

function matchFilters_(r, p) {
  if (p.startDate && String(r.eventDate || '') < String(p.startDate)) return false;
  if (p.endDate && String(r.eventDate || '') > String(p.endDate)) return false;
  if (p.department && !same_(r.department, p.department)) return false;
  if (p.source && !same_(r.prescribingErrorFrom, p.source)) return false;
  if (p.severity && !same_(r.severityLevel, p.severity)) return false;
  if (p.process && !same_(r.medicationReconciliation, p.process)) return false;
  if (p.drugGroup && !same_(r.drugGroup, p.drugGroup)) return false;
  if (p.subclass && !same_(r.subclass, p.subclass)) return false;
  if (p.generic) {
    const g = normalize_(p.generic);
    if (normalize_(r.drug1).indexOf(g) === -1 && normalize_(r.drug2).indexOf(g) === -1) return false;
  }
  if (p.consult && !same_(r.consult, p.consult)) return false;
  if (p.errorType && !same_(r.errorType, p.errorType)) return false;
  if (p.specialty && !same_(r.specialty, p.specialty)) return false;
  if (p.doctor && !same_(r.doctor, p.doctor)) return false;
  if (p.doctorType && !same_(r.doctorType, p.doctorType)) return false;
  return true;
}

function buildMetrics_(rows) {
  const total = rows.length;
  const ym = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
  const thisMonth = rows.filter(function (r) { return String(r.eventDate || '').slice(0, 7) === ym; }).length;
  const consultAdjusted = rows.filter(function (r) { return normalize_(r.consult).indexOf(normalize_('ปรับแผน')) !== -1; }).length;
  const fullTime = rows.filter(function (r) { return normalize_(r.doctorType) === 'full-time' || normalize_(r.doctorType) === 'full time'; }).length;
  return {
    total: total,
    thisMonth: thisMonth,
    consultAdjustedPct: total ? consultAdjusted / total * 100 : 0,
    fullTimePct: total ? fullTime / total * 100 : 0
  };
}

function countBy_(rows, key) {
  const map = {};
  rows.forEach(function (r) {
    const label = String(r[key] || '-').trim() || '-';
    map[label] = (map[label] || 0) + 1;
  });
  return Object.keys(map).map(function (label) { return { label: label, count: map[label] }; })
    .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
}

function countByMonth_(rows) {
  const map = {};
  rows.forEach(function (r) {
    const label = String(r.eventDate || '').slice(0, 7) || '-';
    map[label] = (map[label] || 0) + 1;
  });
  return Object.keys(map).sort().map(function (label) { return { label: label, count: map[label] }; });
}

function countDrugGroup_(rows) {
  const map = {};
  rows.forEach(function (r) {
    const label = String(r.drugGroup || '-').trim() || '-';
    let add = 0;
    if (r.drug1) add++;
    if (r.drug2) add++;
    map[label] = (map[label] || 0) + Math.max(add, 1);
  });
  return Object.keys(map).map(function (label) { return { label: label, count: map[label] }; })
    .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
}

function countDrugNames_(rows) {
  const map = {};
  rows.forEach(function (r) {
    [r.drug1, r.drug2].forEach(function (d) {
      const label = String(d || '').trim();
      if (!label) return;
      map[label] = (map[label] || 0) + 1;
    });
  });
  return Object.keys(map).map(function (label) { return { label: label, count: map[label] }; })
    .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
}

function matrixDrugGroupSeverity_(rows) {
  const map = {};
  rows.forEach(function (r) {
    const group = String(r.drugGroup || '-').trim() || '-';
    const sev = String(r.severityLevel || '-').trim() || '-';
    if (!map[group]) map[group] = { label: group, total: 0, severity: {} };
    map[group].total += 1;
    map[group].severity[sev] = (map[group].severity[sev] || 0) + 1;
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.total - a.total; });
}

function consultBySource_(rows) {
  const map = {};
  rows.forEach(function (r) {
    const source = String(r.prescribingErrorFrom || '-').trim() || '-';
    if (!map[source]) map[source] = { source: source, adjusted: 0, notAdjusted: 0 };
    if (normalize_(r.consult).indexOf(normalize_('ปรับแผน')) !== -1) map[source].adjusted += 1;
    else map[source].notAdjusted += 1;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function errorTypeBySource_(rows) {
  const map = {};
  rows.forEach(function (r) {
    const source = String(r.prescribingErrorFrom || '-').trim() || '-';
    if (!map[source]) map[source] = { source: source, medRec: 0, other: 0 };
    const process = normalize_(r.medicationReconciliation);
    if (process.indexOf('med rec') !== -1 || process.indexOf('home med') !== -1) map[source].medRec += 1;
    else map[source].other += 1;
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

function getReportRowsForVisualization_() {
  return getRows_(SHEET_NAMES.reports).map(function (r) {
    return {
      timestamp: dateToIsoLike_(val_(r, 'Timestamp')),
      reportId: val_(r, 'ReportID'),
      prescribingErrorFrom: val_(r, 'PrescribingErrorFrom'),
      hn: val_(r, 'HN'),
      eventDate: dateOnly_(val_(r, 'EventDate')),
      eventTime: timeOnly_(val_(r, 'EventTime')),
      department: val_(r, 'Department'),
      doctor: val_(r, 'Doctor'),
      specialty: val_(r, 'Specialty'),
      doctorType: val_(r, 'DoctorType'),
      errorDetails: val_(r, 'ErrorDetails'),
      consult: val_(r, 'Consult'),
      errorType: val_(r, 'ErrorType'),
      medicationReconciliation: val_(r, 'MedicationReconciliation'),
      reporterStaffId: val_(r, 'ReporterStaffID'),
      drug1: val_(r, 'Drug1'),
      drug2: val_(r, 'Drug2'),
      drugGroup: val_(r, 'DrugGroup'),
      subclass: val_(r, 'Subclass'),
      severityLevel: val_(r, 'SeverityLevel'),
      createdBy: val_(r, 'CreatedBy'),
      clientVersion: val_(r, 'ClientVersion')
    };
  }).filter(function (r) { return r.reportId || r.hn || r.eventDate; });
}

function validateReport_(p) {
  const required = {
    prescribingErrorFrom: 'Prescribing Error จาก',
    hn: 'HN',
    eventDate: 'วันที่เกิดเหตุการณ์',
    eventTime: 'เวลา',
    department: 'Department',
    doctor: 'รายชื่อแพทย์',
    errorDetails: 'รายละเอียด',
    consult: 'Consult',
    errorType: 'ประเภท',
    medicationReconciliation: 'Process',
    reporterStaffId: 'ผู้รายงาน / StaffID',
    drug1: 'ยา 1',
    drugGroup: 'กลุ่มยา',
    severityLevel: 'Severity'
  };
  const missing = [];
  Object.keys(required).forEach(function (key) {
    if (!String(p[key] || '').trim()) missing.push(required[key]);
  });
  if (missing.length) throw new Error('กรอกข้อมูลไม่ครบ: ' + missing.join(', '));
  assertHN_(p.hn);
  assertStaffId_(p.reporterStaffId, 'Staff ID ผู้รายงาน');
  canonicalPrescribingErrorFrom_(p.prescribingErrorFrom);
}


function normalizeReportPayload_(payload) {
  const p = payload || {};
  return {
    prescribingErrorFrom: canonicalPrescribingErrorFrom_(val_(p, 'prescribingErrorFrom')),
    hn: assertHN_(val_(p, 'hn')),
    eventDate: String(val_(p, 'eventDate') || '').trim(),
    eventTime: String(val_(p, 'eventTime') || '').trim(),
    department: String(val_(p, 'department') || '').trim(),
    doctor: String(val_(p, 'doctor') || '').trim(),
    specialty: String(val_(p, 'specialty') || '').trim(),
    doctorType: String(val_(p, 'doctorType') || '').trim(),
    errorDetails: String(val_(p, 'errorDetails') || '').trim(),
    consult: String(val_(p, 'consult') || '').trim(),
    errorType: String(val_(p, 'errorType') || '').trim(),
    medicationReconciliation: String(val_(p, 'medicationReconciliation') || '').trim(),
    reporterStaffId: assertStaffId_(val_(p, 'reporter') || val_(p, 'reporterStaffId'), 'Staff ID ผู้รายงาน'),
    drug1: String(val_(p, 'drug1') || '').trim(),
    drug2: String(val_(p, 'drug2') || '').trim(),
    drugGroup: String(val_(p, 'drugGroup') || '').trim(),
    subclass: String(val_(p, 'subclass') || '').trim(),
    severityLevel: String(val_(p, 'severityLevel') || '').trim(),
    clientVersion: String(val_(p, 'clientVersion') || '').trim(),
    userAgent: String(val_(p, 'userAgent') || '').trim()
  };
}

function normalizeHN_(hn) {
  const s = String(hn === undefined || hn === null ? '' : hn).trim();
  if (!s) return '';

  // Canonical input: 07-XX-XXXXXX. If the last part has only 1-6 digits,
  // left-pad with zeros to keep the Google Sheet value as text in 07-XX-XXXXXX format.
  // Examples:
  //   07-16-3914 -> 07-16-003914
  //   07-06-1052 -> 07-06-001052
  //   07-26-1653 -> 07-26-001653
  //   07-25-53   -> 07-25-000053
  const dashed = s.match(/^07-(\d{2})-(\d{1,6})$/);
  if (dashed) {
    return '07-' + dashed[1] + '-' + dashed[2].padStart(6, '0');
  }

  // Accept digits-only input too, then convert to 07-XX-XXXXXX.
  // Examples:
  //   07163914   -> 07-16-003914
  //   07061052   -> 07-06-001052
  //   072553     -> 07-25-000053
  //   0712345678 -> 07-12-345678
  const digits = s.replace(/[^0-9]/g, '');
  const compact = digits.match(/^07(\d{2})(\d{1,6})$/);
  if (compact) {
    return '07-' + compact[1] + '-' + compact[2].padStart(6, '0');
  }

  return s;
}

function assertHN_(hn) {
  const value = normalizeHN_(hn);
  if (!HN_PATTERN.test(value)) {
    throw new Error('HN ไม่ถูกต้อง ต้องเป็น Text รูปแบบ 07-XX-XXXXXX เช่น 07-16-003914 หรือ 07-12-345678');
  }
  return value;
}

function normalizeStaffId_(staffId) {
  return String(staffId === undefined || staffId === null ? '' : staffId).trim();
}

function assertStaffId_(staffId, label) {
  const value = normalizeStaffId_(staffId);
  if (!STAFF_ID_PATTERN.test(value)) {
    throw new Error((label || 'StaffID') + ' ต้องเป็น Text 6 ตัวอักษร ใช้ได้เฉพาะ A-Z, a-z, 0-9 เช่น 000123 หรือ AB1234');
  }
  return value;
}

function canonicalPrescribingErrorFrom_(value) {
  const s = String(value === undefined || value === null ? '' : value).trim();
  const key = normalizeKey_(s);

  // Backward compatibility for AuditLog / old frontend values.
  // Old payloads stored "OPD PHARMACY PHARMACY" and "IPD PHARMACY PHARMACY".
  // They must be recovered into the current approved values.
  if (key === 'opdpharmacypharmacy') return 'OPD PHARMACY';
  if (key === 'ipdpharmacypharmacy') return 'IPD PHARMACY';

  const hit = REQUIRED_PRESCRIBING_ERROR_FROM.find(function (allowed) {
    return normalizeKey_(allowed) === key;
  });
  if (!hit) {
    throw new Error('PrescribingErrorFrom ต้องเป็นหนึ่งใน: ' + REQUIRED_PRESCRIBING_ERROR_FROM.join(', '));
  }
  return hit;
}

function requireAdmin_(staffId) {
  const id = assertStaffId_(staffId, 'Admin StaffID');
  const check = verifyAdmin_(id);
  if (!check.ok) throw new Error('ต้องใช้ StaffID 6 ตัวอักษรที่มี Role = Admin');
  return check;
}

function getSafeLock_() {
  // getDocumentLock() returns null when this script is standalone and not bound
  // to a spreadsheet. The old code called waitLock() on that null value, causing
  // the AuditLog error: Cannot read properties of null (reading 'waitLock').
  return LockService.getDocumentLock() || LockService.getScriptLock();
}

function getSpreadsheet_() {
  const sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) throw new Error('ไม่พบ Google Sheet: กรุณาตั้ง Script Property SHEET_ID');
  return active;
}

function ensureAllSheets_() {
  ensureSheet_(SHEET_NAMES.departments, HEADERS.department);
  ensureSheet_(SHEET_NAMES.staff, HEADERS.Staff);
  ensureSheet_(SHEET_NAMES.doctors, HEADERS.Doctor);
  ensureSheet_(SHEET_NAMES.medications, HEADERS.Medication);
  ensureSheet_(SHEET_NAMES.lists, HEADERS.Lists);
  ensureSheet_(SHEET_NAMES.reports, HEADERS.PrescribingErrors);
  ensureSheet_(SHEET_NAMES.audit, HEADERS.AuditLog);
}

function ensureSheet_(name, headers) {
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = Math.max(sh.getLastColumn(), headers.length, 1);
  const firstRow = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const empty = firstRow.every(function (v) { return !String(v || '').trim(); });
  if (empty) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0F766E').setFontColor('#FFFFFF');
    return sh;
  }
  const existing = firstRow.map(function (h) { return String(h || '').trim(); }).filter(Boolean);
  const missing = headers.filter(function (h) { return existing.indexOf(h) === -1; });
  if (missing.length) {
    sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return sh;
}


function applyPlainTextFormats_() {
  try {
    applyPlainTextColumns_(getSheet_(SHEET_NAMES.reports), ['ReportID', 'HN', 'ReporterStaffID']);
    applyPlainTextColumns_(getSheet_(SHEET_NAMES.staff), ['StaffID']);
  } catch (err) {
    logAuditSafe_('system', 'applyPlainTextFormats.error', 'System', '', '', '', 'ERROR', err);
  }
}

function applyPlainTextColumns_(sheet, headerNames) {
  const headers = getHeaders_(sheet);
  const maxRows = Math.max(sheet.getMaxRows(), 1000);
  (headerNames || []).forEach(function (headerName) {
    const col = headers.indexOf(headerName) + 1;
    if (col > 0) sheet.getRange(1, col, maxRows, 1).setNumberFormat('@');
  });
}

function applyPlainTextForRow_(sheet, headers, rowNumber, headerNames) {
  (headerNames || []).forEach(function (headerName) {
    const col = headers.indexOf(headerName) + 1;
    if (col > 0) sheet.getRange(rowNumber, col).setNumberFormat('@');
  });
}

function plainTextHeadersForSheet_(sheetName) {
  if (sheetName === SHEET_NAMES.staff) return ['StaffID'];
  if (sheetName === SHEET_NAMES.reports) return ['ReportID', 'HN', 'ReporterStaffID'];
  return [];
}

function syncFixedListCategories_() {
  const sheet = getSheet_(SHEET_NAMES.lists);
  const headers = getHeaders_(sheet);
  const catCol = headers.indexOf('Category');
  const valueCol = headers.indexOf('Value');
  const sortCol = headers.indexOf('SortOrder');
  if (catCol < 0 || valueCol < 0 || sortCol < 0) return;

  // Force PrescribingErrorFrom to exactly the 3 requested values.
  const lastRow = sheet.getLastRow();
  let keep = [];
  if (lastRow >= 2) {
    const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    keep = values.filter(function (row) {
      const cat = String(row[catCol] || '').trim();
      const alias = LIST_CATEGORY_ALIASES[normalize_(cat).replace(/[^a-z0-9]/g, '')] || cat;
      return alias !== 'prescribingErrorFrom';
    });
    sheet.getRange(2, 1, lastRow - 1, headers.length).clearContent();
    if (keep.length) sheet.getRange(2, 1, keep.length, headers.length).setValues(keep);
  }

  const sourceRows = REQUIRED_PRESCRIBING_ERROR_FROM.map(function (source, i) {
    const row = new Array(headers.length).fill('');
    row[catCol] = 'prescribingErrorFrom';
    row[valueCol] = source;
    row[sortCol] = i + 1;
    return row;
  });
  sheet.getRange(2 + keep.length, 1, sourceRows.length, headers.length).setValues(sourceRows);

  // Add the requested error type choices without deleting existing error type choices.
  appendMissingListValues_('errorTypes', REQUIRED_ERROR_TYPES);
}

function appendMissingListValues_(category, values) {
  const sheet = getSheet_(SHEET_NAMES.lists);
  const headers = getHeaders_(sheet);
  const catCol = headers.indexOf('Category');
  const valueCol = headers.indexOf('Value');
  const sortCol = headers.indexOf('SortOrder');
  if (catCol < 0 || valueCol < 0 || sortCol < 0) return;

  const targetAlias = LIST_CATEGORY_ALIASES[normalize_(category).replace(/[^a-z0-9]/g, '')] || category;
  const existing = {};
  let maxSort = 0;
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    data.forEach(function (row) {
      const rawCat = String(row[catCol] || '').trim();
      const alias = LIST_CATEGORY_ALIASES[normalize_(rawCat).replace(/[^a-z0-9]/g, '')] || rawCat;
      if (alias !== targetAlias) return;
      const value = String(row[valueCol] || '').trim();
      if (value) existing[normalize_(value)] = true;
      const sort = Number(row[sortCol]);
      if (!isNaN(sort)) maxSort = Math.max(maxSort, sort);
    });
  }

  const rows = [];
  (values || []).forEach(function (value) {
    const clean = String(value || '').trim();
    if (!clean || existing[normalize_(clean)]) return;
    existing[normalize_(clean)] = true;
    maxSort += 1;
    const row = new Array(headers.length).fill('');
    row[catCol] = targetAlias;
    row[valueCol] = clean;
    row[sortCol] = maxSort;
    rows.push(row);
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function normalizeExistingStaffIds_() {
  const sheet = getSheet_(SHEET_NAMES.staff);
  const headers = getHeaders_(sheet);
  const col = headers.indexOf('StaffID') + 1;
  if (col < 1 || sheet.getLastRow() < 2) return;
  const range = sheet.getRange(2, col, sheet.getLastRow() - 1, 1);
  const values = range.getValues().map(function (row) { return [coerceExistingStaffId_(row[0])]; });
  range.setNumberFormat('@');
  range.setValues(values);
}

function normalizeExistingReportTextFields_() {
  const sheet = getSheet_(SHEET_NAMES.reports);
  const headers = getHeaders_(sheet);
  if (sheet.getLastRow() < 2) return;
  const hnCol = headers.indexOf('HN') + 1;
  const staffCol = headers.indexOf('ReporterStaffID') + 1;
  const reportIdCol = headers.indexOf('ReportID') + 1;
  if (hnCol > 0) {
    const range = sheet.getRange(2, hnCol, sheet.getLastRow() - 1, 1);
    const values = range.getValues().map(function (row) { return [normalizeHN_(row[0])]; });
    range.setNumberFormat('@');
    range.setValues(values);
  }
  if (staffCol > 0) {
    const range = sheet.getRange(2, staffCol, sheet.getLastRow() - 1, 1);
    const values = range.getValues().map(function (row) { return [coerceExistingStaffId_(row[0])]; });
    range.setNumberFormat('@');
    range.setValues(values);
  }
  if (reportIdCol > 0) {
    sheet.getRange(2, reportIdCol, sheet.getLastRow() - 1, 1).setNumberFormat('@');
  }
}

function coerceExistingStaffId_(value) {
  const s = normalizeStaffId_(value);
  if (/^\d{1,6}$/.test(s)) return s.padStart(6, '0');
  return s;
}

function seedDefaultData_() {
  if (getSheet_(SHEET_NAMES.departments).getLastRow() < 2) {
    getSheet_(SHEET_NAMES.departments).getRange(2, 1, DEFAULT_DEPARTMENTS.length, 1)
      .setValues(DEFAULT_DEPARTMENTS.map(function (d) { return [d]; }));
  }
  if (getSheet_(SHEET_NAMES.staff).getLastRow() < 2) {
    getSheet_(SHEET_NAMES.staff).getRange(2, 1, 2, 3).setValues([
      ['000001', 'System Admin', 'Admin'],
      ['000002', 'Demo User', 'User']
    ]);
  }
  if (getSheet_(SHEET_NAMES.doctors).getLastRow() < 2) {
    getSheet_(SHEET_NAMES.doctors).getRange(2, 1, 3, 4).setValues([
      ['Demo Doctor 1', 'OPD MED', 'Internal Medicine', 'Full-time'],
      ['Demo Doctor 2', 'ER', 'Emergency Medicine', 'Full-time'],
      ['Demo Doctor 3', 'ICU', 'Critical Care', 'Part-time']
    ]);
  }
  if (getSheet_(SHEET_NAMES.medications).getLastRow() < 2) {
    getSheet_(SHEET_NAMES.medications).getRange(2, 1, 6, 6).setValues([
      ['Paracetamol', 'Tylenol', 'tab 500 mg', 'Paracetamol tab 500 mg', 'Analgesic', 'Non-opioid'],
      ['Amoxicillin/Clavulanate', 'Augmentin', 'tab 1 g', 'Amoxicillin/Clavulanate tab 1 g', 'Antibiotics', 'Penicillin'],
      ['Ceftriaxone', 'Rocephin', 'inj 1 g', 'Ceftriaxone inj 1 g', 'Antibiotics', 'Cephalosporin'],
      ['Apixaban', 'Eliquis', 'tab 5 mg', 'Apixaban tab 5 mg', 'Anticoagulant/Antiplatelet', 'DOAC'],
      ['Insulin glargine', 'Lantus', 'pen', 'Insulin glargine pen', 'Antidiabetic', 'Insulin'],
      ['Omeprazole', 'Losec', 'cap 20 mg', 'Omeprazole cap 20 mg', 'GI', 'PPI']
    ]);
  }
  if (getSheet_(SHEET_NAMES.lists).getLastRow() < 2) {
    const rows = [];
    Object.keys(DEFAULT_LISTS).forEach(function (cat) {
      DEFAULT_LISTS[cat].forEach(function (v, i) { rows.push([cat, v, i + 1]); });
    });
    getSheet_(SHEET_NAMES.lists).getRange(2, 1, rows.length, 3).setValues(rows);
  }
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet: ' + name);
  return sh;
}

function getHeaders_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); }).filter(Boolean);
}

function getRows_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const headers = getHeaders_(sheet);
  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  return values.map(function (row) {
    const obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  }).filter(function (obj) {
    return headers.some(function (h) { return String(obj[h] || '').trim() !== ''; });
  });
}

function getColumnValues_(sheetName, header) {
  return uniqueSorted_(getRows_(sheetName).map(function (r) { return val_(r, header); }));
}

function getLists_() {
  const lists = JSON.parse(JSON.stringify(DEFAULT_LISTS));
  const rows = getRows_(SHEET_NAMES.lists);
  Object.keys(lists).forEach(function (k) { lists[k] = []; });
  rows.forEach(function (r) {
    const rawCat = String(val_(r, 'Category') || '').trim();
    const cat = LIST_CATEGORY_ALIASES[normalize_(rawCat).replace(/[^a-z0-9]/g, '')] || rawCat;
    const value = String(val_(r, 'Value') || '').trim();
    if (!value) return;
    if (!lists[cat]) lists[cat] = [];
    lists[cat].push(value);
  });
  Object.keys(DEFAULT_LISTS).forEach(function (k) {
    lists[k] = uniqueSorted_(lists[k] && lists[k].length ? lists[k] : DEFAULT_LISTS[k]);
  });
  // Force the allowed PrescribingErrorFrom values even if old values still exist in Lists sheet.
  lists.prescribingErrorFrom = REQUIRED_PRESCRIBING_ERROR_FROM.slice();
  // Always include requested error type choices in the dropdown, while keeping existing choices too.
  lists.errorTypes = uniqueStable_(REQUIRED_ERROR_TYPES.concat(lists.errorTypes || []));
  return lists;
}

function getMedicationRows_() {
  return getRows_(SHEET_NAMES.medications).map(function (r) {
    const genericName = val_(r, 'GenericName') || val_(r, 'Generic');
    const brandName = val_(r, 'BrandName') || val_(r, 'Brand');
    const form = val_(r, 'Form') || val_(r, 'DosageForm');
    const displayName = val_(r, 'DisplayName') || [genericName, brandName, form].filter(Boolean).join(' ');
    return {
      genericName: genericName,
      brandName: brandName,
      form: form,
      displayName: displayName,
      drugGroup: val_(r, 'DrugGroup') || val_(r, 'MajorClass'),
      subclass: val_(r, 'Subclass') || val_(r, 'SubClass'),
      code: val_(r, 'Code') || val_(r, 'DrugCode') || val_(r, 'ItemCode')
    };
  }).filter(function (m) { return m.displayName || m.genericName || m.brandName; });
}

function upsertRow_(sheetName, keyHeader, oldKey, obj) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const keyCol = headers.indexOf(keyHeader) + 1;
  if (keyCol < 1) throw new Error('Missing key header: ' + keyHeader);
  const oldKeyNorm = normalize_(oldKey || obj[keyHeader]);
  let targetRow = 0;
  if (oldKeyNorm && sheet.getLastRow() >= 2) {
    const values = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
    values.some(function (row, i) {
      if (normalize_(row[0]) === oldKeyNorm) { targetRow = i + 2; return true; }
      return false;
    });
  }
  const rowValues = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  const writeRow = targetRow || (sheet.getLastRow() + 1);
  applyPlainTextForRow_(sheet, headers, writeRow, plainTextHeadersForSheet_(sheetName));
  sheet.getRange(writeRow, 1, 1, headers.length).setValues([rowValues]);
}

function deleteByKey_(sheetName, keyHeader, keyValue) {
  const key = normalize_(keyValue);
  if (!key) throw new Error('Missing key value');
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const keyCol = headers.indexOf(keyHeader) + 1;
  if (keyCol < 1) throw new Error('Missing key header: ' + keyHeader);
  if (sheet.getLastRow() < 2) return false;
  const values = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (normalize_(values[i][0]) === key) {
      sheet.deleteRow(i + 2);
      return true;
    }
  }
  return false;
}

function nextReportId_() {
  const prefix = 'PE-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd') + '-';
  const sheet = getSheet_(SHEET_NAMES.reports);
  const headers = getHeaders_(sheet);
  const col = headers.indexOf('ReportID') + 1;
  let max = 0;
  if (col > 0 && sheet.getLastRow() >= 2) {
    const ids = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues().flat();
    ids.forEach(function (id) {
      id = String(id || '');
      if (id.indexOf(prefix) === 0) {
        const n = parseInt(id.slice(prefix.length), 10);
        if (!isNaN(n)) max = Math.max(max, n);
      }
    });
  }
  return prefix + String(max + 1).padStart(4, '0');
}

function reportFingerprint_(p) {
  return [p.hn, p.eventDate, p.eventTime, p.department, p.doctor, p.drug1, p.drug2, p.errorDetails, p.reporterStaffId]
    .map(function (v) { return normalize_(v).replace(/\s+/g, ' '); }).join('|');
}

function findRecentDuplicateReport_(fingerprint) {
  if (!fingerprint) return null;
  const rows = getReportRowsForVisualization_();
  const recent = rows.slice(Math.max(0, rows.length - 100));
  for (let i = recent.length - 1; i >= 0; i--) {
    const r = recent[i];
    const fp = [r.hn, r.eventDate, r.eventTime, r.department, r.doctor, r.drug1, r.drug2, r.errorDetails, r.reporterStaffId]
      .map(function (v) { return normalize_(v).replace(/\s+/g, ' '); }).join('|');
    if (fp === fingerprint) return { reportId: r.reportId };
  }
  return null;
}

function logAudit_(actor, action, entityType, entityId, beforeObj, afterObj, result, message) {
  try {
    const sheet = getSheet_(SHEET_NAMES.audit);
    const headers = getHeaders_(sheet);
    const obj = {
      Timestamp: new Date(),
      Actor: actor || activeUserEmail_() || 'system',
      Action: action || '',
      EntityType: entityType || '',
      EntityId: entityId || '',
      Before: stringifyLimited_(beforeObj),
      After: stringifyLimited_(afterObj),
      Result: result || '',
      Message: stringifyLimited_(message)
    };
    sheet.appendRow(headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; }));
  } catch (_) {}
}

function logAuditSafe_(actor, action, entityType, entityId, beforeObj, afterObj, result, err) {
  try { logAudit_(actor, action, entityType, entityId, beforeObj, afterObj, result, errorMessage_(err)); } catch (_) {}
}

function parseGetData_(params) {
  if (params.payload) {
    try { return JSON.parse(params.payload); } catch (_) {}
  }
  if (params.data) {
    try { return JSON.parse(params.data); } catch (_) {}
  }
  return params || {};
}

function output_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService.createTextOutput(String(callback).replace(/[^A-Za-z0-9_$\.]/g, '') + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function val_(obj, key) {
  if (!obj) return '';
  if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  const keys = Object.keys(obj);
  const wanted = normalize_(key).replace(/[^a-z0-9]/g, '');
  for (let i = 0; i < keys.length; i++) {
    const k = normalize_(keys[i]).replace(/[^a-z0-9]/g, '');
    if (k === wanted) return obj[keys[i]];
  }
  return '';
}

function normalize_(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase();
}

function normalizeKey_(v) {
  return normalize_(v).replace(/[^a-z0-9]/g, '');
}

function same_(a, b) {
  return normalize_(a) === normalize_(b);
}

function uniqueStable_(arr) {
  const seen = {};
  const out = [];
  (arr || []).forEach(function (v) {
    const s = String(v || '').trim();
    if (!s) return;
    const key = normalize_(s);
    if (seen[key]) return;
    seen[key] = true;
    out.push(s);
  });
  return out;
}

function uniqueSorted_(arr) {
  const map = {};
  (arr || []).forEach(function (v) {
    const s = String(v || '').trim();
    if (s) map[s] = true;
  });
  return Object.keys(map).sort(function (a, b) { return a.localeCompare(b); });
}

function dateOnly_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function timeOnly_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm');
  }
  return String(v || '').trim();
}

function dateToIsoLike_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime())) {
    return v.toISOString();
  }
  return String(v || '').trim();
}

function activeUserEmail_() {
  try { return Session.getActiveUser().getEmail() || ''; } catch (_) { return ''; }
}

function stringifyLimited_(v) {
  let s;
  try { s = typeof v === 'string' ? v : JSON.stringify(v); } catch (_) { s = String(v); }
  if (s === undefined || s === null) s = '';
  s = String(s);
  return s.length > 45000 ? s.slice(0, 45000) + '…' : s;
}

function errorMessage_(err) {
  return err && err.message ? err.message : String(err || 'Unknown error');
}

function toDoctor_(obj) {
  return { name: obj.Name, department: obj.Department, specialty: obj.Specialty, type: obj.Type };
}
