# Project Plan — A.Ross Trading & Services Inventory and Form Generator

**Version:** 1.1  
**Status:** Revised after requirements, edge-case, and sample-format review  
**Target:** Android 8.0+

## 1. Overview

A.Ross Trading and Services needs a single-device Android application for Customer Service Reports (CSRs), inventory movement, customer-specific pricing, internal billing, payments, signatures, reporting, and recoverable local backups.

The app is offline-first. One owner/operator uses one Android device in v1. Internet is needed only when the owner chooses to share/email files or place backups in a private Google Drive location.

The generated financial document is an internal **Billing Statement — Not a Tax Invoice**. Each finalized payment generates a **Payment Acknowledgment — Not a Tax Receipt**. The app does not replace the business's BIR-registered tax invoice or receipt process.

## 2. Confirmed Boundaries

- One owner/operator, Android device, business location, and stockroom.
- No server, sync, supplier/purchase-order module, customer portal, iOS app, barcode scanning, or roles in v1.
- Every customer must have a registered profile; anonymous/generic walk-ins are unsupported.
- The database starts clean; old paper records will not be backfilled.
- Inventory quantities are whole numbers only. Services have quantity one and an owner-customizable rate.
- Customer returns, refunds, credits, overpayments, and arbitrary payment installments are unsupported.
- Finalized documents are immutable and retain snapshots of all rendered information and their template version.
- True profit is not calculated because item acquisition cost and internal service/labor cost are not tracked. Reports instead show sales, collections, balances, expenses, and **Net Revenue After Recorded Expenses**.
- The supplied CSR PDF and Billing Statement image are the visual baselines. Business identity content is settings-driven because the two samples show different addresses.

## 3. Scope

### In scope

- Registered customers and reusable customer-equipment records.
- Digital CSRs with drafts, outcomes, finalization, void/reissue, follow-up visits, item usage, acknowledgment state, and PDF output.
- Inventory items, integer stock, Restock and Consumption actions, low-stock thresholds, deactivation, and append-only movements.
- Base prices, per-customer prices, and owner-authorized one-time overrides.
- Reusable and ad-hoc services with customizable selling rates.
- Billable/non-billable expenses, actual cost, and optional billed amount.
- Billing Statements with items, services, expenses, optional discounts, optional VAT display, and payment choice.
- Payment choices: paid in full, one down payment followed by one full balance payment, or pay later followed by one full payment.
- Numbered Payment Acknowledgments and payment correction by void entries.
- Drawn in-person signatures and manual email/import of externally signed PDFs.
- Reports for sales, collections, balances, expenses, net revenue after recorded expenses, stock, movements, and audit history.
- `.arossbackup` export/import packages, manual Drive sharing, revision coverage, and seven-day backup notices.
- Optional Android biometric/device-credential app access.

### Out of scope

- BIR tax-document issuance/registration, official receipts, statutory tax reporting, and accounting integration.
- Multiple users/devices/locations, a backend, hosted backup, or synchronization.
- Customer returns, refunds, credits, and arbitrary installments.
- Acquisition costing, FIFO/weighted-average costing, internal labor costing, and true net-profit accounting.
- Quotes/estimates and consolidated statements spanning multiple CSRs.
- Automatic Google Drive authentication/upload and cryptographic verification of external signatures.

## 4. Technology

| Layer | Selected approach | Reason |
|---|---|---|
| App | React Native with Expo development/release builds | Android-focused development with maintained device APIs. |
| Database | `expo-sqlite` behind repositories | Fully offline; exclusive transactions support atomic business writes. |
| PDF | `expo-print` with bundled HTML/CSS templates | Maintained on-device offline PDF generation. |
| Files | Expo file-system/document-picker APIs | Persistent private files and external signed-PDF import. |
| Sharing | Android share sheet through Expo Sharing | Manual email/Drive flow without provider lock-in. |
| Signatures | Maintained signature canvas using a bundled WebView | Offline in-person signatures. |
| Access | Android biometric/device credential | Avoids unrecoverable app-only credentials. |
| Backup | `.arossbackup` ZIP package | Structured JSON plus non-regenerable assets. |

Expo Go is not a production requirement. Phase 0 must verify release builds on the actual Android 8 target.

## 5. Architecture and Integrity Rules

### Identifiers, dates, and numbering

- All entities use UUID primary keys.
- Draft documents have no permanent number.
- At atomic finalization, independent sequences allocate `CSR-000001`, `BS-000001`, and `PA-000001` numbers.
- Numbers are never reused after voiding, failure, reissue, or restore.
- Business dates may be backdated with a required reason; future dates are prohibited. Actual creation/finalization timestamps are retained.

### Document state

- CSR document state: `draft`, `finalized`, `voided`.
- CSR service outcome, tracked separately: `completed`, `incomplete`, `waiting_for_parts`, `under_observation`.
- Billing Statement state: `draft`, `finalized`, `voided`.
- Signature, PDF, sharing, and payment states are separate from document state.
- A finalized CSR may have any outcome. A later visit uses a new linked follow-up CSR.

