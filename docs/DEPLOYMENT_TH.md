# วิธี Deploy ระบบ BHH Prescribing Error

## 1) ติดตั้ง Apps Script

1. เปิด Google Sheet ฐานข้อมูล
2. เลือก **Extensions > Apps Script**
3. ลบโค้ดเดิมใน `Code.gs`
4. วางโค้ดจากไฟล์ `apps-script/Code.gs`
5. กด Save
6. Run function `setup()` และอนุญาตสิทธิ์
7. หากเป็น Sheet เดิม ให้ Run function `migrateTextFieldsAndLists()` เพื่อจัดรูปแบบ HN / StaffID / Lists

## 2) Deploy Web App

1. กด **Deploy > New deployment**
2. Select type: **Web app**
3. Execute as: **Me**
4. Who has access: **Anyone**
5. กด Deploy
6. Copy Web App URL ที่ลงท้าย `/exec`

## 3) ตั้งค่า GitHub Pages

แก้ไฟล์ `assets/js/config.js`:

```js
window.PE_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
  API_MODE: 'jsonp',
  LOCK_API_URL: true,
  VERSION: 'github-v5-gas-sheet-fast-hidden-api-2026-05-29'
};
```

จากนั้น Commit ขึ้น GitHub แล้วเปิด GitHub Pages

## 4) ตรวจสอบหลัง Deploy

- หน้าเว็บต้องขึ้น `API Connection: Connected`
- กล่องสถานะระบบต้องไม่แสดง API URL
- กด Ping แล้วต้องขึ้น API connected
- ทดสอบบันทึก HN เช่น `07-16-3914` ต้องลง Sheet เป็น `07-16-003914`
- ทดสอบ StaffID เช่น `000001` ต้องลง Sheet เป็น Text ไม่หายศูนย์นำหน้า
