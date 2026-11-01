# PDF sharing, naming and orientation - tablet checks

Automated tests cover file names, the share order, skipping, self-healing PDFs, portrait page sizes and the print viewport. They cannot prove Android behaviour, so run these on the owner's tablet.

## What changed

- Every PDF is rendered at a fixed portrait page size with the HTML viewport pinned to the page width (816 px Legal, 794 px A4) instead of `device-width`.
- Shared files are copied to temporary storage and named `[CSR ID] [Document Type].pdf`.
- Sharing a finalized CSR offers each finalized linked Billing Statement afterwards, one share sheet per file.
- The Android print dialog is labelled "Print" and is not the way to send a PDF.

## Checks

Use disposable records. Repeat each with the tablet held in portrait and again in landscape.

1. Finalize a CSR with a service and a linked Billing Statement. Open the CSR and tap **Share PDF**. Pick an app. When the prompt appears, choose **Share**.
   Expected: two files arrive, named `CSR-0000NN Customer Service Report.pdf` and `CSR-0000NN Billing Statement.pdf`.
2. Open each received PDF.
   Expected: portrait pages, the CSR on Legal and the statement on A4, with the same layout in both tablet orientations.
3. Check a short and a long document (30 or more lines). Text size and margins must match between orientations.
4. From the CSR preview, tap **Save / share PDF**. Expected: the same two names and portrait pages.
5. Share a standalone Billing Statement (no CSR): `BS-0000NN Billing Statement.pdf`. Share a Payment Acknowledgment: `PA-0000NN Payment Acknowledgment.pdf`, or `CSR-0000NN Payment Acknowledgment PA-0000NN.pdf` when the statement belongs to a CSR.
6. Confirm file names containing spaces open normally in the receiving app (email, Drive, messaging).
7. Tap **Skip** on the prompt: only the CSR is sent. Dismiss the first share sheet without sending: the prompt for the statement still appears and can be skipped.
8. Use **Print (opens print dialog)** in landscape. The print dialog may offer landscape; this button is for printing only and is not used for sending.

If a received PDF is still landscape, note which button was used, whether the page itself was sideways or the content was only small, and the tablet model.