### Stock source of truth

- Drafts neither reserve nor deduct stock.
- Availability is displayed in drafts and atomically rechecked at finalization.
- Every stock change creates an append-only movement; stock is derived from or reconciled against those movements.
- Manual actions are Restock and Consumption, both with positive integer quantity and required description. Consumption may reference a CSR.
- Opening stock is a Restock movement.
- Negative stock and overrides/backorders are prohibited.
- CSR item usage can be billable or non-billable. Both deduct stock; only billable usage becomes a customer charge.

### Exactly one deduction and charge

- Finalizing CSR billing creates its stock transaction.
- A Billing Statement using finalized CSR lines references that transaction and never deducts the same item again.
- Items added directly to a Billing Statement create a separate stock transaction at statement finalization.
- A standalone Billing Statement posts its own item transaction.
- One CSR may have multiple Billing Statements, but each source line may be billed at most once.
- One Billing Statement may reference at most one CSR.

### Immutability and correction

- Finalized commercial content cannot be edited or deleted. Corrections use Void & Reissue.
- Voiding stock-affecting content requires physical disposition per item: unused/returned to stock or installed/consumed/not returned.
- Installed/consumed items create a linked consumption/write-off movement rather than phantom stock restoration.
- Customer, equipment, item, service, business-setting, price, tax-display, and template changes affect only future documents.

## 6. Workflows

### Customer and equipment

1. Select/create a registered customer with name, address, contact number, and email as applicable.
2. Duplicate customer names are allowed with warnings. Referenced customers are deactivated, not deleted; duplicates can be merged with an audit trail.
3. Each CSR references one reusable equipment record with free-form machine details, model, serial number, nickname/location, and active state.
4. Serial numbers have no validation. A multi-machine visit uses separate CSRs.

### CSR

1. Create an unnumbered autosaved draft for a customer and one equipment record.
2. Enter the fields and sections shown by the supplied CSR: customer/header grid; Reported Problem; Diagnosis; Action Taken; Status After Service; Recommendations; Machine Status; Billing; Warranty; Customer's Remarks; Total Bill; Serviced By; and Acknowledged By.
3. Add billable or non-billable item usage.
4. Finalization rechecks stock, allocates the next CSR number, writes movements atomically, freezes the snapshot, and queues PDF rendering.
5. PDF failure leaves a finalized `PDF pending` record; rendering/sharing can retry without duplicating stock or numbering.

### Pricing

Resolution order is one-time override, then customer price, then base selling price. Overrides require reasons and do not change saved pricing unless explicitly requested. Price changes never alter history. If pricing changes while a draft is open, finalization offers the current price or retains the draft price as a logged override.

### Billing Statement

1. Select a registered customer and optionally one CSR.
2. Add eligible unbilled CSR lines and/or direct inventory items.
3. Add services at quantity one with owner-customizable rates.
4. Add expenses with actual cost, billable flag, and billed amount if billable.
5. Apply an optional fixed or percentage discount to the combined charge subtotal.
6. Select Paid in Full, Down Payment, or Pay Later.
7. Finalization validates values and stock, allocates the next BS number, posts new item movements, freezes rendered data, and queues the PDF.

A statement is valid with at least one item, service, or billable expense. Non-billable expenses alone cannot produce a statement.

### Payments

- Paid in Full requires one payment equal to the total.
- Down Payment allows one amount above zero and below the total. The remaining balance must later be paid in one payment.
- Pay Later has no initial payment and later requires one payment for the full total.
- Arbitrary installments, underpayment of the remaining balance, and overpayment are blocked.
- Status is `Unpaid`, `Balance due`, or `Paid`.
- Amount/date are required. Methods are Cash, Bank Transfer, GCash/e-wallet, Check, and Other; non-cash payments require a reference.
- Each finalized payment gets a PA number and generates a Payment Acknowledgment. Corrections void the original payment with a reason and preserve history.
- A Billing Statement with an active payment cannot be voided.

### Expenses and reporting

- `actual_cost` is the business's cost.
- `billable` controls customer visibility/charging.
- `billed_amount` may differ from actual cost.
- Discounts reduce the overall statement total and are not allocated to categories.
- Reports show Gross Sales, Discounts, Net Customer Charges, Cash Collected, Outstanding Balances, Recorded Expenses, and Net Revenue After Recorded Expenses. For a selected reporting scope, `Net Revenue After Recorded Expenses = Net Customer Charges − actual cost of all linked billable and non-billable expenses`.
- Reports must not call revenue minus recorded expenses true profit.

## 7. PDFs and Signatures

