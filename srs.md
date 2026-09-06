# Software Requirements Specification (SRS)
## A.Ross Trading & Services Inventory and Form Generator

**Version:** 1.1  
**Status:** Revised draft with supplied sample formats mapped  
**Platform:** Android 8.0+

## 1. Purpose

This SRS defines an offline-first Android application used by one A.Ross Trading and Services owner/operator on one device. It covers registered customers, equipment history, Customer Service Reports (CSRs), inventory, customer pricing, internal Billing Statements, payments, Payment Acknowledgments, signatures, reporting, and backup/restore.

The app has no server and needs no network for normal operation. Connectivity is used only outside core operation when the owner manually shares or retrieves files through Android apps such as email or Google Drive.

The generated Billing Statement and Payment Acknowledgment are internal business documents and do not replace BIR-registered tax invoices or receipts.

## 2. Definitions

| Term | Definition |
|---|---|
| CSR | Customer Service Report for one visit and one customer equipment record. |
| Registered customer | Named customer profile required for every CSR and Billing Statement. |
| Item | Whole-unit part, supply, or product tracked in inventory. |
| Equipment | Reusable machine/asset record belonging to a customer. |
| Base selling price | Default customer charge for an item; not acquisition cost. |
| Customer price | Selling-price rule for one customer and item. |
| One-time override | Owner-authorized selling price used once with a recorded reason. |
| Inventory movement | Append-only stock increase/decrease record. |
| Billing Statement | Internal customer-charge document labeled `Not a Tax Invoice`. |
| Payment Acknowledgment | Internal payment record document labeled `Not a Tax Receipt`. |
| Business date | Owner-selected date, which may be backdated. |
| Operational timestamp | Actual device creation/finalization time retained for audit. |
| Finalization | Atomic transition that validates, numbers, freezes, and posts applicable effects. |
| `.arossbackup` | ZIP package containing schema-versioned data and non-regenerable assets. |

## 3. Product Constraints

- Single user, Android device, business location, and stockroom.
- No anonymous walk-in profile; all transactions require a registered customer.
- No backend, synchronization, multi-device support, roles, supplier management, purchase orders, customer returns, refunds, credits, or arbitrary payment installments.
- Inventory quantities are positive whole numbers. Services have quantity one and customizable rates.
- UUID primary keys are used. Customer-facing numbers use independent finalization-time sequences.
- The database starts clean; paper history is not migrated.
- Item acquisition cost and internal service/labor cost are not tracked, so true profit is out of scope.
- The supplied CSR PDF and Billing Statement image define the baseline visual structure. Their business data/wording are not hard-coded because the samples conflict and some wording has been superseded by confirmed product decisions.

## 4. Functional Requirements

### 4.1 Access and settings

- **FR-1.1:** All data entry, calculations, search, finalization, PDF generation, export creation, and local import validation shall work without internet.
- **FR-1.2:** Optional app access protection shall use Android biometrics with device-credential fallback rather than an unrecoverable app-only PIN.
- **FR-1.3:** Settings shall include business logo, business/contact data, owner/preparer identity and saved signature, VAT display mode/rate, low-stock notification preference, document display settings, and backup history.
- **FR-1.4:** Settings used by a finalized document shall be snapshotted; later changes affect future documents only.
- **FR-1.5:** VAT display shall be globally disabled, VAT-inclusive, or VAT-exclusive with a configured rate. It is informational and shall not remove `Not a Tax Invoice`.

### 4.2 Customers

- **FR-2.1:** Every CSR and Billing Statement shall reference a registered Customer.
- **FR-2.2:** Customer fields shall include name, address, contact number, email, active state, and timestamps. Template review may add fields.
- **FR-2.3:** Duplicate names shall be allowed after a warning; relationships shall use UUIDs, not names.
- **FR-2.4:** Referenced Customers shall be deactivated rather than hard-deleted.
- **FR-2.5:** The owner may merge duplicates. All relationships shall be preserved and the source/surviving IDs audited.
- **FR-2.6:** Customer history shall show equipment, CSRs, Billing Statements, payments, item sales, and historical prices.

