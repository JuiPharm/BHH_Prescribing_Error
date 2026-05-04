# Drug Search Enhanced

Patch นี้ทำให้ช่อง “ยาที่เกิด Prescribing Error ตัวที่ 1” และ “ตัวที่ 2” พิมพ์ค้นหาแบบ autocomplete ได้เหมือนช่องแพทย์

## สิ่งที่เพิ่ม

- ค้นหาจากชื่อสามัญยา / ชื่อการค้า / รูปแบบยา / Drug group / Subclass / optional code
- รองรับการพิมพ์บางส่วน เช่น `para`, `amlo`, `cef`, `inj`, `tab`
- ช่องยา 1 เมื่อเลือกจากรายการ จะเติม DrugGroup และ Subclass ให้อัตโนมัติ
- ช่องยา 2 เลือกจากรายการได้ แต่ไม่บังคับ
- ไม่เปลี่ยน Google Sheet schema เดิม

## Files changed

- `index.html`
- `assets/js/app.js`
- `assets/js/config.js`

## Test

1. เปิดหน้า Report
2. คลิกช่องยา 1
3. พิมพ์บางส่วนของชื่อยา เช่น `para`
4. ต้องเห็น suggestion list
5. เลือกยา แล้วตรวจว่า DrugGroup/Subclass ถูกเติม
6. ทดสอบช่องยา 2 ด้วยคำค้นอื่น
