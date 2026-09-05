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

The current desktop gate passes with 21 test files and 76 tests. The export verifies the Android JavaScript bundle and assets; it is not a substitute for installing an APK on a device.

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

## Owner UAT checklist

Record the app version, APK build id, device model/API level, date, and result for every row. A failed row is a release blocker until it is either fixed and retested or explicitly accepted by the owner.

| # | Scenario | Expected result | Result/date |
|---:|---|---|---|
| 1 | Start with airplane mode enabled | Dashboard opens and all core local screens work without network | |
| 2 | Register customer and equipment | Required customer/equipment records save; duplicate warnings can be bypassed with an audit entry | |
| 3 | Restock, consume, and review stock | Integer quantities and append-only movement history remain correct | |
| 4 | Create/edit a CSR draft | Draft is autosaved, visibly unnumbered, and can be reopened after relaunch | |
| 5 | Finalize CSR and render PDF | Number increments once, stock posts atomically, Legal CSR PDF is legible and retryable | |
| 6 | Create/finalize Billing Statement | Item-only and service-only statements work; discount/VAT/payment choice snapshots remain stable | |
| 7 | Record payments and corrections | Full, down-payment/balance, and pay-later rules hold; payment acknowledgments are numbered; void rules hold | |
| 8 | Exercise invalid/conflicting actions | Insufficient stock, duplicate, invalid payment, and double-tap attempts leave no partial writes | |
| 9 | Generate long documents | CSR, Billing Statement, and Payment Acknowledgment overflow cleanly with headings, signatures, totals, and traceability | |
| 10 | Manual remote-signing flow | Unsigned PDF can be shared; returned signed PDF can be imported, matched, and retained without changing finalized content | |
| 11 | Export and manually place backup | `.arossbackup` export shows revision coverage and unencrypted-data warning; share sheet opens; owner places it in private Drive | |
| 12 | Restore a known-good backup | Replacement warning appears, safety export is created, attachments recover, and generated PDFs remain retryable | |
| 13 | Reject bad backups | Tampered, incomplete, newer-schema, and missing-attachment packages fail clearly and leave local data unchanged | |
| 14 | Storage pressure | Failed PDF/backup writes expose retryable errors while committed business records remain intact | |
| 15 | Low-stock setting | Inactive items never notify; disabling notifications suppresses notices without removing thresholds/dashboard data | |
| 16 | Accessibility and navigation | Back navigation, keyboard behavior, scrolling, touch targets, readable scaling, and non-color-only states work on the tablet | |
| 17 | Business visual acceptance | Owner approves the active logo, address/contact header, CSR, Billing Statement, and Payment Acknowledgment layout | |

For responsive acceptance, repeat the navigation, forms, lists, dashboards, and long-document screens on one phone-sized window and the owner tablet. Phone content should use the available width without horizontal clipping; tablet content should remain centered, readable, and fully scrollable without stretched form fields or clipped buttons. Rotate only if the device/build is configured to allow it; the current product orientation is portrait.

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