### 4.3 Equipment

- **FR-3.1:** Equipment shall contain customer ID, machine/type, model, serial number, nickname/location, notes, active state, and timestamps.
- **FR-3.2:** Serial numbers shall have no uniqueness or duplicate validation.
- **FR-3.3:** Each CSR shall reference exactly one Equipment record; a multi-machine visit requires separate CSRs.
- **FR-3.4:** A finalized CSR shall snapshot its rendered equipment data.
- **FR-3.5:** A follow-up visit shall create a new CSR linked to the preceding CSR rather than modifying it.

### 4.4 Inventory catalog and movement

- **FR-4.1:** Item fields shall include name, optional SKU/code, description, unit label, base selling price, low-stock threshold, active state, and timestamps.
- **FR-4.2:** Base price is selling price only; acquisition cost is not tracked in v1.
- **FR-4.3:** A duplicate SKU/code shall trigger a warning and explicit owner bypass. Each bypass shall be audited; SKU is not a hard unique key.
- **FR-4.4:** Items may be added, edited, deactivated, or reactivated. Referenced items shall not be hard-deleted.
- **FR-4.5:** Inactive items shall be unavailable for new selection but remain in history and eligible for corrective Restock/Consumption operations.
- **FR-4.6:** Inactive items shall never trigger low-stock alerts.
- **FR-4.7:** Active items at/below threshold shall be marked low stock. A global setting shall disable notifications without deleting thresholds/dashboard data.
- **FR-4.8:** Manual stock actions shall be Restock and Consumption. Both require a positive integer quantity and description; Consumption may optionally reference a CSR.
- **FR-4.9:** Opening stock shall be a Restock movement with an opening-balance description.
- **FR-4.10:** Every stock change shall create an append-only InventoryMovement; stock shall never be silently edited.
- **FR-4.11:** Current stock shall be derived from or atomically reconciled with InventoryMovement totals.
- **FR-4.12:** No operation may make stock negative. There is no override or backorder.
- **FR-4.13:** Sales History shall contain billable finalized item lines only. Movement History shall include restocks, sales, non-billable use, consumption, reversals, and corrections.

### 4.5 Customer pricing

- **FR-5.1:** The owner may maintain customer-specific selling prices for Customer–Item pairs.
- **FR-5.2:** Resolution order shall be one-time override, active customer price, then base selling price.
- **FR-5.3:** A one-time override requires a reason and shall not update saved pricing unless the owner explicitly requests it.
- **FR-5.4:** Price changes apply only to future finalizations and never recalculate history.
- **FR-5.5:** If pricing changes while a draft is open, finalization shall show the difference and allow current price or the old draft price as a logged override.
- **FR-5.6:** Customer prices shall be versioned with effective timestamps rather than destructively overwritten.

### 4.6 Services

- **FR-6.1:** Service fields shall include name, description, base rate, active state, and timestamps.
- **FR-6.2:** Services may be added, edited, deactivated, or reactivated.
- **FR-6.3:** Service-line quantity shall be one. The owner may customize its customer rate on a draft.
- **FR-6.4:** The finalized rate shall be frozen and shall update the catalog only when explicitly saved.
- **FR-6.5:** Ad-hoc services shall preserve entered descriptions/rates and have no Service link unless saved to the catalog.
- **FR-6.6:** Services shall not affect inventory or carry internal labor/service cost.

### 4.7 Expenses

- **FR-7.1:** Expense data shall include description, actual cost, billable flag, and billed amount when billable.
- **FR-7.2:** Billable expenses appear as customer charges. Non-billable expenses are operator-only and excluded from customer PDFs.
- **FR-7.3:** Billed amount may differ from actual cost.
- **FR-7.4:** All actual expense costs affect Net Revenue After Recorded Expenses.
- **FR-7.5:** A Billing Statement may contain only a billable expense. Non-billable expenses alone cannot produce an issuable statement.

