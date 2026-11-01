/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import { PDFDocument } from 'pdf-lib';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11 } from '@/db/schema';

let idCounter = 0;
const files = vi.hoisted(() => new Map<string, string>());
const sharedTargets = vi.hoisted(() => [] as string[]);
const samples = vi.hoisted(() => ({ legal: '', a4: '' }));
const printer = vi.hoisted(() => vi.fn(async (options: { width: number; height: number; html: string }) => {
  files.set('file://cache/print.pdf', options.width === 612 ? samples.legal : samples.a4);
  return { uri: 'file://cache/print.pdf', base64: options.width === 612 ? samples.legal : samples.a4, numberOfPages: 1 };
}));

vi.mock('expo-crypto', () => ({
  randomUUID: () => `share-test-${++idCounter}`,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async () => 'ABCDEF1234567890',
}));
vi.mock('expo-print', () => ({ printToFileAsync: printer }));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: async (target: string) => { sharedTargets.push(target); },
}));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file://docs/',
  cacheDirectory: 'file://cache/',
  EncodingType: { Base64: 'base64' },
  makeDirectoryAsync: async () => undefined,
  getInfoAsync: async (path: string) => ({ exists: files.has(path), isDirectory: false }),
  readAsStringAsync: async (path: string) => {
    const contents = files.get(path);
    if (contents === undefined) throw new Error(`Missing ${path}`);
    return contents;
  },
  writeAsStringAsync: async (path: string, contents: string) => { files.set(path, contents); },
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`Missing ${from}`);
    files.set(to, files.get(from)!);
  },
  deleteAsync: async (path: string) => { files.delete(path); },
}));

