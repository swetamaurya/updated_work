# Updated Work

## Recent Changes

1. **`processedToBank` API**
   - Resolved an issue where a record could still be rejected after it had already been approved.
   - Added handling for `breRejectPullAfter` to reset it to `null`, so no unnecessary cooldown period is triggered.

2. **`getOverdueLoans` API (New)**
   - Introduced a new API to fetch overdue loan records.
   - Added filtering support using `startDate` and `endDate`.
   - The API returns only overdue loans, and the same filtered dataset is available for export.

3. **`exportBureauFormat` API (New)**
   - Added a new API to export loan data in bureau-specific format.
   - This format is prepared for sharing data with **Equifax**.
