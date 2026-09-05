# Phase 7 progress

## Available

- Financial summary with inclusive start/end business dates and optional registered-customer filter (including inactive customers).
- Sales, discounts, charges, linked actual expenses, and current outstanding balances use the selected finalized statements. Draft/voided statements and voided payments are excluded.
- Collections use payment business dates independently, including payments against statements issued outside the selected period. Outstanding balances include all active payments on the selected statements; they are current balances, not a historical month-end balance.
- Net Revenue After Recorded Expenses can be negative. Multiple payments and expenses cannot multiply sales totals through joins.
- Financial CSV export retains the filters and calculation scope of the displayed results.
- Current stock report with item/SKU/unit search, active/inactive/low-stock filters, CSV sharing, and links to existing item movement history. Inactive items never enter the low-stock report.
- CSR creation now explains the empty-customer prerequisite and refreshes customer/equipment options when returning to the screen.

## Remaining

- Cross-document search and wider date/state/equipment filters.
- Expanded dashboard, recent activity, and backup status once Phase 8 exists.
- Detailed sales, collections, movement, and audit reports with additional filters.
- Report PDF exports and device validation of CSV sharing.

Phase 8 backup/restore and subsequent device/UAT/release phases are still outstanding. No reporting feature is presented as true profit accounting.