### 4.8 Customer Service Reports

- **FR-8.1:** CSR document state shall be separate from service outcome.
- **FR-8.2:** Document states: `draft`, `finalized`, `voided`.
- **FR-8.3:** Service outcomes: `completed`, `incomplete`, `waiting_for_parts`, `under_observation`.
- **FR-8.4:** A CSR with any outcome may be finalized.
- **FR-8.5:** A draft has a UUID but no CSR number.
- **FR-8.6:** Finalization shall atomically allocate the next `CSR-000001`-style number and freeze content.
- **FR-8.7:** CSR data shall include Customer Name, Address, Date, Machine, CSR No., Model, Serial No., Reported Problem, Diagnosis, Action Taken, Status After Service, Recommendations, Machine Status, Billing, Warranty, Customer's Remarks, Total Bill, Serviced By, Acknowledged By, signature state, and operational timestamps, mapped to normalized Customer/Equipment/usage records where applicable.
- **FR-8.8:** Warranty shall be unrestricted owner-entered text without a fixed duration/template or automated calculation.
- **FR-8.9:** Item use shall be billable or non-billable. Both deduct stock at finalization; only billable use contributes to customer charges.
- **FR-8.10:** Drafts shall not reserve/deduct inventory; availability is shown and rechecked in the finalization transaction.
- **FR-8.11:** Finalizing CSR billing shall create one stock transaction/movement set for its item use.
- **FR-8.12:** A finalized CSR is immutable; corrections use linked Void & Reissue.
- **FR-8.13:** Follow-up work creates a separately numbered linked CSR.
- **FR-8.14:** Finalized CSRs shall support a shareable portrait Legal-size (8.5 × 14 inch) PDF matching the supplied source proportions.
- **FR-8.15:** The CSR PDF shall use the sample hierarchy: centered A.Ross logo; centered address/contact/service lines; divider; centered `Customer Service Report` title; ruled customer/equipment grid; ordered content sections; right-side Total Bill box; and bottom-left/bottom-right signature blocks.
- **FR-8.16:** The sample's visible row counts (three each for Reported Problem, Diagnosis, Action Taken, and Billing; two each for Recommendations and Customer's Remarks) are minimum layout slots, not data limits. Additional entries shall flow to continuation pages.
- **FR-8.17:** Status After Service shall render the four confirmed choices in one ruled selection row when space permits.
- **FR-8.18:** The blank second page in the supplied source PDF shall be treated as a scan/export artifact and shall not be generated.
- **FR-8.19:** A CSR may contain inventory item usage, service usage, or both. Each selected service has quantity one and stores the catalog rate or an owner-authorized override with its reason.
- **FR-8.20:** CSR Total Bill shall be read-only and automatically equal the sum of billable item quantities at their resolved selling prices plus all selected service rates. Non-billable item usage is excluded.
- **FR-8.21:** Draft totals shall recalculate whenever CSR fields, item usage, service usage, or service-rate overrides change. Finalization shall recheck current prices according to the selected policy and freeze the computed total in the CSR snapshot.

### 4.9 Billing Statements

