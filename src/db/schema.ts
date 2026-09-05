export const DATABASE_NAME = 'a-ross-operations.db';
export const DATABASE_VERSION = 2;

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
