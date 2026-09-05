import type { SQLiteDatabase } from 'expo-sqlite';

export type SearchResultKind =
  | 'billing_statement'
  | 'customer'
  | 'equipment'
  | 'item'
  | 'payment'
  | 'service'
  | 'service_report';

export type GlobalSearchResult = {
  kind: SearchResultKind;
  id: string;
  routeId: string;
  title: string;
  subtitle: string;
  detail: string;
  sortDate: string;
};

type GlobalSearchRow = {
  kind: SearchResultKind;
  id: string;
  route_id: string;
  title: string;
  subtitle: string;
  detail: string;
  sort_date: string;
};

export async function searchAppRecords(db: SQLiteDatabase, query: string, limit = 60): Promise<GlobalSearchResult[]> {
  const text = query.trim();
  if (!text) return [];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('Search limit must be between 1 and 200.');
  const like = `%${escapeLike(text)}%`;
  const rows = await db.getAllAsync<GlobalSearchRow>(
    `SELECT * FROM (
       SELECT 'customer' AS kind,c.id,c.id AS route_id,c.name AS title,
         trim(c.address || ' ' || c.contact_number || ' ' || c.email) AS subtitle,
         CASE WHEN c.active=1 THEN 'Active customer' ELSE 'Inactive customer' END AS detail,
         c.updated_at AS sort_date
       FROM customers c
       WHERE c.name LIKE ? ESCAPE '\\' OR c.address LIKE ? ESCAPE '\\' OR c.contact_number LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\'

       UNION ALL
       SELECT 'equipment',e.id,e.customer_id,e.machine_type,
         c.name || CASE WHEN e.nickname_or_location<>'' THEN ' - ' || e.nickname_or_location ELSE '' END,
         trim('Model ' || e.model || ' Serial ' || e.serial_number),
         e.updated_at
       FROM customer_equipment e JOIN customers c ON c.id=e.customer_id
       WHERE e.machine_type LIKE ? ESCAPE '\\' OR e.model LIKE ? ESCAPE '\\' OR e.serial_number LIKE ? ESCAPE '\\'
         OR e.nickname_or_location LIKE ? ESCAPE '\\' OR e.notes LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\'

       UNION ALL
       SELECT 'item',i.id,i.id,i.name,
         trim(COALESCE(i.sku,'') || ' ' || i.unit_label),
         CASE WHEN i.active=1 THEN 'Active item' ELSE 'Inactive item' END,
         i.updated_at
       FROM items i
       WHERE i.name LIKE ? ESCAPE '\\' OR COALESCE(i.sku,'') LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR i.unit_label LIKE ? ESCAPE '\\'

       UNION ALL
       SELECT 'service',s.id,s.id,s.name,
         s.description,
         CASE WHEN s.active=1 THEN 'Active service' ELSE 'Inactive service' END,
         s.updated_at
       FROM services s
       WHERE s.name LIKE ? ESCAPE '\\' OR s.description LIKE ? ESCAPE '\\'

       UNION ALL
       SELECT 'service_report',r.id,r.id,COALESCE(r.csr_number,'Draft CSR'),
         c.name || ' - ' || e.machine_type,
         r.document_state || ' - ' || r.business_date,
         COALESCE(r.finalized_at,r.created_at)
       FROM service_reports r
       JOIN customers c ON c.id=r.customer_id
       JOIN customer_equipment e ON e.id=r.equipment_id
       WHERE COALESCE(r.csr_number,'') LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR e.machine_type LIKE ? ESCAPE '\\'
         OR e.model LIKE ? ESCAPE '\\' OR e.serial_number LIKE ? ESCAPE '\\' OR r.business_date LIKE ? ESCAPE '\\'

       UNION ALL
       SELECT 'billing_statement',b.id,b.id,COALESCE(b.bs_number,'Draft Billing Statement'),
         c.name,
         b.document_state || ' - ' || b.business_date,
         COALESCE(b.finalized_at,b.created_at)
       FROM billing_statements b JOIN customers c ON c.id=b.customer_id
       WHERE COALESCE(b.bs_number,'') LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\' OR b.business_date LIKE ? ESCAPE '\\'

       UNION ALL
       SELECT 'payment',p.id,p.id,COALESCE(p.pa_number,'Payment'),
         c.name || ' - ' || COALESCE(b.bs_number,'Billing Statement'),
         p.state || ' - ' || p.business_date,
         p.created_at
       FROM payments p
       JOIN billing_statements b ON b.id=p.billing_statement_id
       JOIN customers c ON c.id=b.customer_id
       WHERE COALESCE(p.pa_number,'') LIKE ? ESCAPE '\\' OR COALESCE(b.bs_number,'') LIKE ? ESCAPE '\\'
         OR c.name LIKE ? ESCAPE '\\' OR p.business_date LIKE ? ESCAPE '\\' OR COALESCE(p.reference_number,'') LIKE ? ESCAPE '\\'
     ) matches
     ORDER BY sort_date DESC, kind ASC, title COLLATE NOCASE ASC
     LIMIT ?`,
    ...Array(30).fill(like),
    limit,
  );
  return rows.map(row => ({
    kind: row.kind,
    id: row.id,
    routeId: row.route_id,
    title: row.title,
    subtitle: row.subtitle,
    detail: row.detail,
    sortDate: row.sort_date,
  }));
}

export function searchResultKindLabel(kind: SearchResultKind): string {
  return kind.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}
