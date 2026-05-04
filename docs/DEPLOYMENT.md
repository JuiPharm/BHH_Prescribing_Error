# Deployment - GAS Optimized

## 1) Google Sheet

สร้าง Google Sheet แล้วให้ Apps Script auto-create sheet/header หรือสร้างเองตาม `SHEET_SCHEMA.md`

## 2) Apps Script

1. เปิด Google Sheet > Extensions > Apps Script
2. วางโค้ดจาก `apps-script/Code.gs`
3. Project Settings > Script Properties
   - `SHEET_ID` = Google Sheet ID
4. Run function `setup`
5. Deploy > New deployment > Web app
   - Execute as: Me
   - Who has access: Anyone with the link หรือ Anyone ตาม policy องค์กร
6. Copy Web App URL ที่ลงท้าย `/exec`

## 3) GitHub Pages

1. Commit ไฟล์ทั้งหมดใน repo
2. แก้ `assets/js/config.js` ให้เป็น Web App URL จริง
3. Settings > Pages > Deploy from branch หรือ GitHub Actions
4. เปิดหน้าเว็บแล้วกด Ping

## 4) Manual Test Checklist

- `?action=health&callback=testCallback` ตอบกลับ success=true
- หน้าเว็บโหลดโดยไม่มี console error
- Dropdown Process มี `Med Rec Transfer`
- Submit test report แล้วเกิด row ใหม่ใน Sheet `PrescribingErrors`
- Manage Data verify Admin ได้
- Visualization กด Apply/Reset ได้
- Export XLSX ได้
- Medication search แสดง suggestion หลัง focus/พิมพ์ 2 ตัวอักษร
