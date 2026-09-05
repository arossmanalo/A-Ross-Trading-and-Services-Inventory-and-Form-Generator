import type { SQLiteDatabase } from 'expo-sqlite';

export type AuditEntityFilter =
  | 'all'
  | 'billing_statement'
  | 'customer'
  | 'customer_equipment'
  | 'customer_item_price'
  | 'item'
  | 'payment'
  | 'service'
  | 'service_report'
  | 'settings';

export type AuditReportFilter = { from: string; to: string; entityType?: AuditEntityFilter };
export type AuditReportRow = {
  id: string;
  eventType: string;
  entityType: Exclude<AuditEntityFilter, 'all'> | string;
  entityId: string;
  details: Record<string, unknown>;
  detailsText: string;
  createdAt: string;
};

type AuditReportSqlRow = {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  details_json: string;
  created_at: string;
};

const ENTITY_TYPES: AuditEntityFilter[] = [
  'all',
  'billing_statement',
  'customer',
  'customer_equipment',
  'customer_item_price',
  'item',
  'payment',
  'service',
  'service_report',
  'settings',
];

export function validateAuditReportFilter(filter: AuditReportFilter): void {
  for (const date of [filter.from, filter.to]) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error('Enter valid dates using YYYY-MM-DD.');
    }
  }
  if (filter.from > filter.to) throw new Error('Start date must be on or before end date.');
  const entityType = filter.entityType ?? 'all';
  if (!ENTITY_TYPES.includes(entityType)) throw new Error('Choose a valid audit entity type.');
}

export async function getAuditReport(db: SQLiteDatabase, filter: AuditReportFilter): Promise<AuditReportRow[]> {
  validateAuditReportFilter(filter);
  const entityType = filter.entityType ?? 'all';
  const rows = await db.getAllAsync<AuditReportSqlRow>(
    `SELECT id,event_type,entity_type,entity_id,details_json,created_at
     FROM audit_events
     WHERE substr(created_at, 1, 10) BETWEEN ? AND ?
       AND (? = 'all' OR entity_type = ?)
     ORDER BY created_at DESC, rowid DESC`,
    filter.from,
    filter.to,
    entityType,
    entityType,
  );
  return rows.map(row => {
    const details = parseDetails(row.details_json);
    return {
      id: row.id,
      eventType: row.event_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details,
      detailsText: detailsToText(details),
      createdAt: row.created_at,
    };
  });
}

export function filterAuditReport(rows: AuditReportRow[], query: string): AuditReportRow[] {
  const text = query.trim().toLowerCase();
  if (!text) return rows;
  return rows.filter(row => [
    row.eventType,
    row.entityType,
    row.entityId,
    row.detailsText,
    row.createdAt,
  ].some(value => value.toLowerCase().includes(text)));
}

export function auditReportCsv(rows: AuditReportRow[]): string {
  return csv([
    ['Date/time','Event','Entity type','Entity ID','Details'],
    ...rows.map(row => [row.createdAt, row.eventType, auditEntityLabel(row.entityType), row.entityId, row.detailsText]),
  ]);
}

export function auditEntityLabel(entityType: AuditEntityFilter | string): string {
  if (entityType === 'all') return 'All';
  return entityType.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export const AUDIT_ENTITY_FILTERS = ENTITY_TYPES;

function parseDetails(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return { unreadableDetails: raw };
  }
}

function detailsToText(details: Record<string, unknown>): string {
  const entries = Object.entries(details);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join('; ');
}

function csv(rows: Array<Array<string | number>>): string {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let cell = String(value);
    if (typeof value === 'string' && /^[=+@\-\t\r\n]/.test(cell)) cell = "'" + cell;
    return '"' + cell.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}
