# Phase 6 — Signatures and PDF templates

## Implemented

- Bundled, network-free WebView canvas for customer and preparer signatures, including clear, blank rejection, print-resolution PNG export, and duplicate-save protection.
- Settings can save/replace/clear the default preparer signature and select/clear a PNG/JPEG logo (2 MB maximum). New CSR, Billing Statement, and Payment Acknowledgment snapshots contain their rendered assets. Settings changes never rewrite issued documents.
- Schema v5 retains immutable signature captures, signer names, capture timestamps, signed render snapshots, and PDF recovery state. The default-signature pointer can change; its historical capture cannot.
- Customer signing is available after finalization. The app shows the numbered document/customer/fingerprint before capture. Each signing version appends an acknowledgment page to the frozen original HTML; it never unlocks the business record or overwrites the original generated PDF.
- A subsequent version includes the most recent signature from the other role. Earlier signing versions remain accessible. Capturing a preparer signature alone does not mark the customer as signed.
- Rendering/sharing is separate from capture. A failure leaves the saved signature available for retry; a missing derived PDF can be regenerated without drawing again.
- Remote imports require explicit manual matching of document number, revision, and fingerprint. Imports check file size (25 MB maximum) and PDF header, allocate a unique deterministic UUID-based filename, and retain every returned copy. These checks do not validate PDF contents or cryptographically verify signatures.
- New template versions identify revision 1, retain Legal CSR/A4 BS/PA sizing, support overflow, protect table rows where practical, and preserve minimum CSR content slots. Old frozen templates remain reproducible.

## Verification completed on desktop

- Strict TypeScript check and automated SQLite/repository/template suite.
- Capture idempotency, immutable records, audit/revision rollback, voided-document rejection, snapshot preservation, separate returned files, malformed imports, and render-failure/missing-file recovery.
- Offline Chromium canvas smoke test: no network requests, blank rejection, drawing, PNG export, resize stability, and clear.
- Android Metro/Hermes bundle export. This is a JavaScript bundle check, not an APK or physical-device test.
- Poppler page-size inspection and visual inspection of long CSR/BS fixtures and the PA fixture with clearly labeled artificial test marks. Legal CSR and A4 billing span pages; the normal payment fixture fits on one A4 page with a preparer signature.

## Repeat desktop visual checks

Run `npm run typecheck` and `npm test`. The smoke/print scripts require Playwright with Microsoft Edge installed. If using a bundled runtime, set `AROSS_RUNTIME_PACKAGE_JSON` to that runtime's Playwright `package.json`; otherwise install/use Playwright locally for these optional development checks.

1. `node scripts/check-signature-canvas.mjs`
2. `node --experimental-strip-types scripts/render-csr-fixture.ts`
3. `node --experimental-strip-types scripts/render-billing-fixture.ts`
4. `node --experimental-strip-types scripts/render-payment-fixture.ts`
5. `node --experimental-strip-types scripts/render-signature-fixtures.ts`
6. `node scripts/print-signature-fixtures.mjs`
7. Render `tmp/pdfs/*-signed.pdf` using Poppler and inspect every page. Fixtures are temporary, not real signed business documents.

## Required before production acceptance

- Test on target Android hardware: airplane mode, finger/stylus input, rotation, process interruption, large text, picker cancellation, local storage exhaustion, and actual print/share destinations.
- Confirm the clean original business logo and active header in Settings; obtain owner approval of physical Legal/A4 printouts.
- Old v1 templates predate the explicit revision label. Their historical render snapshots are intentionally unchanged; use their number/fingerprint for manual matching.
- Phase 8 backup export/restore must include `signature_captures` (including inline PNG data), the settings logo, and all external signed-PDF files. Capture deletion guards must be handled only inside the validated replace-restore operation.

No real signature from the supplied sample is used as a default or test asset. The app does not certify externally signed PDFs.
