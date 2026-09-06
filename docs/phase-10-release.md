# Phase 10 release and owner UAT

Phase 10 covers owner acceptance, an installable Android internal build, and a real backup/recovery rehearsal. The implementation and desktop verification gates are complete; the checks below must be performed on the owner's Android tablet before calling the release production-ready.

## Release configuration

The managed Expo app now has a stable Android application id and EAS build profiles:

| Profile | Artifact | Intended use |
|---|---|---|
| `preview` | APK | Internal installation and owner UAT |
| `production` | Android App Bundle (AAB) | Future Play/internal distribution |

The Android minimum SDK remains 26 (Android 8). The application id is `com.aross.operations`; change it before the first public distribution if the owner wants a different permanent package id. The package id must not be changed after a public release because Android treats it as the app identity.

## Automated release gate

Run these commands from the repository root before every candidate build:

```sh
npm run typecheck
npm test
npx expo export --platform android --output-dir tmp/android-export
```

The current desktop gate passes with 22 test files and 79 tests. The export verifies the Android JavaScript bundle and assets; it is not a substitute for installing an APK on a device.

## Creating the internal APK

EAS account/project setup is intentionally not stored in this repository. On the release machine, run once:

```sh
npx eas-cli login
npx eas-cli init
```

Review the application id during `eas init`, then build the UAT artifact:

```sh
npx eas-cli build --platform android --profile preview
```

Download the resulting APK and install it on the Android 8+ tablet. If Android SDK tools are configured, installation can be performed with `adb install -r <downloaded-apk>`; otherwise open the APK on the tablet and allow installation from the selected file source. Do not commit EAS tokens, keystores, or downloaded APKs to this repository.

## Owner UAT test cases

Record the app version, APK build id, device model/API level, date, and Pass/Fail for every case. Use a disposable test database or clearly prefixed records so production records are not mixed with UAT data. A failed case is a release blocker until it is fixed and retested or explicitly accepted by the owner.

### Test data fixture

Create these exact records before running the workflow cases:

- Customer: `QA Laundry 001`; address `1 Test Street`; contact `09170000001`; email `qa@example.invalid`.
- Equipment: machine type `Washer`; model `QA-MODEL`; serial `SN/QA #1`; location `QA Room`.
- Item A: `QA Detergent`; SKU `QA-DET-001`; unit `bottle`; selling price `₱1,200.00`; low-stock threshold `2`.
- Item B: `QA Cable`; SKU `QA-CAB-001`; unit `piece`; selling price `₱500.00`; low-stock threshold `1`.
- Service: `QA Labor`; rate `₱1,500.00`.
- Dates: use the app's displayed current date as `TODAY`; use the previous calendar date as `YESTERDAY`.

### Exact cases

