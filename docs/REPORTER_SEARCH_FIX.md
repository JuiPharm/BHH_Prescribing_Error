# Reporter Search Fix

## Root cause
`index.html` was updated to use an `<input id="reporter">` for searchable reporter entry, but the deployed `assets/js/app.js` still treated `#reporter` as a `<select>` and attempted to render `<option>` nodes into it. This prevented Staff reference data from binding to the reporter field.

## Files to deploy
Replace these files in the GitHub repository:

- `index.html`
- `assets/js/app.js`
- `assets/js/config.js` only if your API URL is not already configured

## What changed
- Added `selectedReporter` state
- Added staff alias normalization for `staffId`, `StaffID`, `Name`, `Role`
- Added reporter typeahead search using `state.ref.staff`
- Added validation to require a selected reporter from Staff master
- Prevented rendering `<option>` into the reporter input

## Test steps
1. Open the GitHub Pages URL.
2. Press Ctrl+F5.
3. Click `รีเฟรชข้อมูลอ้างอิง`.
4. Type a StaffID or staff name in `ผู้รายงาน`.
5. Select the staff item from suggestions.
6. Submit a test report.
7. Confirm Google Sheet saves `ReporterStaffID` with the selected StaffID.
