# Prescribing Error Reporting (GitHub Pages + Apps Script)

## 1) Backend (Google Apps Script)
1. Create Apps Script project bound to the same Google Sheet (or open the sheet → Extensions → Apps Script).
2. Paste `Code.gs` from this folder into Apps Script (replace your old Code.gs).
3. Deploy as **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the Web app URL (ending with `/exec`).

Important: Frontend sends POST with `Content-Type: text/plain;charset=utf-8` to avoid CORS preflight.

## 2) Frontend (GitHub Pages)
1. Put `index.html` and `assets/` in your GitHub repository.
2. Edit `assets/js/app.js`:
   - set `API_URL = "https://script.google.com/macros/s/XXXXX/exec"`
3. Enable GitHub Pages for the repository.
4. Open the GitHub Pages URL.

## Sheets (Database)
- `department`: column `Department` (ระบบจะยอมรับ header เดิมที่เป็น `Name` ด้วย)
- `Staff`: columns `StaffID`, `Name`, `Role` (Admin/User)
- `Doctor`: columns `Name`, `Department`, `Specialty`, `Type` (Full-time/Part-time)
- `PrescribingErrors`: 38 columns (created automatically if missing)

## Admin permissions
- Manage Data tab requires **Admin StaffID** validation.
- Role is read from Sheet `Staff`.


## Medication (Optional)
- Add Sheet: `Medication`
- Columns: `GenericName`, `BrandName`, `Form`, `DisplayName`, `DrugGroup`
- Drug 1 / Drug 2 จะค้นหาได้ทั้งชื่อสามัญและชื่อการค้า และระบบจะเติม `กลุ่มยา` อัตโนมัติจาก Drug 1 และล็อกแก้ไขไม่ได้
