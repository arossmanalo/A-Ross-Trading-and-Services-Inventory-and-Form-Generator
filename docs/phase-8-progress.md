# Phase 8 progress

## Available

- Backup screen with current revision, latest export coverage, finalized-record count, seven-day notice state, and the required unencrypted customer/signature data warning.
- Dashboard backup card and shortcut.
- `.arossbackup` export foundation using an offline stored-ZIP package.
- Export package includes `manifest.json`, `data/tables.json`, record counts, schema version, high-water revision, checksums, and external signed PDF assets.
- Export opens the Android share sheet for manual upload to private Google Drive. It records local export completion only and does not claim Drive received the file.
- Missing or checksum-changed external signed PDF attachments block export before backup history is recorded.
- ZIP reader rejects encrypted/compressed/tampered/duplicate/unsafe entries.
- Restore screen lets the owner select an `.arossbackup`, validate it, confirm replacement, and restore through an exclusive transaction.
- Restore validates the schema, record counts, columns, manifest checksum, and every external signed PDF checksum before writing.
- Existing local records trigger a safety export first; restored signed PDFs are placed in the private signed-files directory and generated PDFs are marked for regeneration.
- Replacement failure injection confirms foreign-key failures roll back the database and clean up newly written signed files.

## Remaining

- Schema 1–4 packages are upgraded in memory before restore; unsupported newer schemas are rejected.
- Device validation of `.arossbackup` sharing and private Drive manual upload flow.
- Large-package and on-device restore rehearsal.
