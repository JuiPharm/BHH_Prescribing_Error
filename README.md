# BHH Prescribing Error Reporting - GAS Optimized

ชุดนี้เป็นเวอร์ชันปรับปรุงประสิทธิภาพ โดยยังใช้สถาปัตยกรรมเดิม:

- GitHub Pages frontend
- Google Apps Script backend
- Google Sheets database
- JSONP สำหรับ GET เพื่อลดปัญหา CORS
- POST แบบ `text/plain;charset=utf-8` พร้อม fallback `no-cors`

## สิ่งที่ปรับปรุง

1. เพิ่ม `Med Rec Transfer` ในรายการ Process ที่ตรวจพบ Prescribing Error
2. Visualization เร็วขึ้นด้วย backend aggregation และ CacheService
3. ลดการอ่าน Google Sheet ซ้ำ ด้วย single range read + header map
4. Medication search เร็วขึ้นด้วย `getMedicationIndex` และค้นหาใน browser หลัง prefetch
5. เพิ่ม Process filter และกราฟ Reports by Process
6. เพิ่ม server-side validation, audit log, sheet/header auto-create
7. คง workflow เดิม: Report form, Manage Data, Visualization, Export XLSX

## โครงสร้างไฟล์

```text
index.html
assets/css/styles.css
assets/js/config.js
assets/js/app.js
apps-script/Code.gs
docs/DEPLOYMENT.md
docs/SHEET_SCHEMA.md
```

## การตั้งค่า

1. เปิด Google Sheet ที่ใช้เป็นฐานข้อมูล
2. Extensions > Apps Script
3. วาง `apps-script/Code.gs`
4. ตั้ง Script Properties:

```text
SHEET_ID=<Google Sheet ID>
```

5. Run function `setup`
6. Deploy as Web app
7. นำ Web App URL ไปใส่ใน `assets/js/config.js`

```js
window.PE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec',
  API_MODE: 'jsonp',
  LOCK_API_URL: false,
  VERSION: 'gas-optimized-2026-04-29'
};
```

## Test URLs

```text
YOUR_WEB_APP_URL?action=health&callback=testCallback
YOUR_WEB_APP_URL?action=getReferenceData&callback=testCallback
YOUR_WEB_APP_URL?action=getVisualization&callback=testCallback
```

## หมายเหตุด้านประสิทธิภาพ

Google Sheets ยังเหมาะกับข้อมูลระดับเล็กถึงกลางและทีม internal ถ้าข้อมูล PrescribingErrors เติบโตมากกว่า 10,000-30,000 rows หรือมีผู้ใช้งาน dashboard พร้อมกันหลายคน ควรพิจารณาย้ายไป Supabase/Postgres เพื่อ query/filter/aggregate ได้เร็วกว่าและเสถียรกว่า
