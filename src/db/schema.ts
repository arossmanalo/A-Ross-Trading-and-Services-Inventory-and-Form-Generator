export const DATABASE_NAME = 'a-ross-operations.db';
export const DATABASE_VERSION = 12;

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY NOT NULL CHECK (name IN ('CSR', 'BS', 'PA')),
  high_water_mark INTEGER NOT NULL DEFAULT 0 CHECK (high_water_mark >= 0)
);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY NOT NULL,
  business_name TEXT NOT NULL,
  business_address TEXT NOT NULL DEFAULT '',
  contact_details TEXT NOT NULL DEFAULT '',
  business_logo_path TEXT,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_signature_asset_id TEXT,
  vat_display_mode TEXT NOT NULL DEFAULT 'disabled'
    CHECK (vat_display_mode IN ('disabled', 'inclusive', 'exclusive')),
  vat_rate_basis_points INTEGER NOT NULL DEFAULT 0
    CHECK (vat_rate_basis_points BETWEEN 0 AND 10000),
  low_stock_notifications_enabled INTEGER NOT NULL DEFAULT 1
    CHECK (low_stock_notifications_enabled IN (0, 1)),
  app_lock_enabled INTEGER NOT NULL DEFAULT 0 CHECK (app_lock_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  address TEXT NOT NULL DEFAULT '',
  contact_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  merged_into_customer_id TEXT REFERENCES customers(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_equipment (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  machine_type TEXT NOT NULL CHECK (length(trim(machine_type)) > 0),
  model TEXT NOT NULL DEFAULT '',
  serial_number TEXT NOT NULL DEFAULT '',
  nickname_or_location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  sku TEXT,
  description TEXT NOT NULL DEFAULT '',
  unit_label TEXT NOT NULL DEFAULT 'pc',
  base_selling_price_centavos INTEGER NOT NULL DEFAULT 0
    CHECK (base_selling_price_centavos >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_item_prices (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  selling_price_centavos INTEGER NOT NULL CHECK (selling_price_centavos >= 0),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_item_prices_one_active
  ON customer_item_prices(customer_id, item_id)
  WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  base_rate_centavos INTEGER NOT NULL DEFAULT 0 CHECK (base_rate_centavos >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_reports (
  id TEXT PRIMARY KEY NOT NULL,
  csr_number TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  equipment_id TEXT NOT NULL REFERENCES customer_equipment(id),
  follows_csr_id TEXT REFERENCES service_reports(id),
  document_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (document_state IN ('draft', 'finalized', 'voided')),
  service_outcome TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (service_outcome IN ('completed', 'incomplete', 'waiting_for_parts', 'under_observation')),
  business_date TEXT NOT NULL,
  backdate_reason TEXT,
  reported_problem_json TEXT NOT NULL DEFAULT '[]',
  diagnosis_json TEXT NOT NULL DEFAULT '[]',
  action_taken_json TEXT NOT NULL DEFAULT '[]',
  recommendations_json TEXT NOT NULL DEFAULT '[]',
  machine_status TEXT NOT NULL DEFAULT '',
  warranty_text TEXT NOT NULL DEFAULT '',
  customer_remarks_json TEXT NOT NULL DEFAULT '[]',
  serviced_by_snapshot TEXT NOT NULL DEFAULT '',
  signature_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (signature_status IN ('not_required', 'pending', 'signed_in_person', 'signed_document_attached', 'declined', 'no_response')),
  content_snapshot_json TEXT,
  render_template_snapshot TEXT,
  template_version TEXT,
  pdf_state TEXT NOT NULL DEFAULT 'not_generated'
    CHECK (pdf_state IN ('not_generated', 'pending', 'ready', 'error')),
  share_state TEXT NOT NULL DEFAULT 'not_shared'
    CHECK (share_state IN ('not_shared', 'shared')),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  voided_at TEXT,
  void_reason TEXT
);

CREATE TABLE IF NOT EXISTS service_report_item_usage (
  id TEXT PRIMARY KEY NOT NULL,
  service_report_id TEXT NOT NULL REFERENCES service_reports(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  quantity_integer INTEGER NOT NULL CHECK (quantity_integer > 0),
  billable INTEGER NOT NULL CHECK (billable IN (0, 1)),
  resolved_selling_price_centavos INTEGER CHECK (resolved_selling_price_centavos >= 0),
  price_source TEXT CHECK (price_source IN ('base', 'customer', 'override')),
  override_reason TEXT,
  description_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_statements (
  id TEXT PRIMARY KEY NOT NULL,
  bs_number TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  service_report_id TEXT REFERENCES service_reports(id),
  document_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (document_state IN ('draft', 'finalized', 'voided')),
  business_date TEXT NOT NULL,
  backdate_reason TEXT,
  subtotal_centavos INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_centavos >= 0),
  discount_type TEXT CHECK (discount_type IN ('fixed', 'percentage')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discounted_total_centavos INTEGER NOT NULL DEFAULT 0 CHECK (discounted_total_centavos >= 0),
  payment_choice TEXT CHECK (payment_choice IN ('paid_in_full', 'down_payment', 'pay_later')),
  vat_snapshot_json TEXT,
  content_snapshot_json TEXT,
  render_template_snapshot TEXT,
  template_version TEXT,
  signature_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (signature_status IN ('not_required', 'pending', 'signed_in_person', 'signed_document_attached', 'declined', 'no_response')),
  pdf_state TEXT NOT NULL DEFAULT 'not_generated'
    CHECK (pdf_state IN ('not_generated', 'pending', 'ready', 'error')),
  share_state TEXT NOT NULL DEFAULT 'not_shared'
    CHECK (share_state IN ('not_shared', 'shared')),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  voided_at TEXT,
  void_reason TEXT
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  service_report_id TEXT REFERENCES service_reports(id),
  billing_statement_id TEXT REFERENCES billing_statements(id),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  business_date TEXT NOT NULL,
  actual_cost_centavos INTEGER NOT NULL CHECK (actual_cost_centavos >= 0),
  billable INTEGER NOT NULL CHECK (billable IN (0, 1)),
  billed_amount_centavos INTEGER CHECK (billed_amount_centavos >= 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS billing_statement_lines (
  id TEXT PRIMARY KEY NOT NULL,
  billing_statement_id TEXT NOT NULL REFERENCES billing_statements(id),
  line_type TEXT NOT NULL CHECK (line_type IN ('item', 'service', 'expense')),
  source_csr_usage_id TEXT UNIQUE REFERENCES service_report_item_usage(id),
  item_id TEXT REFERENCES items(id),
  service_id TEXT REFERENCES services(id),
  expense_id TEXT REFERENCES expenses(id),
  description_snapshot TEXT NOT NULL,
  quantity_integer INTEGER NOT NULL DEFAULT 1 CHECK (quantity_integer > 0),
  unit_price_centavos INTEGER NOT NULL CHECK (unit_price_centavos >= 0),
  amount_centavos INTEGER NOT NULL CHECK (amount_centavos >= 0),
  price_source TEXT CHECK (price_source IN ('base', 'customer', 'override', 'catalog', 'ad_hoc', 'expense')),
  override_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  pa_number TEXT UNIQUE,
  billing_statement_id TEXT NOT NULL REFERENCES billing_statements(id),
  amount_centavos INTEGER NOT NULL CHECK (amount_centavos > 0),
  business_date TEXT NOT NULL,
  backdate_reason TEXT,
  method TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'e_wallet', 'check', 'other')),
  reference_number TEXT,
  note TEXT,
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'voided')),
  void_reason TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT NOT NULL,
  voided_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_transactions (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  service_report_id TEXT REFERENCES service_reports(id),
  billing_statement_id TEXT REFERENCES billing_statements(id),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('sale', 'usage', 'adjustment', 'reversal')),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'voided')),
  note TEXT,
  created_at TEXT NOT NULL,
  voided_at TEXT
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id),
  stock_transaction_id TEXT REFERENCES stock_transactions(id),
  movement_type TEXT NOT NULL CHECK (movement_type IN ('restock', 'sale', 'nonbillable_usage', 'consumption', 'reversal')),
  quantity_delta_integer INTEGER NOT NULL CHECK (quantity_delta_integer <> 0),
  service_report_id TEXT REFERENCES service_reports(id),
  billing_statement_id TEXT REFERENCES billing_statements(id),
  source_movement_id TEXT REFERENCES inventory_movements(id),
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_attachments (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('service_report', 'billing_statement', 'payment')),
  owner_id TEXT NOT NULL,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('signature_image', 'generated_pdf', 'external_signed_pdf')),
  deterministic_filename TEXT NOT NULL,
  private_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_manifests (
  id TEXT PRIMARY KEY NOT NULL,
  filename TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  highest_revision INTEGER NOT NULL CHECK (highest_revision >= 0),
  record_counts_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS customers_name_idx ON customers(name);
CREATE INDEX IF NOT EXISTS equipment_customer_idx ON customer_equipment(customer_id);
CREATE INDEX IF NOT EXISTS items_name_idx ON items(name);
CREATE INDEX IF NOT EXISTS item_prices_lookup_idx ON customer_item_prices(customer_id, item_id, effective_from);
CREATE INDEX IF NOT EXISTS reports_customer_idx ON service_reports(customer_id, business_date);
CREATE INDEX IF NOT EXISTS statements_customer_idx ON billing_statements(customer_id, business_date);
CREATE INDEX IF NOT EXISTS payments_statement_idx ON payments(billing_statement_id, state);
CREATE INDEX IF NOT EXISTS movements_item_idx ON inventory_movements(item_id, created_at);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_events(entity_type, entity_id, created_at);

CREATE TRIGGER IF NOT EXISTS inventory_movements_prevent_negative
BEFORE INSERT ON inventory_movements
WHEN NEW.quantity_delta_integer < 0
  AND (
    COALESCE((
      SELECT SUM(quantity_delta_integer)
      FROM inventory_movements
      WHERE item_id = NEW.item_id
    ), 0) + NEW.quantity_delta_integer
  ) < 0
BEGIN
  SELECT RAISE(ABORT, 'INSUFFICIENT_STOCK');
END;
`;

export const SCHEMA_V2 = `
ALTER TABLE service_reports ADD COLUMN billing_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE service_reports ADD COLUMN total_bill_centavos INTEGER NOT NULL DEFAULT 0
  CHECK (total_bill_centavos >= 0);
ALTER TABLE service_reports ADD COLUMN acknowledged_by_snapshot TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS service_report_usage_one_item
  ON service_report_item_usage(service_report_id, item_id);

CREATE UNIQUE INDEX IF NOT EXISTS stock_transactions_one_active_csr_usage
  ON stock_transactions(service_report_id)
  WHERE transaction_type = 'usage' AND state = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS document_attachments_one_generated_pdf
  ON document_attachments(owner_type, owner_id)
  WHERE attachment_type = 'generated_pdf';
`;

export const SCHEMA_V3 = `
CREATE UNIQUE INDEX IF NOT EXISTS stock_transactions_one_active_statement_sale
  ON stock_transactions(billing_statement_id)
  WHERE transaction_type = 'sale' AND state = 'active';
`;

export const SCHEMA_V4 = `
ALTER TABLE payments ADD COLUMN payment_kind TEXT
  CHECK (payment_kind IN ('paid_in_full', 'down_payment', 'balance_payment', 'later_full'));
ALTER TABLE payments ADD COLUMN content_snapshot_json TEXT;
ALTER TABLE payments ADD COLUMN render_template_snapshot TEXT;
ALTER TABLE payments ADD COLUMN template_version TEXT;
ALTER TABLE payments ADD COLUMN pdf_state TEXT NOT NULL DEFAULT 'not_generated'
  CHECK (pdf_state IN ('not_generated', 'pending', 'ready', 'error'));
ALTER TABLE payments ADD COLUMN share_state TEXT NOT NULL DEFAULT 'not_shared'
  CHECK (share_state IN ('not_shared', 'shared'));
ALTER TABLE payments ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_active_down_payment
  ON payments(billing_statement_id)
  WHERE payment_kind = 'down_payment' AND state = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_unique
  ON payments(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
`;

export const SCHEMA_V5 = `
ALTER TABLE settings ADD COLUMN business_logo_data_url TEXT;
CREATE TABLE signature_captures (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('settings','service_report','billing_statement')),
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','preparer')),
  signer_name TEXT NOT NULL,
  png_data_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  render_template_snapshot TEXT,
  pdf_state TEXT NOT NULL DEFAULT 'pending' CHECK (pdf_state IN ('pending','ready','error')),
  deterministic_filename TEXT,
  private_path TEXT,
  checksum TEXT
);
CREATE INDEX signature_captures_owner ON signature_captures(owner_type,owner_id,created_at);
CREATE TRIGGER signature_captures_immutable
BEFORE UPDATE OF id,owner_type,owner_id,role,signer_name,png_data_url,created_at,render_template_snapshot,deterministic_filename ON signature_captures
BEGIN SELECT RAISE(ABORT, 'SIGNATURE_IS_IMMUTABLE'); END;
CREATE TRIGGER signature_captures_no_delete BEFORE DELETE ON signature_captures
BEGIN SELECT RAISE(ABORT, 'SIGNATURE_IS_IMMUTABLE'); END;
`;

export const SCHEMA_V6 = `
CREATE TABLE service_report_service_usage (
  id TEXT PRIMARY KEY NOT NULL,
  service_report_id TEXT NOT NULL REFERENCES service_reports(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  quantity_integer INTEGER NOT NULL DEFAULT 1 CHECK (quantity_integer = 1),
  resolved_rate_centavos INTEGER NOT NULL CHECK (resolved_rate_centavos >= 0),
  rate_source TEXT NOT NULL CHECK (rate_source IN ('catalog', 'override')),
  override_reason TEXT,
  description_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX service_report_service_usage_one_service
  ON service_report_service_usage(service_report_id, service_id);
CREATE INDEX service_report_service_usage_report_idx
  ON service_report_service_usage(service_report_id, created_at);
`;

export const SCHEMA_V7 = `
ALTER TABLE billing_statement_lines
  ADD COLUMN source_csr_service_usage_id TEXT REFERENCES service_report_service_usage(id);

CREATE UNIQUE INDEX IF NOT EXISTS billing_statement_lines_source_csr_service_unique
  ON billing_statement_lines(source_csr_service_usage_id)
  WHERE source_csr_service_usage_id IS NOT NULL;
`;

export const SCHEMA_V8 = `
ALTER TABLE customers ADD COLUMN customer_type TEXT NOT NULL DEFAULT 'individual'
  CHECK (customer_type IN ('individual', 'company'));

CREATE TABLE customer_members (
  id TEXT PRIMARY KEY NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  contact_number TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX customer_members_customer_idx ON customer_members(customer_id, active, name);
`;

export const SCHEMA_V9 = `
CREATE TABLE signature_drafts (
  owner_type TEXT NOT NULL CHECK (owner_type IN ('service_report','billing_statement')),
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','preparer')),
  signer_name TEXT NOT NULL CHECK (length(trim(signer_name)) > 0),
  png_data_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_type, owner_id, role)
);
`;

export const SCHEMA_V10 = `
CREATE TABLE service_report_equipment (
  service_report_id TEXT NOT NULL REFERENCES service_reports(id),
  equipment_id TEXT NOT NULL REFERENCES customer_equipment(id),
  position INTEGER NOT NULL CHECK (position >= 1),
  created_at TEXT NOT NULL,
  PRIMARY KEY (service_report_id, equipment_id)
);

CREATE INDEX service_report_equipment_equipment_idx
  ON service_report_equipment(equipment_id);

INSERT INTO service_report_equipment (service_report_id, equipment_id, position, created_at)
SELECT id, equipment_id, 1, created_at FROM service_reports;
`;

/**
 * Per-machine service charges. Each row prices one service on one machine of a
 * CSR; the CSR total and linked billing lines come straight from these rows.
 * Rows backfilled from v10 usages keep that usage id so statements that already
 * billed the old per-service line are still recognised as billed.
 */
export const SCHEMA_V11 = `
CREATE TABLE service_report_machine_service (
  id TEXT PRIMARY KEY NOT NULL,
  service_report_id TEXT NOT NULL REFERENCES service_reports(id),
  equipment_id TEXT NOT NULL REFERENCES customer_equipment(id),
  service_id TEXT NOT NULL REFERENCES services(id),
  rate_centavos INTEGER NOT NULL CHECK (rate_centavos >= 0),
  rate_source TEXT NOT NULL CHECK (rate_source IN ('catalog', 'custom')),
  description_snapshot TEXT NOT NULL,
  machine_label TEXT NOT NULL,
  note TEXT,
  legacy_service_usage_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX service_report_machine_service_report_idx
  ON service_report_machine_service(service_report_id, equipment_id, created_at);

ALTER TABLE billing_statement_lines
  ADD COLUMN source_csr_machine_service_id TEXT REFERENCES service_report_machine_service(id);

CREATE UNIQUE INDEX billing_statement_lines_source_machine_service_unique
  ON billing_statement_lines(source_csr_machine_service_id)
  WHERE source_csr_machine_service_id IS NOT NULL;

INSERT INTO service_report_machine_service
  (id, service_report_id, equipment_id, service_id, rate_centavos, rate_source,
   description_snapshot, machine_label, note, legacy_service_usage_id, created_at)
SELECT u.id || ':' || q.id, u.service_report_id, q.id, u.service_id, u.resolved_rate_centavos,
       CASE u.rate_source WHEN 'override' THEN 'custom' ELSE 'catalog' END,
       u.description_snapshot,
       q.machine_type || CASE
         WHEN q.nickname_or_location <> '' THEN ' · ' || q.nickname_or_location
         WHEN q.serial_number <> '' THEN ' · SN ' || q.serial_number
         ELSE '' END,
       u.override_reason, u.id, u.created_at
FROM service_report_service_usage u
JOIN (
  SELECT service_report_id, equipment_id, position FROM service_report_equipment
  UNION ALL
  SELECT id, equipment_id, 1 FROM service_reports
  WHERE id NOT IN (SELECT service_report_id FROM service_report_equipment)
) m ON m.service_report_id = u.service_report_id
JOIN customer_equipment q ON q.id = m.equipment_id
ORDER BY u.created_at, u.id, m.position;
`;


/**
 * Quotations and Delivery forms.
 *
 * SQLite cannot alter a CHECK constraint, so the four small leaf tables whose
 * CHECKs name document kinds are rebuilt (explicit column lists, indexes and
 * triggers recreated): sequences, document_attachments, signature_drafts and
 * signature_captures. Stock tables are not rebuilt: a delivery posts ordinary
 * 'sale' / 'reversal' rows that carry a nullable delivery_id.
 *
 * Quotations point at what they were converted to; deliveries do not point back,
 * which keeps the foreign keys acyclic for backup restore.
 */
export const SCHEMA_V12 = `
CREATE TABLE sequences_v12 (
  name TEXT PRIMARY KEY NOT NULL CHECK (name IN ('CSR', 'BS', 'PA', 'QT', 'DF')),
  high_water_mark INTEGER NOT NULL DEFAULT 0 CHECK (high_water_mark >= 0)
);
INSERT INTO sequences_v12 (name, high_water_mark) SELECT name, high_water_mark FROM sequences;
DROP TABLE sequences;
ALTER TABLE sequences_v12 RENAME TO sequences;
INSERT OR IGNORE INTO sequences (name, high_water_mark) VALUES ('QT', 0), ('DF', 0);

CREATE TABLE document_attachments_v12 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('service_report', 'billing_statement', 'payment', 'quotation', 'delivery')),
  owner_id TEXT NOT NULL,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('signature_image', 'generated_pdf', 'external_signed_pdf')),
  deterministic_filename TEXT NOT NULL,
  private_path TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO document_attachments_v12 (id, owner_type, owner_id, attachment_type, deterministic_filename, private_path, checksum, created_at)
SELECT id, owner_type, owner_id, attachment_type, deterministic_filename, private_path, checksum, created_at FROM document_attachments;
DROP TABLE document_attachments;
ALTER TABLE document_attachments_v12 RENAME TO document_attachments;
CREATE UNIQUE INDEX document_attachments_one_generated_pdf
  ON document_attachments(owner_type, owner_id)
  WHERE attachment_type = 'generated_pdf';

CREATE TABLE signature_drafts_v12 (
  owner_type TEXT NOT NULL CHECK (owner_type IN ('service_report','billing_statement','quotation','delivery')),
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','preparer')),
  signer_name TEXT NOT NULL CHECK (length(trim(signer_name)) > 0),
  png_data_url TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_type, owner_id, role)
);
INSERT INTO signature_drafts_v12 (owner_type, owner_id, role, signer_name, png_data_url, updated_at)
SELECT owner_type, owner_id, role, signer_name, png_data_url, updated_at FROM signature_drafts;
DROP TABLE signature_drafts;
ALTER TABLE signature_drafts_v12 RENAME TO signature_drafts;

CREATE TABLE signature_captures_v12 (
  id TEXT PRIMARY KEY NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('settings','service_report','billing_statement','quotation','delivery')),
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','preparer')),
  signer_name TEXT NOT NULL,
  png_data_url TEXT NOT NULL,
  created_at TEXT NOT NULL,
  render_template_snapshot TEXT,
  pdf_state TEXT NOT NULL DEFAULT 'pending' CHECK (pdf_state IN ('pending','ready','error')),
  deterministic_filename TEXT,
  private_path TEXT,
  checksum TEXT
);
INSERT INTO signature_captures_v12 (id, owner_type, owner_id, role, signer_name, png_data_url, created_at, render_template_snapshot, pdf_state, deterministic_filename, private_path, checksum)
SELECT id, owner_type, owner_id, role, signer_name, png_data_url, created_at, render_template_snapshot, pdf_state, deterministic_filename, private_path, checksum FROM signature_captures;
DROP TABLE signature_captures;
ALTER TABLE signature_captures_v12 RENAME TO signature_captures;
CREATE INDEX signature_captures_owner ON signature_captures(owner_type,owner_id,created_at);
CREATE TRIGGER signature_captures_immutable
BEFORE UPDATE OF id,owner_type,owner_id,role,signer_name,png_data_url,created_at,render_template_snapshot,deterministic_filename ON signature_captures
BEGIN SELECT RAISE(ABORT, 'SIGNATURE_IS_IMMUTABLE'); END;
CREATE TRIGGER signature_captures_no_delete BEFORE DELETE ON signature_captures
BEGIN SELECT RAISE(ABORT, 'SIGNATURE_IS_IMMUTABLE'); END;

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY NOT NULL,
  df_number TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  document_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (document_state IN ('draft', 'finalized', 'voided')),
  business_date TEXT NOT NULL,
  delivered_by TEXT NOT NULL DEFAULT '',
  received_by TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal_centavos INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_centavos >= 0),
  content_snapshot_json TEXT,
  render_template_snapshot TEXT,
  template_version TEXT,
  signature_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (signature_status IN ('not_required', 'pending', 'signed_in_person', 'signed_document_attached', 'declined', 'no_response')),
  pdf_state TEXT NOT NULL DEFAULT 'not_generated'
    CHECK (pdf_state IN ('not_generated', 'pending', 'ready', 'error')),
  share_state TEXT NOT NULL DEFAULT 'not_shared'
    CHECK (share_state IN ('not_shared', 'shared')),
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX deliveries_customer_idx ON deliveries(customer_id, created_at);

CREATE TABLE delivery_lines (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  item_id TEXT NOT NULL REFERENCES items(id),
  description_snapshot TEXT NOT NULL,
  quantity_integer INTEGER NOT NULL CHECK (quantity_integer > 0),
  unit_price_centavos INTEGER NOT NULL CHECK (unit_price_centavos >= 0),
  amount_centavos INTEGER NOT NULL CHECK (amount_centavos >= 0),
  price_source TEXT NOT NULL CHECK (price_source IN ('base', 'customer', 'override')),
  override_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX delivery_lines_one_item ON delivery_lines(delivery_id, item_id);

CREATE TABLE quotations (
  id TEXT PRIMARY KEY NOT NULL,
  qt_number TEXT UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  document_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (document_state IN ('draft', 'finalized', 'voided')),
  business_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  subtotal_centavos INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_centavos >= 0),
  discount_type TEXT CHECK (discount_type IN ('fixed', 'percentage')),
  discount_value INTEGER NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  discounted_total_centavos INTEGER NOT NULL DEFAULT 0 CHECK (discounted_total_centavos >= 0),
  vat_snapshot_json TEXT,
  content_snapshot_json TEXT,
  render_template_snapshot TEXT,
  template_version TEXT,
  signature_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (signature_status IN ('not_required', 'pending', 'signed_in_person', 'signed_document_attached', 'declined', 'no_response')),
  pdf_state TEXT NOT NULL DEFAULT 'not_generated'
    CHECK (pdf_state IN ('not_generated', 'pending', 'ready', 'error')),
  share_state TEXT NOT NULL DEFAULT 'not_shared'
    CHECK (share_state IN ('not_shared', 'shared')),
  converted_kind TEXT CHECK (converted_kind IN ('repair', 'delivery')),
  converted_service_report_id TEXT REFERENCES service_reports(id),
  converted_delivery_id TEXT REFERENCES deliveries(id),
  converted_billing_statement_id TEXT REFERENCES billing_statements(id),
  converted_at TEXT,
  created_at TEXT NOT NULL,
  finalized_at TEXT,
  voided_at TEXT,
  void_reason TEXT
);
CREATE INDEX quotations_customer_idx ON quotations(customer_id, created_at);

CREATE TABLE quotation_lines (
  id TEXT PRIMARY KEY NOT NULL,
  quotation_id TEXT NOT NULL REFERENCES quotations(id),
  line_type TEXT NOT NULL CHECK (line_type IN ('item', 'service')),
  item_id TEXT REFERENCES items(id),
  service_id TEXT REFERENCES services(id),
  description_snapshot TEXT NOT NULL,
  quantity_integer INTEGER NOT NULL DEFAULT 1 CHECK (quantity_integer > 0),
  unit_price_centavos INTEGER NOT NULL CHECK (unit_price_centavos >= 0),
  amount_centavos INTEGER NOT NULL CHECK (amount_centavos >= 0),
  price_source TEXT NOT NULL CHECK (price_source IN ('base', 'customer', 'override', 'catalog')),
  override_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX quotation_lines_quotation_idx ON quotation_lines(quotation_id, created_at);

ALTER TABLE stock_transactions ADD COLUMN delivery_id TEXT REFERENCES deliveries(id);
ALTER TABLE inventory_movements ADD COLUMN delivery_id TEXT REFERENCES deliveries(id);
ALTER TABLE inventory_movements ADD COLUMN delivery_line_id TEXT REFERENCES delivery_lines(id);
CREATE UNIQUE INDEX stock_transactions_one_active_delivery_sale
  ON stock_transactions(delivery_id)
  WHERE delivery_id IS NOT NULL AND transaction_type = 'sale' AND state = 'active';
CREATE UNIQUE INDEX inventory_movements_one_delivery_line_sale
  ON inventory_movements(delivery_line_id)
  WHERE delivery_line_id IS NOT NULL AND movement_type = 'sale';
CREATE UNIQUE INDEX inventory_movements_one_delivery_line_reversal
  ON inventory_movements(delivery_line_id)
  WHERE delivery_line_id IS NOT NULL AND movement_type = 'reversal';

ALTER TABLE billing_statements ADD COLUMN source_delivery_id TEXT REFERENCES deliveries(id);
CREATE UNIQUE INDEX billing_statements_one_live_per_delivery
  ON billing_statements(source_delivery_id)
  WHERE source_delivery_id IS NOT NULL AND document_state <> 'voided';
CREATE TRIGGER billing_statements_single_source_insert
BEFORE INSERT ON billing_statements
WHEN NEW.service_report_id IS NOT NULL AND NEW.source_delivery_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'BILLING_STATEMENT_SINGLE_SOURCE'); END;
CREATE TRIGGER billing_statements_single_source_update
BEFORE UPDATE OF service_report_id, source_delivery_id ON billing_statements
WHEN NEW.service_report_id IS NOT NULL AND NEW.source_delivery_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'BILLING_STATEMENT_SINGLE_SOURCE'); END;

ALTER TABLE billing_statement_lines ADD COLUMN source_delivery_line_id TEXT REFERENCES delivery_lines(id);
CREATE UNIQUE INDEX billing_statement_lines_source_delivery_unique
  ON billing_statement_lines(source_delivery_line_id)
  WHERE source_delivery_line_id IS NOT NULL;
`;
