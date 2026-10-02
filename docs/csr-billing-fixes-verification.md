# CSR and Billing Statement fixes - October 2026

## Changes

- One shared header renderer for new CSR and Billing Statement documents. Settings provide the logo, business name, address and contact lines; email comes last. Existing finalized templates stay frozen.
- Billing Statement signing actions are next to signature status. Draw/redraw on the actual document, review, then **Finalize signature**. Its ordinary document preview includes finalized in-person signatures, but not unfinalized signature drafts.
- Item/service additions to a Billing Statement linked to a CSR draft now create CSR usage and source-linked billing charges together in one exclusive transaction. The CSR total is recomputed; no stock posts while drafting.
- Duplicate item/service entries already on that CSR are rejected instead of being treated as another sale. Non-billable CSR items remain on the CSR but are excluded from the statement.
- Statements started after CSR finalization also import its eligible item/service sources. Removed finalized CSR service sources can be reattached using their frozen rates rather than repriced as a separate service.
- Finalized CSR detail now displays its item and service lists. Item descriptions use the captured usage description rather than a later inventory rename.
- Existing linked drafts with billing-only item/service lines stop before CSR finalization and explain how to review them. Legacy duplicate direct charges and mismatched source quantity/price/stock also stop Billing Statement finalization before any number or new stock movement.

## Automated verification

`npm run typecheck` and `npm test` cover both entry paths, correct CSR snapshots/totals, signature draft versus finalized preview, transaction rollback, duplicate rejection, price overrides, non-billable usage, separate additional sales, low stock, and repeat finalization with exactly one CSR deduction.

`node scripts/check-document-print.mjs` uses Playwright/Edge for shared-header/contact assertions and four signed print fixtures. Set `AROSS_RUNTIME_PACKAGE_JSON` to bundled Playwright's package.json when using the Codex runtime. Render the resulting temporary PDFs with Poppler and inspect every page. This checks desktop Chromium printing, not Android Expo Print.

SDK references: [Expo SQLite SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) and [Expo Print SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/print/).

Verified on October 3, 2026: TypeScript check passed; all 106 tests across 23 files passed; Android production bundle export succeeded (1,412 modules). Desktop print QA passed, and all seven pages across the four short/long signed PDF fixtures were visually inspected. Short CSR and Billing Statement fixtures each fit one page with inline signatures; longer fixtures paginate without clipped header/charge/signature content. Actual Android signing/printing and affected historical records have not been tested on the owner's tablet.

## Specific Android acceptance test

Use a test customer/equipment and test catalog records; do not experiment on live stock.

1. Set two phone numbers and an email in Settings. Create an item **QA Part** priced at **PHP 100**, opening stock **10**, and services **QA Labor** at **PHP 500** and **QA Inspection** at **PHP 200**.
2. Make a CSR draft for the test equipment. Add **QA Part**, quantity **2**, billable, through the CSR. Create/open its linked Billing Statement. It must show the part as a CSR source line for **PHP 200**, and stock must still be **10**.
3. In the statement choose **Add charge > Service**, then add **QA Labor**. Return to the CSR: Labor must appear and the total must be **PHP 700**. Add **QA Inspection** on the CSR, reopen the statement, and verify all three charges and **PHP 900**.
4. Try adding QA Part and QA Labor again from the statement. Each attempt must be rejected as already recorded on the CSR; totals and stock must not change.
5. Preview both drafts. Verify the matching logo/business header, phones on separate lines, email last, item/service content, and **PHP 900**. Neither draft gets a number or deducts stock.
6. Finalize the CSR. Open its detail and PDF: Part quantity 2, Labor, Inspection, and **PHP 900** must remain visible. Inventory must be **8**.
7. Finalize the linked statement with **Pay Later**. It must retain the same three charges and total; stock must remain **8**, not 6. Reopen and retry PDF generation: stock and document numbers must remain unchanged.
8. Open **Sign Billing Statement**, draw the customer signature on the document and save the signature draft. Redraw it once. Before **Finalize signature**, normal document preview must not show that draft signature. Review and finalize it, return to the statement, then open its ordinary preview: the finalized signature must appear inside the document. Repeat for preparer and verify both marks are visible.
9. On an existing affected linked draft, follow the review message: remove any separate duplicate charge; if a charge is not yet on the CSR, re-add it through the shared flow. Recheck quantities/totals before finalizing.

## Historical records

No existing finalized record or inventory ledger is rewritten automatically. An already-issued empty CSR or duplicate stock movement requires review of that device's actual records and an explicit void/reversal correction, with any active payments handled first. Header changes apply to newly rendered drafts and newly finalized documents, not previously frozen originals.

Android touch/printing/signing acceptance and any historical-data corrections are still owner/device verification tasks. This change does not publish an Expo update by itself.
