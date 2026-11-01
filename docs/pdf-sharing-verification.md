# PDF sharing, naming and orientation - tablet checks

Automated tests cover file names, the share order, skipping, self-healing PDFs, portrait page sizes and the print viewport. They cannot prove Android behaviour, so run these on the owner's tablet.

## What changed

- Every PDF is rendered at a fixed portrait page size with the HTML viewport pinned to the page width (816 px Legal, 794 px A4) instead of `device-width`.
- Shared files are written to temporary storage and named `[Customer Name] [Code] [Date].pdf`.
- A CSR and its linked finalized Billing Statement are merged into ONE PDF (CSR page first, then the statement), whichever one you share. A statement with no CSR is sent alone.
- The Android print dialog is labelled "Print" and is not the way to send a PDF.

## Checks

Use disposable records. Repeat each with the tablet held in portrait and again in landscape.

1. Finalize a CSR with a service and a linked Billing Statement. Open the CSR and tap **Share PDF**. Pick an app.
   Expected: a single share sheet and ONE file named like `Laundry CSR-0000NN 2026-09-05.pdf`.
2. Open the received PDF.
   Expected: two portrait pages: the CSR first (Legal), the statement second (A4), with the same layout in both tablet orientations.
3. Open the statement and tap **Share Billing Statement PDF**. Expected: the same single PDF, same name, same page order.
4. Share a statement that has no CSR. Expected: one A4 page named `Customer BS-0000NN date.pdf`.
5. From the CSR preview and the statement preview, tap **Save / share PDF**. Expected: the same combined PDF (signed copies where signed).
6. Share a Payment Acknowledgment: `Customer PA-0000NN date.pdf`.
7. Confirm names containing spaces open normally in the receiving app (email, Drive, messaging).
8. Check a short and a long document (30 or more lines): text size and margins match between orientations.
9. Use **Print (opens print dialog)** in landscape. This button is for printing only and is not used for sending.

If a received PDF is still landscape, note which button was used, whether the page itself was sideways or the content was only small, and the tablet model.
