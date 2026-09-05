# Project instructions

- Read `plan.md` and `srs.md` before changing product behavior.
- This project targets Expo SDK 57, React Native 0.86, TypeScript strict mode, Android 8+, and offline-first operation.
- Use the exact SDK 57 Expo documentation for Expo APIs.
- Keep database writes behind repositories and use `withExclusiveTransactionAsync` for stock, numbering, payment, finalization, and restore operations.
- Store money as integer centavos and inventory quantities as integers.
- Finalized business records are append-only; corrections use explicit void/reversal records.
- Use kebab-case filenames and the `@/` alias for imports.
- Run `npm run typecheck` and `npm test` after meaningful code changes.