| ID | Steps | Expected result | Result/date |
|---|---|---|---|
| UAT-01 Offline startup | Enable airplane mode. Force-stop and reopen the app. Tap Dashboard, Inventory, Customers, Services, Service Reports, Billing Statements, Payments, Reports, and Settings. | Every screen opens without a network error or crash. | |
| UAT-02 Database self-check | On Dashboard tap **Run database self-check**. | SQLite version and schema version appear; `rollback verified` is shown. | |
| UAT-03 Phone layout | Use a phone-sized device/window around 360 × 800. Open Dashboard, every list, New Customer, New Item, New CSR, New Statement, and Record Payment. Scroll each screen to the bottom. | No horizontal clipping; every field and bottom action is reachable; keyboard does not hide the active field. | |
| UAT-04 Tablet layout | Repeat UAT-03 on the owner tablet. Compare Dashboard, forms, lists, and a long document with the phone. | Content is centered and readable with no stretched controls, clipped buttons, or unusable empty side space. | |
| UAT-05 Customer duplicate bypass | Create `QA Laundry 001`. Attempt to create the same name again. Choose the warning's bypass option. Open Audit report. | First customer saves; second attempt shows a duplicate warning; bypass saves and creates an audit entry. | |
| UAT-06 Equipment lifecycle | Add the fixture equipment plus a second equipment record `QA Inactive Equipment` (model `QA-INACTIVE`, serial `SN/QA-INACTIVE`). Deactivate only the second record. Open New CSR and inspect equipment choices. Open the customer's history. | Inactive equipment cannot be selected for a new CSR; the active fixture equipment remains selectable; prior records still display the inactive record. Serial `SN/QA #1` is accepted without format rejection. | |
| UAT-07 Inventory movement | Create Item A and Item B. Restock Item A quantity `10`, description `QA opening stock`; restock Item A quantity `3`, description `QA second restock`; restock Item B quantity `2`, description `QA cable stock`. Open movement history. | Item A stock is `13`, Item B stock is `2`; all three restocks show as separate append-only entries with their descriptions. | |
| UAT-08 Consumption and insufficient stock | Consume Item A quantity `2`, description `QA test consumption`. Then attempt quantity `12`. | First action leaves stock `11`; second action is rejected before writing and stock remains `11`. | |
| UAT-09 SKU warning | Attempt a second item with SKU `QA-DET-001`; bypass the warning. Leave Item A active for the CSR cases. | Duplicate SKU bypass is audited; the original Item A remains available for later CSR and statement tests. | |
| UAT-10 CSR draft persistence | Create a CSR for `QA Laundry 001` and active equipment using `TODAY`. Confirm the banner, enter `Reported Problem = QA leak`, close the screen, force-stop, reopen the CSR. | The draft has no CSR number, the text remains, and the draft remains editable. | |
| UAT-11 CSR date rules | Start one CSR using `YESTERDAY` with an empty backdate reason, then repeat with reason `QA backdate`. Start another using a date after `TODAY`. | Empty-reason backdate and future date are rejected with clear messages; the reasoned backdate saves. | |
| UAT-12 CSR finalization/idempotency | Add Item A usage quantity `1` and Item B usage quantity `1` to the draft. Finalize, then tap the finalization action twice quickly. Open the CSR and movement history. | Exactly one next `CSR-` number is allocated; one unit of each item is deducted exactly once; the second tap returns the existing result. | |
| UAT-13 CSR PDF | From the finalized CSR choose Generate/Retry PDF and open it. | PDF is portrait Legal size; customer/equipment snapshots, number, date, sections, total, and signatures are legible. | |
| UAT-14 CSR void and follow-up | Void the UAT-12 CSR with reason `QA correction`. Mark Item A as physically returned and Item B as consumed. Create a follow-up CSR. | Void reason and both item dispositions are recorded; Item A's one-unit deduction is reversed; Item B stays deducted; follow-up links to the original. | |
| UAT-15 Statement item-only | Create a statement for `QA Laundry 001` with no CSR. Add Item B quantity `1`. Finalize with **Paid in full**. | Statement receives one next `BS-` number; stock decreases by exactly `1`; total is `₱500.00`; one payment is created. | |
| UAT-16 Statement service-only | Create a second statement for the customer. Add only `QA Labor`. Finalize with **Pay later**. | Statement finalizes with no inventory movement and an outstanding balance equal to `₱1,500.00`. | |
| UAT-17 Expenses and discount | On a new statement add a billable expense: description `QA delivery`, actual cost `₱300.00`, billed amount `₱500.00`. Add a non-chargeable expense: description `QA supplies`, actual cost `₱200.00`. Apply a fixed discount of `₱100.00`. Finalize with **Pay later**. | Only the billable expense affects the customer total; both actual costs appear in financial reporting; the discount reduces the customer total; frozen totals are visible on the statement. | |
| UAT-18 Statement price snapshot | Change Item A's price after finalizing UAT-15 through UAT-17. Reopen those documents and generate their PDFs again. | Existing item prices, totals, and PDFs remain unchanged; a new draft uses the changed Item A price. | |
| UAT-19 Down payment boundary | Create a new service `QA Payment Labor` at rate `₱1,500.00`. Create a statement containing only that service. Finalize with **Down payment** amount `₱500.00`. Try a later payment of `₱499.00`, then `₱1,001.00`, then `₱1,000.00`. | First two later-payment attempts are rejected; the exact `₱1,000.00` payment succeeds; two distinct `PA-` numbers exist and balance becomes zero. | |
| UAT-20 Pay-later boundary | Open the UAT-16 statement and note its displayed balance. Try recording one peso less than that balance, then record exactly the displayed balance. | The smaller amount is rejected; the exact displayed balance succeeds and creates a numbered Payment Acknowledgment. | |
| UAT-21 Payment correction | Open an active payment and void it with reason `QA duplicate entry`. Reopen the statement and Collections report. | Void reason is retained, the payment no longer counts toward collections/balance calculations, and its `PA-` number is not reused. | |
| UAT-22 Payment PDF | Open a finalized payment and generate/open its acknowledgment. | PDF is portrait A4, titled **Payment Acknowledgment — Not a Tax Receipt**, and shows statement number, amount, method, reference, and remaining balance. | |
| UAT-23 Signature and returned PDF | Draw an in-person signature. Share an unsigned finalized document. Import a signed PDF copy with the expected number/revision/fingerprint and confirm the match. | Signature is legible; original and returned files remain available; attaching the returned PDF does not change finalized financial or inventory data. | |
| UAT-24 Long documents | Use the existing long-content fixture or create at least 30 CSR usage/statement lines. Generate CSR, Billing Statement, and Payment Acknowledgment PDFs. | Documents paginate without clipped rows; applicable headings repeat; totals/signatures remain grouped; page sizes remain Legal/A4. | |
| UAT-25 Invalid finalization and double tap | Attempt to finalize with insufficient stock, no statement lines, and an invalid payment. Repeat each action twice. | Each failure shows a clear message and leaves numbers, payments, stock, and document state unchanged. | |
| UAT-26 Reports | Open Financial, Sales, Collections, Stock, Movement, and Audit reports. Filter by `QA Laundry 001`, `TODAY`, and the UAT document numbers. Export Sales and Collections CSV files. | Voided statements/payments are excluded from ordinary totals; non-chargeable actual cost affects net revenue reporting; movements and audit reasons match the actions; CSV sharing opens. | |
| UAT-27 Backup export/share | Export a backup after all fixture records exist. Record filename, highest revision, record counts, and checksum. Tap Share and manually place the file in the private Drive test folder. | `.arossbackup` is created; included/not-included revision status is accurate; unencrypted-data warning is visible; Android share sheet opens. | |
| UAT-28 Backup restore | Change one customer note after UAT-27. Import the UAT-27 backup. | Replace warning appears; safety export is created; the later note disappears; fixture records, sequence high-water marks, signed files, and PDF retry states recover. | |
| UAT-29 Backup rejection | Work on a copy of the backup: alter one byte, remove a JSON/attachment entry, and edit the manifest `schema_version` to `999` with a ZIP editor. Attempt each import. | Each package is rejected before replacement; current local records and revision remain unchanged. | |
| UAT-30 Low-stock setting | Restock Item B quantity `1` if needed so stock equals its threshold `1`. Confirm the low-stock state. Disable low-stock notifications. Deactivate Item B and reopen Dashboard. | Active threshold state is visible; disabling suppresses notifications without deleting thresholds; inactive Item B never alerts. | |
| UAT-31 Storage recovery | On a disposable emulator snapshot, fill storage until a PDF or backup write fails. Retry after freeing space. | Failure is explicit and retryable; already-finalized records remain committed; retry succeeds after space is available. | |
| UAT-32 Navigation/accessibility | On phone and tablet, use Android Back through a modal and detail screen, enable large system font, and navigate by touch only. | Back returns to the expected parent; no content is hidden at large text; controls remain reachable and states are not conveyed by color alone. | |
| UAT-33 Business visual sign-off | Compare CSR, Billing Statement, and Payment Acknowledgment PDFs with the approved sample formats. Verify the configured logo, address, contacts, titles, disclaimers, and VAT mode. | Owner approves spacing, typography, page size, logo/header, totals, signatures, and the non-tax-document wording. | |

## Backup and recovery rehearsal

Use a test copy of the owner's private Drive folder and record filenames/checksums rather than assuming Drive retention:

1. Export a baseline backup after creating representative customer, equipment, inventory, CSR, statement, payment, expense, and signed-PDF records. Record the filename, highest revision, and manifest checksum.
2. Make another local change and export again. Confirm the second package reports the newer revision and that the first package remains a usable point-in-time restore.
3. Import the baseline package. Confirm the replace warning and safety export, then verify records, sequence high-water marks, returned signed PDFs, and PDF regeneration/retry state.
4. Attempt a tampered package and a package with a missing signed attachment. Confirm validation fails before replacement and the restored/local data is unchanged.
5. Open a restored finalized document and verify its frozen customer, price, discount, VAT, number, and template data are unchanged by current settings.

## Completion criteria

Phase 10 is complete when the owner has signed the UAT checklist, a `preview` APK has been installed and exercised offline on Android 8+, the backup/recovery rehearsal passes, and the final business logo/header/template choices are approved. Until then, the repository is release-candidate ready but not production-approved.

Known external prerequisites are Android SDK/`adb` availability, an EAS account/project, the owner's clean logo/header confirmation, and access to the private Drive destination. These cannot be verified or completed by desktop automated tests.
