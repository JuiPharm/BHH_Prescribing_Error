# Visualization Drug Group Fix

## Problem

The previous `Reports by Drug Group` chart counted only the `DrugGroup` value stored on the report row. In the current form this value is populated from Drug 1 only, so records with Drug 2 in a different drug group were under-counted or missed.

## Fix

The Apps Script backend now builds drug involvement from both `Drug1` and `Drug2` by matching each drug name against the `Medication` master sheet. The visualization response now includes:

- `aggregates.byDrugGroup` — distinct report involvement by drug group across Drug 1 + Drug 2
- `aggregates.byDrugName` — top involved drugs across Drug 1 + Drug 2
- `aggregates.bySubclass` — distinct report involvement by subclass across Drug 1 + Drug 2
- `aggregates.byGeneric` — distinct report involvement by generic across Drug 1 + Drug 2
- `aggregates.drugGroupBySeverity` — Drug Group × Severity matrix

If Drug 1 and Drug 2 belong to the same drug group in a single report, that report is counted once for that drug group. If they belong to different groups, the report contributes once to each involved group. This is intentional for medication safety analysis because a multi-drug prescribing error can involve more than one drug group.

## Files changed

- `apps-script/Code.gs`
- `assets/js/app.js`
- `index.html`
- `assets/js/config.js`

## Deployment

1. Replace frontend files in the GitHub Pages repo.
2. Replace Apps Script `Code.gs` and deploy a new Web App version.
3. Open the GitHub Pages site and hard refresh with `Ctrl + F5`.
4. Click `รีเฟรชข้อมูลอ้างอิง` and then `Visualization > รีเฟรช`.

## Test cases

1. Submit a report where Drug 1 and Drug 2 are in different drug groups.
2. Open Visualization.
3. `Reports by Drug Group` should count both involved groups.
4. Filter by the Drug 2 group; the record should still appear.
5. Check `Top Drugs Involved` and `Drug Group × Severity`.