- **FR-9.1:** The title shall be `Billing Statement — Not a Tax Invoice`; `Official Receipt` shall not be configurable.
- **FR-9.2:** A draft has a UUID but no BS number.
- **FR-9.3:** Every statement references a registered Customer and may reference at most one CSR.
- **FR-9.4:** One CSR may have multiple statements; one statement may not consolidate multiple CSRs.
- **FR-9.5:** Statements may combine eligible CSR charges, direct items, services, and billable expenses.
- **FR-9.6:** At least one item, service, or billable expense is required.
- **FR-9.7:** A finalized CSR charge/movement may be billed at most once. Already-billed source lines shall be unavailable.
- **FR-9.8:** CSR-posted item use shall reference existing stock transactions and never deduct again.
- **FR-9.9:** Direct/additional item lines shall create their own stock transaction at statement finalization.
- **FR-9.10:** Drafts do not reserve/deduct stock; finalization atomically rechecks it.
- **FR-9.11:** Finalization shall allocate the next `BS-000001` number, post new effects, freeze snapshots, and commit structured writes atomically.
- **FR-9.12:** Retries/double taps shall be idempotent and never duplicate numbers, records, or movement.
- **FR-9.13:** Standalone statements without a CSR shall be allowed.
- **FR-9.14:** A statement with an active payment cannot be voided. An unpaid finalized statement may be voided with a required reason.
- **FR-9.15:** Voiding stock-affecting content requires an item disposition: unused/returned to stock or installed/consumed/not returned.
- **FR-9.16:** The Billing Statement PDF shall follow the supplied portrait layout: logo at upper left; business identity block at upper right; full-width divider; client block at left; BS number/date block at right; charge table; totals at right; and disclaimer at bottom left.
- **FR-9.17:** The charge table shall use `Description`, `Quantity`, `Unit Price`, and `Amount` columns. Quantity may render the item's unit label while remaining an integer in storage.
- **FR-9.18:** Item, service, and billable-expense lines shall share the table and remain distinguishable through description/type labels. The totals block shall extend the sample with Discount, VAT display when enabled, Payments Received, and Balance Due as applicable.
- **FR-9.19:** The sample's `Invoice` number and receipt/VAT footer are visual placeholders only. The generated document shall use its BS number and the fixed internal-document wording from FR-9.1 plus the frozen VAT-display setting.

### 4.10 Money, discounts, and VAT display

- **FR-10.1:** Currency shall be PHP stored as integer centavos.
- **FR-10.2:** Inventory quantities shall be integers; service quantity shall be one.
- **FR-10.3:** Each line is rounded to two decimals; rounded lines are summed; percentage discount is calculated/rounded once on the combined subtotal.
- **FR-10.4:** `Subtotal = billable items + services + billable expense amounts`.
- **FR-10.5:** Discount is optional and fixed or percentage.
- **FR-10.6:** `Discounted Total = Subtotal − Discount`.
- **FR-10.7:** Percentage must be 0–100; fixed discount cannot exceed Subtotal; negative money is invalid.
- **FR-10.8:** Discount affects only the overall total and is not allocated across reporting categories.
- **FR-10.9:** `Current Balance = Discounted Total − active Payments`.
- **FR-10.10:** VAT display shall use the statement's frozen global mode/rate snapshot and remain informational.

### 4.11 Payments and acknowledgments

- **FR-11.1:** At statement finalization the owner chooses Paid in Full, Down Payment, or Pay Later.
- **FR-11.2:** Paid in Full requires one payment equal to Discounted Total.
- **FR-11.3:** Down Payment permits exactly one initial amount greater than zero and below Discounted Total; the full remaining balance is paid later in one payment.
- **FR-11.4:** Pay Later records no initial payment; the full balance is paid later in one payment.
- **FR-11.5:** Arbitrary installments, a second down payment, remaining-balance underpayment, and overpayment are blocked.
- **FR-11.6:** Status is calculated as `Unpaid`, `Balance due`, or `Paid`; there is no due-date/overdue state.
- **FR-11.7:** Payment fields include statement, amount, business date, operational timestamp, method, required reference where applicable, note, state, and void reason.
- **FR-11.8:** Methods: Cash, Bank Transfer, GCash/e-wallet, Check, Other. Non-cash payments require a reference.
- **FR-11.9:** Payment finalization allocates the next `PA-000001` number.
- **FR-11.10:** Each finalized payment shall generate `Payment Acknowledgment — Not a Tax Receipt`, referencing statement, amount, and remaining balance.
- **FR-11.11:** Payments are immutable; correction uses Void Payment with required reason and preserves the original.
- **FR-11.12:** Payments never affect inventory.

### 4.12 Dates and numbering

