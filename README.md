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
