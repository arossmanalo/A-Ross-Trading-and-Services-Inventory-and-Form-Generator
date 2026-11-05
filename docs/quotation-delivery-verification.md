# Quotation and Delivery documents: behaviour and tablet checklist

## What was added
- **Quotation** (`QT-000001`): the Billing Statement's form with a *valid until* date. No stock or payment effect. Prices are quoted as entered (no price-drift check).
- **Delivery form** (`DF-000001`): inventory items only. **Finalizing deducts stock** (rejected if any item is short). The printed form shows items and quantities, not prices; prices stay in the data so the Billing Statement can bill them.
- **Billing Statement linked to a delivery**: one live statement per delivery. Delivered items are billed as delivered and are **not deducted from stock again**. A statement links to a CSR *or* a delivery, never both.
- **Quotation conversion**: a finalized quotation asks *repair or delivery*. Repair creates a CSR draft (machines chosen) plus its Billing Statement draft; Delivery creates a Delivery draft plus its Billing Statement draft (quoted services go on the statement). The quotation's discount is carried to the statement. A quotation converts once and cannot be voided afterwards.
- Database schema 12. Older backups restore into it; the two new sequences start at 1.

## Decisions worth knowing
- Voiding a Billing Statement that bills a delivery frees the delivery's lines so a new statement can bill them; the delivery's stock is untouched.
- A delivery cannot be voided while a live statement bills it; void the statement first.
- Repair conversion prices every quoted service on the first machine chosen; the same item quoted twice at different prices is refused.
- Shared PDFs: a delivery is followed by its finalized statement, and a statement is preceded by its delivery (same as CSR and statement). The on-screen preview shows the same pages.

## Check on the tablet (after updating)
1. Export a backup first (Settings → Backup). The update migrates the database to schema 12 on its first start.
2. Open the app: the home screen has Quotations (08) and Delivery forms (09); existing CSRs, statements and payments are unchanged.
3. Quotation: create, add an item and a service, set a discount, finalize, preview, share, sign. Check the "Hide totals" button and the list filters.
4. Convert it to a repair (pick a machine) and check the CSR draft and statement draft. Convert another to a delivery and check both drafts.
5. Delivery: add items beyond stock and confirm finalizing is refused; reduce the quantity, finalize, and confirm stock dropped by exactly that quantity (Inventory).
6. Create the Billing Statement from the delivery, finalize it, and confirm stock did **not** drop again. Share it and confirm the delivery is the first page.
7. Void the statement, then the delivery, choosing which items came back; confirm stock matches.
8. Create a backup and restore it; the new documents come back.