- **FR-12.1:** CSR/BS/PA sequences are independent and allocated only at finalization.
- **FR-12.2:** Numbers are never reused after void, share/render failure, reissue, or restore.
- **FR-12.3:** Drafts display Draft and consume no number.
- **FR-12.4:** Business dates may be backdated with a required reason; future dates are rejected.
- **FR-12.5:** Backdating never inserts/reorders numbers; finalization receives the next number.
- **FR-12.6:** Creation/finalization/void timestamps remain separate from business dates and shall store an unambiguous timestamp plus the captured local offset.

### 4.13 Signatures and external signing

- **FR-13.1:** In-person customer and preparer signatures shall be drawable and print-legible.
- **FR-13.2:** Preparer identity/signature may load from Settings and is snapshotted when issued.
- **FR-13.3:** Remote signing is manual: share unsigned PDF, customer signs externally, owner imports returned PDF using Android's picker.
- **FR-13.4:** Financial/inventory content may finalize before a remote signature returns.
- **FR-13.5:** Signature status is independent: `not_required`, `pending`, `signed_in_person`, `signed_document_attached`, `declined`, `no_response` as applicable.
- **FR-13.6:** Later attachment is append-only and never unlocks finalized content.
- **FR-13.7:** Unsigned PDFs show number, revision ID, and content fingerprint for manual matching.
- **FR-13.8:** Original and returned files are preserved; the app makes no cryptographic verification claim.

### 4.14 PDF and sharing

- **FR-14.1:** CSR/BS/PA PDFs shall render locally with bundled templates/assets.
- **FR-14.2:** CSR output shall use portrait Legal size; Billing Statement and Payment Acknowledgment output shall use portrait A4. All shall support overflow pages, repeated applicable headings, unsplit lines where practical, and grouped totals/signatures.
- **FR-14.3:** Finalized records shall freeze all rendered profile, equipment, business, line, monetary, VAT, footer, and render-template data. An app update shall not remove the information needed to reproduce an older document.
- **FR-14.4:** Rendering failure after finalization yields `PDF pending/error`; retry creates no new number/effect.
- **FR-14.5:** Sharing failure yields `Not yet shared`; retry does not change finalization.
- **FR-14.6:** Generated PDFs shall live in persistent app-private storage and may be regenerated from frozen data.
- **FR-14.7:** The supplied samples define layout hierarchy and proportions. Owner-configured business identity, agreed document titles, and functional additions in this SRS take precedence over sample data and superseded wording.

### 4.15 Reporting

- **FR-15.1:** Dashboard shall show active low-stock items, recent CSRs/statements/movements/payments, and backup status.
- **FR-15.2:** Sales reports use statement business dates and exclude voided statements from ordinary totals.
- **FR-15.3:** Collection reports use Payment business dates and exclude voided payments.
- **FR-15.4:** Audit reports show business/operational dates, backdate/override/void reasons, SKU bypasses, and voided records.
- **FR-15.5:** Financial reports show Gross Sales, Discounts, Net Customer Charges, Cash Collected, Outstanding Balances, Recorded Expenses, and Net Revenue After Recorded Expenses. For the selected scope, `Net Revenue After Recorded Expenses = Net Customer Charges − actual cost of all linked billable and non-billable expenses`.
- **FR-15.6:** No report shall label Net Revenue After Recorded Expenses as profit.
- **FR-15.7:** Inventory reports shall separate billable sales history from all movements.
- **FR-15.8:** Reports shall filter by relevant customer, item, equipment, number, type, state, and date range and export to CSV/PDF where applicable.

### 4.16 Backup and restore

