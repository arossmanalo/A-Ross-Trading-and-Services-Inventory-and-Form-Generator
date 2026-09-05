# A.Ross Operations

Offline-first Android inventory and form generator for A.Ross Trading and Services.

## Current development slice

- Expo SDK 57 / React Native 0.86 / strict TypeScript
- Expo Router shell
- Full v1 SQLite schema and versioned migration entry point
- Atomic inventory creation, Restock, and Consumption repositories
- Duplicate-SKU warning/bypass audit
- Inventory list, new-item form, item detail, and append-only movement history
- Restock and Consumption entry screens with insufficient-stock protection
- Registered customer list, profile creation, and duplicate-name warning/bypass audit
- Reusable equipment records with unrestricted serial numbers
- Customer, equipment, and inventory activation controls that preserve history
- Editable service catalog with owner-controlled default rates and activation controls
- Versioned customer-specific item pricing with base-price fallback
- Business identity settings and low-stock notification preference
- Autosaved, unnumbered CSR drafts with customer/equipment selection
- Billable and non-billable CSR item usage with finalization-time stock rechecks
- Atomic CSR numbering, immutable snapshots, stock posting, and price-change resolution
- Legal-size CSR HTML/PDF renderer with persistent files, retry, and manual sharing
- Linked follow-up CSRs and void/reissue with per-item physical disposition
- Unnumbered Billing Statement drafts linked to an optional finalized CSR
- Direct item, catalog service, CSR item, billable-expense, and non-chargeable expense entry
- Fixed/percentage discounts with frozen VAT, pricing, and content snapshots
- Atomic statement numbering and direct-sale stock posting without double-deducting CSR usage
- A4 Billing Statement PDF generation, retry, manual sharing, and unpaid void disposition
- Paid-in-full, down-payment/balance, and pay-later workflows with installment protection
- Atomic `PA-` numbering, immutable payment history, and void-payment corrections
- A4 Payment Acknowledgment PDFs with retry, sharing, references, and remaining balances
- Manual remote-signing status and append-only returned signed-PDF import for CSRs and Billing Statements
- Deterministic signed filenames, checksums, persistent private storage, and attachment sharing
- Offline customer/preparer signature canvas with append-only, retry-safe signed PDF versions
- Saved preparer signature and PNG/JPEG business logo settings, frozen into newly issued CSR/BS/PA PDFs
- Signature schema v5 migration, manual returned-PDF matching, PDF-header/size checks, and missing-file recovery messages
- Financial reports with date/customer filters, independent sales/collection totals, current balances, expenses, and CSV sharing
- Current stock report with item/SKU search, active/inactive/low-stock filters, and CSV sharing
- `.arossbackup` export to the Android share sheet with revision coverage and unencrypted-data warning
- Validated replace-only backup restore with safety export, atomic rollback, signed-PDF recovery, and schema 1–4 migration
- On-device SQLite rollback diagnostic
- Money, document-template, stock, customer-rule, and SQLite integrity tests

## Commands

```sh
npm install
npm start
npm run typecheck
npm test
```

Open the app in Expo Go first. On the dashboard, run **Database self-check** to verify migration and exclusive-transaction rollback on the device.

See `plan.md` and `srs.md` for the approved behavior and delivery phases.

Phase 6 implementation and verification details are in `docs/phase-6-verification.md`. Phase 9 verification is tracked in `docs/phase-9-verification.md`. Phase 10's owner UAT, internal APK build, and backup/recovery runbook is in `docs/phase-10-release.md`; production acceptance still requires Android device testing and owner review of the final business logo/header and printed templates.