import { finalizeAndRenderBillingStatement } from '@/features/billing-statements/billing-statement-pdf';
import { addServiceLine, createBillingStatementDraft, voidBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { getBillingStatementShareBundle, getServiceReportShareBundle, shareBundle } from '@/features/documents/share-bundle';
import { finalizeAndRenderServiceReport } from '@/features/service-reports/service-report-pdf';
import { addReportServiceUsage, createServiceReportDraft } from '@/features/service-reports/service-report-repository';

type Params = Array<string | number | null>;

function adapter(database: DatabaseSync): SQLiteDatabase {
  const api = {
    getFirstAsync: async <T>(sql: string, ...params: Params) => database.prepare(sql).get(...params) as T | undefined,
    getAllAsync: async <T>(sql: string, ...params: Params) => database.prepare(sql).all(...params) as T[],
    runAsync: async (sql: string, ...params: Params) => {
      const result = database.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
    },
    withExclusiveTransactionAsync: async <T>(task: (tx: SQLiteDatabase) => Promise<T>) => {
      database.exec('BEGIN IMMEDIATE');
      try {
        const result = await task(api as unknown as SQLiteDatabase);
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return api as unknown as SQLiteDatabase;
}

const NOW = '2026-09-05T00:00:00.000Z';
const DRAFT = { customerId: 'customer', businessDate: '2026-09-05' };
const CSR_FILE = 'Laundry CSR-000001 2026-09-05.pdf';

async function pageSizes(base64: string): Promise<number[][]> {
  const doc = await PDFDocument.load(base64, { ignoreEncryption: true });
  return doc.getPages().map((page) => [page.getWidth(), page.getHeight()]);
}

describe('sending a CSR and its billing statement as one PDF', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeAll(async () => {
    const legal = await PDFDocument.create();
    legal.addPage([612, 1008]);
    samples.legal = await legal.saveAsBase64();
    const a4 = await PDFDocument.create();
    a4.addPage([595, 842]);
    samples.a4 = await a4.saveAsBase64();
  });

  beforeEach(() => {
    idCounter = 0;
    files.clear();
    sharedTargets.length = 0;
    printer.mockClear();
    vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') });
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}${SCHEMA_V6}${SCHEMA_V7}${SCHEMA_V8}${SCHEMA_V9}${SCHEMA_V10}${SCHEMA_V11}`);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','0')");
    raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',0),('BS',0),('PA',0)");
    raw.prepare("INSERT INTO settings(id,business_name,business_address,contact_details,owner_name,created_at,updated_at) VALUES('business','A.Ross','Quezon','0917','Owner',?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO customers(id,name,address,active,created_at,updated_at) VALUES('customer','Laundry','Sariaya',1,?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('washer','customer','Washer',1,?,?)").run(NOW, NOW);
    raw.prepare("INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor',50000,1,?,?)").run(NOW, NOW);
    db = adapter(raw);
  });

  afterEach(() => {
    raw.close();
    vi.useRealTimers();
  });

  async function finalizedCsrWithStatement() {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await addReportServiceUsage(db, reportId, 'service');
    const statementId = await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });
    await finalizeAndRenderServiceReport(db, reportId);
    await finalizeAndRenderBillingStatement(db, statementId);
    return { reportId, statementId };
  }

  it('sending a CSR with a linked statement makes ONE PDF: the CSR page, then the statement page', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    const bundle = await getServiceReportShareBundle(db, reportId);
    expect(bundle.fileName).toBe(CSR_FILE);
    expect(bundle.documents).toEqual([{ kind: 'service_report', id: reportId }, { kind: 'billing_statement', id: statementId }]);
    expect(bundle.sourceUris).toEqual(['file://docs/documents/CSR-000001.pdf', 'file://docs/documents/BS-000001.pdf']);

    await shareBundle(db, bundle);
    expect(sharedTargets).toEqual([`file://cache/shared-pdfs/${CSR_FILE}`]);
    expect(await pageSizes(files.get(`file://cache/shared-pdfs/${CSR_FILE}`)!)).toEqual([[612, 1008], [595, 842]]);
    expect(raw.prepare('SELECT share_state FROM service_reports WHERE id=?').get(reportId)).toEqual({ share_state: 'shared' });
    expect(raw.prepare('SELECT share_state FROM billing_statements WHERE id=?').get(statementId)).toEqual({ share_state: 'shared' });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type IN ('csr.share_sheet_opened','billing_statement.share_sheet_opened')").get()).toEqual({ count: 2 });
  });

  it('sending the statement of a linked CSR makes the same one PDF, in the same order, with the CSR file name', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    const bundle = await getBillingStatementShareBundle(db, statementId);
    expect(bundle.fileName).toBe(CSR_FILE);
    expect(bundle.documents).toEqual([{ kind: 'service_report', id: reportId }, { kind: 'billing_statement', id: statementId }]);
    await shareBundle(db, bundle);
    expect(sharedTargets).toEqual([`file://cache/shared-pdfs/${CSR_FILE}`]);
    expect(await pageSizes(files.get(`file://cache/shared-pdfs/${CSR_FILE}`)!)).toEqual([[612, 1008], [595, 842]]);
  });

  it('sends a billing statement with no CSR by itself, named by its own code', async () => {
    const statementId = await createBillingStatementDraft(db, DRAFT);
    await addServiceLine(db, statementId, { serviceId: 'service' });
    await finalizeAndRenderBillingStatement(db, statementId);
    const bundle = await getBillingStatementShareBundle(db, statementId);
    expect(bundle).toMatchObject({ fileName: 'Laundry BS-000001 2026-09-05.pdf', documents: [{ kind: 'billing_statement', id: statementId }] });
    await shareBundle(db, bundle);
    expect(await pageSizes(files.get('file://cache/shared-pdfs/Laundry BS-000001 2026-09-05.pdf')!)).toEqual([[595, 842]]);
  });

  it('sends a CSR with no statement by itself', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await addReportServiceUsage(db, reportId, 'service');
    await finalizeAndRenderServiceReport(db, reportId);
    const bundle = await getServiceReportShareBundle(db, reportId);
    expect(bundle).toMatchObject({ fileName: CSR_FILE, documents: [{ kind: 'service_report', id: reportId }] });
    await shareBundle(db, bundle);
    expect(await pageSizes(files.get(`file://cache/shared-pdfs/${CSR_FILE}`)!)).toEqual([[612, 1008]]);
  });

  it('with several statements the CSR sends all of them after it, but a statement sends only itself after the CSR', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,pdf_state,created_at,finalized_at) VALUES('second','BS-000009','customer','" + reportId + "','finalized','2026-09-05','ready','now','2026-09-05T13:00:00Z')");
    raw.prepare("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES('att','billing_statement','second','generated_pdf','BS-000009.pdf','file://docs/documents/BS-000009.pdf','x','now')").run();
    files.set('file://docs/documents/BS-000009.pdf', samples.a4);

    expect((await getServiceReportShareBundle(db, reportId)).documents.map((document) => document.id)).toEqual([reportId, statementId, 'second']);
    const second = await getBillingStatementShareBundle(db, 'second');
    expect(second.documents.map((document) => document.id)).toEqual([reportId, 'second']);
    expect(second.fileName).toBe(CSR_FILE);
  });

  it('leaves draft and voided statements out', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });
    await voidBillingStatement(db, statementId, 'Entered in error', []);
    expect((await getServiceReportShareBundle(db, reportId)).documents).toEqual([{ kind: 'service_report', id: reportId }]);
  });

  it('renders any missing PDF before sharing and refuses documents that are not finalized', async () => {
    const { statementId } = await finalizedCsrWithStatement();
    files.delete('file://docs/documents/CSR-000001.pdf');
    files.delete('file://docs/documents/BS-000001.pdf');
    printer.mockClear();
    const bundle = await getBillingStatementShareBundle(db, statementId);
    expect(printer).toHaveBeenCalledTimes(2);
    expect(bundle.sourceUris.every((uri) => files.has(uri))).toBe(true);
    const draft = await createBillingStatementDraft(db, DRAFT);
    await expect(getBillingStatementShareBundle(db, draft)).rejects.toThrow(/finalized/);
    const draftCsr = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await expect(getServiceReportShareBundle(db, draftCsr)).rejects.toThrow(/finalized/);
  });

  it('prints every PDF as a portrait page at its document size', async () => {
    await finalizedCsrWithStatement();
    const sizes = printer.mock.calls.map(([options]) => [options.width, options.height]);
    expect(sizes).toEqual([[612, 1008], [595, 842]]);
    for (const [width, height] of sizes) expect(height).toBeGreaterThan(width);
    expect(printer.mock.calls.every(([options]) => !options.html.includes('device-width'))).toBe(true);
  });
});