- **FR-16.1:** Every committed mutation shall increment a monotonic database revision/change marker.
- **FR-16.2:** Export creates one `.arossbackup` ZIP containing manifest, `schema_version`, structured JSON, signatures, returned signed PDFs, and attachment index.
- **FR-16.3:** Non-regenerable signed assets shall always be included.
- **FR-16.4:** Regenerable PDFs may be omitted because frozen data/versioned templates remain available.
- **FR-16.5:** Attachments shall use deterministic filenames such as `CSR-000123-signed.pdf`.
- **FR-16.6:** Manifest includes export time, highest revision, record counts, asset metadata, and checksums.
- **FR-16.7:** UI shows changes included/not included in the latest export and does not claim Drive received it.
- **FR-16.8:** Export opens Android sharing for manual private-Drive placement; direct Google sign-in/upload is excluded.
- **FR-16.9:** Backups are unencrypted by product decision. A sensitive customer/signature data warning is required.
- **FR-16.10:** A dismissible notice appears seven days after the first finalized record and thereafter seven days after export only when data changed.
- **FR-16.11:** Import is Replace-only.
- **FR-16.12:** Before writing, import validates ZIP/schema/JSON/relationships/assets/checksums/sequences.
- **FR-16.13:** Existing local data triggers a safety export first; inability to do so produces a blocking warning.
- **FR-16.14:** Valid import atomically replaces data/assets; invalid import changes nothing.
- **FR-16.15:** Supported older schemas migrate forward; unsupported newer schemas fail clearly.
- **FR-16.16:** Sequence high-water marks prevent reuse after restore.
- **FR-16.17:** Finalized business records are never automatically pruned.

## 5. Conceptual Data Model

```text
Settings
  id, business/contact data, owner name/signature asset,
  vat mode/rate, low-stock notification flag, app-lock flag, timestamps

Customer
  id, name, address, contact_number, email, active,
  merged_into_customer_id?, timestamps

CustomerEquipment
  id, customer_id, machine_type, model, serial_number,
  nickname_or_location, notes, active, timestamps

Item
  id, name, sku?, description, unit_label, base_selling_price_centavos,
  low_stock_threshold, active, timestamps

CustomerItemPrice
  id, customer_id, item_id, selling_price_centavos,
  effective_from, effective_to?, created_at

Service
  id, name, description, base_rate_centavos, active, timestamps

ServiceReport
  id, csr_number?, customer_id, equipment_id, follows_csr_id?,
  document_state, service_outcome, business_date, backdate_reason?,
  template fields, serviced_by_snapshot, signature_status,
  content_snapshot, render_template_snapshot, template_version, pdf_state, share_state,
  created_at, finalized_at?, voided_at?, void_reason?

ServiceReportItemUsage
  id, service_report_id, item_id, quantity_integer, billable,
  resolved_selling_price_centavos?, price_source?, override_reason?,
  description_snapshot, billed_statement_line_id?

BillingStatement
  id, bs_number?, customer_id, service_report_id?, document_state,
  business_date, backdate_reason?, subtotal, discount data,
  discounted_total, payment_choice, vat_snapshot, content_snapshot,
  render_template_snapshot, template_version, signature/pdf/share states,
  timestamps/void data

BillingStatementLine
  id, billing_statement_id, line_type(item|service|expense),
  source_csr_usage_id?, item_id?, service_id?, expense_id?,
  description_snapshot, quantity_integer, unit_price, amount,
  price_source?, override_reason?

Expense
  id, customer_id, service_report_id?, billing_statement_id?,
  description, business_date, actual_cost, billable, billed_amount?, created_at

Payment
  id, pa_number?, billing_statement_id, amount, business_date,
  backdate_reason?, method, reference_number?, note?,
  state(active|voided), void_reason?, operational timestamps

InventoryMovement
  id, item_id, type(restock|sale|nonbillable_usage|consumption|reversal),
  quantity_delta_integer, service_report_id?, billing_statement_id?,
  source_movement_id?, description, created_at

StockTransaction
  id, customer_id?, service_report_id?, billing_statement_id?,
  type, state, timestamps, note?

DocumentAttachment
  id, owner_type, owner_id, type, deterministic_filename,
  private_path, checksum, created_at

AuditEvent
  id, event_type, entity_type, entity_id, details_json, created_at

BackupManifest
  id, filename, schema_version, highest_revision,
  record_counts_json, checksum, created_at

Sequence
  name(CSR|BS|PA), high_water_mark
```

### 5.1 Invariants

