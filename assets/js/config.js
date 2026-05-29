// Runtime config for BHH Prescribing Error Reporting
// Backend: Google Apps Script Web App + Google Sheet database.
// 1) Deploy apps-script/Code.gs as a Google Apps Script Web App.
// 2) Replace API_URL with your deployed Web App URL ending with /exec.
// 3) Keep LOCK_API_URL=true for production to prevent users from overriding the API URL.

window.PE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyIy7tJrZEAeesfARaBVgPaPCt4WXqcLRCIPOJ2_zPWxWCxWZO0pjYrJeCF6m-DEdjF/exec',
  API_MODE: 'jsonp',
  LOCK_API_URL: true,
  VERSION: 'github-v5-gas-sheet-fast-hidden-api-2026-05-29',
  CACHE_TTL: {
    getReferenceData: 30 * 60 * 1000,
    getMedicationIndex: 6 * 60 * 60 * 1000,
    getVisualization: 5 * 60 * 1000,
    health: 60 * 1000
  }
};