- PDFs use bundled assets/fonts and work offline.
- CSR output uses portrait Legal size (8.5 × 14 inches) to match the supplied PDF. The blank second source page is a scan artifact and is not reproduced.
- Billing Statement and PA output use portrait A4. All document types support overflow pages, repeated applicable headings, unsplit rows where practical, and grouped totals/signatures.
- The CSR follows the sample's centered logo/business header, ruled section layout, status choices, total box, and opposing bottom signature blocks.
- The Billing Statement follows the sample's logo-left/business-block-right header, client/details split, four-column charge table, right-aligned totals, and bottom-left disclaimer, extended with discounts, payments/balance, signatures, services, and expenses required by this specification.
- Frozen data and a retained render-template snapshot protect historical content even after settings, catalogs, or app templates change.
- In-person signatures are drawn on-device.
- For remote signing, the owner shares an unsigned PDF manually, the customer signs externally, and the owner imports the returned PDF.
- Signature state may be not required, pending, signed in person, signed attachment received, declined, or no response.
- Attaching a signed PDF is append-only and cannot change financial content.
- Unsigned PDFs include document number, revision identifier, and content fingerprint for manual matching. No cryptographic-verification claim is made.
- Sharing failure leaves the record finalized as `Not yet shared` and is retryable.

## 8. Backup and Restore

- Every committed mutation increments a revision.
- Export creates one `.arossbackup` ZIP with manifest, schema-versioned JSON, signatures, external signed PDFs, attachment index, record counts, high-water revision, and checksums.
- Deterministic attachment names support manual recovery.
- Generated PDFs may be regenerated from frozen content and retained render-template snapshots; non-regenerable signed files must be included.
- The UI shows changes included/not included in the most recent export and says `Exported`, not `Safely backed up to Drive`.
- The owner manually shares the package to a private Drive location.
- Packages are intentionally unencrypted; the app warns that they contain customer/signature data.
- A dismissible notice starts seven days after the first finalized record and recurs seven days after export only when data changed.
- Import is Replace-only. It validates all data/assets before writing, creates a safety export when local data exists, restores attachments and sequence high-water marks, and replaces atomically.
- Finalized business records are never automatically pruned.

## 9. Notifications and Settings

- Active items at/below their thresholds are low stock.
- Inactive items never trigger low-stock alerts.
- A global setting disables low-stock notifications without deleting thresholds or dashboard information.
- Optional VAT display is globally disabled, VAT-inclusive, or VAT-exclusive with a configured rate. The snapshot is retained per statement, which remains labeled `Not a Tax Invoice`.

## 10. Milestones

| Phase | Deliverable |
|---|---|
| 0 | Requirements sign-off; sample-format mapping; business header/logo confirmation; Expo SQLite atomicity and offline PDF/signature spike on Android 8 |
| 1 | Schema, migrations, repositories, settings, audit log, and integrity tests |
| 2 | Customers, equipment, catalogs, Restock/Consumption, and pricing |
| 3 | CSR lifecycle, item usage, follow-ups, finalization, and PDF |
| 4 | Billing Statements, expenses, discounts, stock integration, and duplicate-billing protection |
| 5 | Payments, balances, Payment Acknowledgments, and corrections |
| 6 | In-person/remote signatures and production PDF templates |
| 7 | Search, dashboards, financial/inventory reports, CSV/PDF export |
| 8 | `.arossbackup` export/import, recovery, revisions, and reminders |
| 9 | Failure-injection, migration, storage, offline, long-document, and device testing |
| 10 | Owner UAT, APK/internal release, and backup/recovery rehearsal |

## 11. Risks and Controls

- **Device loss:** manual Drive export is the only off-device protection; show revision coverage and reminders.
- **Unencrypted backups:** warn clearly and require a controlled private destination.
- **Duplicate deduction/billing:** exclusive transactions, source-line uniqueness, and idempotent finalization.
- **Phantom stock on void:** require physical disposition.
- **Misleading finances:** never label incomplete revenue calculations as profit.
- **Tax confusion:** fixed `Not a Tax Invoice/Receipt` titles; BIR issuance remains external.
- **External signatures:** preserve original/returned files and record manual matching.
- **PDF/storage failure:** commit business data first and provide pending/error retry states.
- **Backdating:** preserve both selected date and actual timestamp/reason.
- **Reference differences:** the samples show different business addresses and the Billing sample uses old Invoice/receipt wording. Source all business data from Settings and retain the agreed Billing Statement/non-tax-document wording.

## 12. Sample-Format Status

The CSR PDF and Billing Statement image were reviewed on 2026-09-05 and their structure is incorporated above and in the SRS. The CSR source is a two-page, 612 × 1008 pt file; page 1 is the actual portrait Legal-size form and page 2 is blank. The Billing Statement image is an A4-like portrait layout.

The samples are layout references, not authoritative business-data sources. Their addresses differ, and the Billing sample contains the superseded labels `Invoice`, `This is not a receipt`, and `All Prices Are VAT Exclusive`. The app instead uses the owner-configured logo, address, contact details, VAT-display setting, and the agreed internal-document titles.

A clean original logo asset and confirmation of the active business address/contact text are still desirable before production PDF sign-off. No behavioral planning question remains open.