- One source CSR usage line maps to at most one BillingStatementLine.
- Drafts have no CSR/BS/PA number.
- Number allocation and finalization commit together.
- Stock movement and its source/transaction link commit together.
- Active payments never exceed balance.
- At most one down payment exists; the only later active payment equals the full balance.
- A statement with active payments cannot be voided.
- Historical snapshots, not mutable profile/catalog data, render finalized documents.
- External signed attachments are non-regenerable and included in backups.

## 6. Required Atomic Operations

The following shall use exclusive SQLite transactions and idempotency guards:

1. CSR finalization: validate, allocate number, freeze, post movements/transaction, update sequence/state.
2. Billing Statement finalization: validate, prevent duplicate source billing, allocate number, freeze, post direct-item movements, create selected initial payment, update sequences/state.
3. Payment finalization: recheck balance/rules, allocate PA number, insert payment, update sequence.
4. Void/reissue: append reversal/correction movement and audit data without rewriting history.
5. Customer merge: repoint relationships while preserving merge history.
6. Replace import: stage/validate the entire package before atomic replacement.

PDF rendering, file sharing, and email are outside database transactions. Their failure shall never repeat a committed business action.

## 7. Edge Cases

### 7.1 Two drafts request the final unit

Drafts make no reservation. Both may display it; only the first valid finalization succeeds. The second is blocked and identifies changed availability.

### 7.2 Double tap/retry

The same document UUID/idempotency key returns the existing result without another number, payment, or movement.

### 7.3 Linked CSR and Billing Statement

CSR-posted use is referenced, not reposted. Direct statement items use another transaction. Source-line uniqueness blocks duplicate billing across statements.

### 7.4 Catalog/profile changes

Finalized snapshots remain unchanged. Draft price changes follow FR-5.5. Deactivation never erases history.

### 7.5 Duplicate identifiers

Names, serial numbers, and SKUs are not hard identifiers. Warnings assist the owner; SKU bypasses are audited; UUIDs preserve integrity.

### 7.6 Insufficient stock

Finalization fails before writes and identifies each item. Negative stock/backorder/override are unavailable.

### 7.7 Draft editing/deletion

Draft changes need no reversal because drafts have no effects. Draft deletion consumes no number.

### 7.8 Voiding used stock

Only physically unused items return to stock. Installed/consumed items remain deducted through linked consumption movement.

### 7.9 Non-billable use

It deducts inventory and appears in movement/CSR history but never appears as customer charge or sale.

### 7.10 Payment boundary

After a down payment, an amount below or above the full remaining balance is blocked. Pay Later also requires one full later payment. Voided payments do not count toward balance.

### 7.11 Discount versus down payment

Before finalization, totals recalculate. A down payment equal to/above the discounted total is invalid for Down Payment; when equal, Paid in Full must be selected.

### 7.12 Backdating

Selected date/reason are stored; numbering remains in actual finalization order. Sales use business date and audits expose both dates.

### 7.13 PDF/share failure

Structured finalization remains committed. PDF/share states show pending/error/not shared and can retry without new business effects.

### 7.14 Remote signature absent or wrong

The finalized record remains pending/no response. Later files append without unlocking content. The app shows expected number/fingerprint for manual confirmation and claims no cryptographic verification.

### 7.15 Backup destination uncertainty

The app records local export/share completion only and cannot verify Drive retention. The unencrypted-data warning remains visible.

### 7.16 Corrupt/incompatible backup

Validation fails before replacement; existing data stays untouched.

### 7.17 Older restore

Replace warns, creates a safety export where possible, and restores included high-water marks. Records absent from the chosen backup cannot be reconstructed automatically.

### 7.18 Storage pressure

Files are not marked complete until closed/validated. Storage errors are explicit. Business finalization remains retry-safe if only derived PDF creation fails.

### 7.19 Low-stock notifications disabled

Notifications are suppressed; thresholds/dashboard data remain. Inactive items never notify.

### 7.20 Customer return request

No return/refund workflow is provided. Administrative correction uses void/reissue and physical-disposition rules and is not presented as a customer return.

