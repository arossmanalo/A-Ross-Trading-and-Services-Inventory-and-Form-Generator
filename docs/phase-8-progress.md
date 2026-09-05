# Phase 8 progress

## Available

- Backup screen with current revision, latest export coverage, finalized-record count, seven-day notice state, and the required unencrypted customer/signature data warning.
- Dashboard backup card and shortcut.
- `.arossbackup` export foundation using an offline stored-ZIP package.
- Export package includes `manifest.json`, `data/tables.json`, record counts, schema version, high-water revision, checksums, and external signed PDF assets.
- Export opens the Android share sheet for manual upload to private Google Drive. It records local export completion only and does not claim Drive received the file.
- Missing or checksum-changed external signed PDF attachments block export before backup history is recorded.

## Remaining

- Replace-only restore/import UI.
- Backup package validation before restore.
- Safety export before replacing local data.
- Atomic restore of structured data, signed assets, and sequence high-water marks.
- Supported older-backup migrations and unsupported-newer-backup rejection.
- Device validation of `.arossbackup` sharing and private Drive manual upload flow.
