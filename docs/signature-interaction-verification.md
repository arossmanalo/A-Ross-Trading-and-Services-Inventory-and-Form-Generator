# Signature touch regression

## Change and evidence

The previous signing screen nested a scrolling WebView inside a native ScrollView, changed the parent's `scrollEnabled` during native touch events, and enabled Android nested-scroll interception in the document WebView. The reported failure starts immediately after drawing, before persistence or finalization. These conflicting scroll/responder paths have been removed: only the document scrolls, and Save/Redraw remain outside it. WebView HTML sources remain stable across ink-state changes. Both canvases explicitly release pointer capture on completion, cancellation, lost capture, interruption, redraw, and export.

- TypeScript check: passed.
- Automated tests: 126 passed, including both document types/roles, stable source and button wiring, and interrupted stroke recovery.
- Offline browser canvas smoke check: passed for customer/preparer drawing, redraw, export, interrupted capture, and repeated controls outside the canvas.
- Android bundle export: passed (1,412 modules).
- Native tablet acceptance: **not verified**. No device was connected to ADB. Mocked component tests and browser pointer tests cannot prove Android responder behavior.
- No Expo update was published; the prior GitHub-only release instruction remains in effect.

## Tablet acceptance steps

Use disposable finalized CSR and Billing Statement records, with unsigned customer/preparer slots, on the updated local app. Do not clear app data.

1. Open CSR signing and choose Customer. Draw several strokes directly on the document, lift your finger, and immediately tap **Redraw signature**. The mark must clear on the first tap.
2. Draw again, enter a signer name, and tap **Save signature draft**. It must return to the signing screen without restarting the app. The saved draft must be available for review.
3. Choose Preparer, draw several strokes, and check Redraw and Save again. Both roles must work in the same session.
4. Open the signed draft preview, tap **Finalize signature**, then **Confirm finalization**. The ordinary CSR preview must include the finalized marks. Back navigation and other record buttons must still work.
5. Repeat steps 1–4 for the Billing Statement without closing/reopening the app.
6. In another unsigned test record, start drawing and briefly switch apps. Return, finish/redraw the signature, and save. An interrupted stroke must not block another stroke or the controls.
7. Scroll/zoom the document outside the signature box, draw inside it, then immediately use a control outside the document. Scrolling and zooming must not draw marks; drawing must not scroll the document.
8. Repeat in portrait and landscape. With the keyboard closed, the document and both controls must remain visible; entering the name must not prevent saving.