## 8. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Offline | All core functions, SQLite writes, signatures, PDFs, export creation, and local import validation work without network. |
| Integrity | Finalization and stock/payment writes are atomic, idempotent, and constrained. |
| Audit | Finalized stock, price, discount, payment, number, and document events are never silently rewritten/deleted. |
| Performance | Common local lookup/calculation target is under 100 ms; large file tasks show progress. |
| Durability | Versioned migrations, private persistent files, checksums, revision coverage, and recovery rehearsal are required. |
| Security | Android credentials may protect access. Unencrypted exports carry a sensitive-data warning. |
| Usability | Drafts autosave/recover after interruption and clearly show draft/finalized/pending states. |
| Accessibility | Readable scaling, adequate touch targets, non-color-only labels, and supported screen-reader semantics. |
| PDF quality | Legible portrait Legal CSR output and portrait A4 Billing Statement/Payment Acknowledgment output, including tested overflow pages based on the supplied samples. |
| Compatibility | Phase 0 tests release builds on actual Android 8 hardware, including SQLite, PDF, signature WebView, picker, and sharing. |
| Migration | App upgrades preserve records, assets, snapshots, and sequence marks; supported older backups migrate forward. |

## 9. Verification

Testing shall cover at minimum:

- Rollback during CSR, statement, payment, void, merge, and import operations.
- Double-tap/idempotency and number uniqueness.
- CSR/statement transaction deduplication.
- Insufficient stock and competing open drafts.
- Billable/non-billable items and expenses.
- Draft price changes and historical snapshot integrity.
- Full payment, down payment/balance, Pay Later, invalid installment, overpayment, and voided payment.
- Backdating, sequence order, and report-date behavior.
- Customer merge, SKU bypass audit, and duplicate serials.
- Signed-PDF import, missing-attachment recovery, and full restore.
- Corrupt/newer-schema backup rejection without partial writes.
- Offline, long, multi-page CSR/BS/PA generation on target hardware.
- Render/share failure after successful finalization.
- Low-stock notification disablement and inactive-item suppression.
- App/schema upgrade with existing records and attachments.

## 10. Sample Format Mapping and Remaining Asset Confirmation

### 10.1 Customer Service Report sample

- Source PDF contains two pages at 612 × 1008 pt. Page 1 is a portrait Legal-size form; page 2 is blank and shall not be reproduced.
- Header: large centered A.Ross logo, centered address/contact lines, centered services line, horizontal divider, and centered report title.
- Details grid: Customer Name full width; Address/Date; Machine/CSR No.; Model/Serial No.
- Ordered sections: Reported Problem, Diagnosis, Action Taken, Status After Service, Recommendations, Machine Status, Billing, Warranty, Customer's Remarks, Total Bill, Serviced By, and Acknowledged By.
- The existing signature visible in the sample is example/source content and shall not be embedded as the application's default signature.

### 10.2 Billing Statement sample

- Portrait A4-like page with generous whitespace and a bottom-anchored disclaimer.
- Header: logo left; business identity/contact block right; full-width divider.
- Details: Client/name/address left; document number/date right; second divider.
- Charges: Description, Quantity, Unit Price, and Amount columns with peso formatting.
- Totals: right-aligned ruled block. The application extends it with discount, optional VAT display, payments, and balance.
- Functional requirements add signature blocks and dynamic service/expense rows even though the sample does not show them.

### 10.3 Precedence and remaining confirmation

The two samples contain different business addresses, and the Billing sample uses superseded `Invoice` and receipt/VAT wording. Therefore:

1. Settings snapshots are authoritative for logo, address, contact information, and VAT display.
2. `Billing Statement — Not a Tax Invoice` and `Payment Acknowledgment — Not a Tax Receipt` remain authoritative titles.
3. A clean source logo and confirmation of the active business header text are desirable before production visual acceptance.
4. Phase 0 shall create filled long-content prototypes for both page sizes and obtain owner approval for typography, spacing, pagination, and the new signature/totals content.

No behavioral requirements question remains open.
