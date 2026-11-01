/**
 * SQL condition meaning "this per-machine service row is already billed": a
 * statement line references it directly, or references the v10 per-service
 * usage it was backfilled from. Lines on voided statements still count.
 */
export function machineServiceBilled(alias: string): string {
  return `(EXISTS (SELECT 1 FROM billing_statement_lines bl_new WHERE bl_new.source_csr_machine_service_id = ${alias}.id)
    OR (${alias}.legacy_service_usage_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM billing_statement_lines bl_old WHERE bl_old.source_csr_service_usage_id = ${alias}.legacy_service_usage_id)))`;
}
