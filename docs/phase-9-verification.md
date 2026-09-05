# Phase 9 verification

Phase 9 hardens the offline app before owner UAT. Automated checks run on every development slice; the device checklist must be completed on the actual Android target before release.

## Automated coverage

- Fresh, repeat, legacy, and unsupported-newer database migrations (`src/db/migrations.test.ts`).
- Exclusive-transaction rollback for invalid restore rows (`src/features/backup/backup-repository.test.ts`).
- ZIP truncation, checksum, duplicate-entry, unsafe-path, encryption/compression rejection (`src/features/backup/zip.test.ts`).
- Backup manifest, record-count, column, signed-asset checksum, schema migration, safety-export, and restore tests.
- Long CSR and Billing Statement fixtures covering 120 and 180 charge/usage rows, repeated table headings, and unsplit rows.
- Full TypeScript check, Vitest suite, and Android bundle export.

Run the automated gate from the repository root:

```sh
npm run typecheck
npm test
npx expo export --platform android --output-dir tmp/android-export
```

## Android device checklist

Complete this on Android 8+ with the app's release/development build and record the result/date in the release notes:

1. Cold start with airplane mode enabled; open the dashboard, create a customer, restock an item, create a CSR draft, finalize it, and reopen the generated PDF.
2. Kill and relaunch while offline; confirm all records remain available and no screen requires network access.
3. Trigger insufficient stock, duplicate SKU/customer, invalid payment, and finalization conflicts; confirm no partial number, payment, or stock writes.
4. Generate long CSR/Billing Statement/Payment Acknowledgment documents; verify page overflow, repeated headings, signatures, totals, and traceability fields.
5. Export a backup, confirm the Android share sheet opens, and manually place the file in the private Drive location.
6. Pick that backup back from storage; confirm the replacement warning, safety export, signed-file recovery, and post-restore PDF retry state.
7. Attempt a missing/tampered backup and a missing signed attachment; confirm a clear error and unchanged local data.
8. Fill device storage until export/PDF writes fail; confirm the business record remains committed and the UI exposes a retryable error.
9. Toggle low-stock notifications and deactivate an item; confirm inactive items never generate low-stock notices.
10. Verify Android back navigation, keyboard overlap, scrolling, and touch targets on the owner tablet.

Device validation is intentionally manual because emulator storage, share providers, PDF viewers, and private Drive availability vary by device image.
