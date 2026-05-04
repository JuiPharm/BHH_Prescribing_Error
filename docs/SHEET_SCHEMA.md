# Sheet Schema

Apps Script จะ auto-create sheet/header ถ้าไม่พบ

## department

| Column |
|---|
| Department |

## Staff

| Column | Note |
|---|---|
| StaffID | unique |
| Name |  |
| Role | User / Admin |

## Doctor

| Column |
|---|
| Name |
| Department |
| Specialty |
| Type |

## Medication

| Column | Note |
|---|---|
| GenericName |  |
| BrandName |  |
| Form |  |
| DisplayName | ใช้แสดงใน drug search |
| DrugGroup | auto-fill จาก Drug 1 |
| Subclass | auto-fill จาก Drug 1 |

## PrescribingErrors

| Column |
|---|
| Timestamp |
| ReportID |
| PrescribingErrorFrom |
| HN |
| EventDate |
| EventTime |
| Department |
| Doctor |
| Specialty |
| DoctorType |
| ErrorDetails |
| Consult |
| ErrorType |
| MedicationReconciliation |
| ReporterStaffID |
| Drug1 |
| Drug2 |
| DrugGroup |
| Subclass |
| SeverityLevel |
| CreatedBy |
| ClientVersion |
| UserAgent |

## AuditLog

| Column |
|---|
| Timestamp |
| Actor |
| Action |
| EntityType |
| EntityId |
| Before |
| After |
| Result |
| Message |
