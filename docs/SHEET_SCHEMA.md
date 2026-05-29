# Google Sheet Schema

ระบบใช้ชีตหลักดังนี้

## department

| Column | Header |
|---|---|
| A | Department |

## Staff

| Column | Header | Rule |
|---|---|---|
| A | StaffID | Text, 6 alphanumeric characters |
| B | Name | Text |
| C | Role | User หรือ Admin |

## Doctor

| Column | Header |
|---|---|
| A | Name |
| B | Department |
| C | Specialty |
| D | Type |

## Medication

| Column | Header |
|---|---|
| A | GenericName |
| B | BrandName |
| C | Form |
| D | DisplayName |
| E | DrugGroup |
| F | Subclass |

## Lists

| Column | Header |
|---|---|
| A | Category |
| B | Value |
| C | SortOrder |

## PrescribingErrors

| Column | Header | Rule |
|---|---|---|
| A | Timestamp | DateTime |
| B | ReportID | Text |
| C | PrescribingErrorFrom | IV CHEMO / OPD PHARMACY PHARMACY / IPD PHARMACY PHARMACY |
| D | HN | Text, `07-XX-XXXXXX` |
| E | EventDate | Date |
| F | EventTime | Time/Text |
| G | Department | Text |
| H | Doctor | Text |
| I | Specialty | Text |
| J | DoctorType | Text |
| K | ErrorDetails | Text |
| L | Consult | Text |
| M | ErrorType | Text |
| N | MedicationReconciliation | Text |
| O | ReporterStaffID | Text, 6 characters |
| P | Drug1 | Text |
| Q | Drug2 | Text |
| R | DrugGroup | Text |
| S | Subclass | Text |
| T | SeverityLevel | Text |
| U | CreatedBy | Text |
| V | ClientVersion | Text |
| W | UserAgent | Text |

## AuditLog

| Column | Header |
|---|---|
| A | Timestamp |
| B | Actor |
| C | Action |
| D | EntityType |
| E | EntityId |
| F | Before |
| G | After |
| H | Result |
| I | Message |
