/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10, SCHEMA_V11 } from '@/db/schema';

let idCounter = 0;
const files = vi.hoisted(() => new Map<string, string>());
const sharedTargets = vi.hoisted(() => [] as string[]);
const printer = vi.hoisted(() => vi.fn(async (_options: { width: number; height: number; html: string }) => {
  files.set('file://cache/print.pdf', 'JVBERi0xLjQK');
  return { uri: 'file://cache/print.pdf', base64: 'JVBERi0xLjQK', numberOfPages: 1 };
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
  writeAsStringAsync: async (path: string, contents: string) => { files.set(path, contents); },
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`Missing ${from}`);
    files.set(to, files.get(from)!);
  },
  deleteAsync: async (path: string) => { files.delete(path); },
}));

import { finalizeAndRenderBillingStatement } from '@/features/billing-statements/billing-statement-pdf';
import { addServiceLine, createBillingStatementDraft, voidBillingStatement } from '@/features/billing-statements/billing-statement-repository';
import { runShareSequence } from '@/features/documents/share-sequence';
import { getBillingStatementShareSteps, getServiceReportShareSteps } from '@/features/documents/share-steps';
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

describe('sharing a CSR together with its billing statements', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

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

  const confirmYes = async () => true;

  it('offers the CSR first and its billing statement next, both named from the CSR ID', async () => {
    const { reportId } = await finalizedCsrWithStatement();
    const steps = await getServiceReportShareSteps(db, reportId);
    expect(steps.map((step) => step.fileName)).toEqual(['CSR-000001 Customer Service Report.pdf', 'CSR-000001 Billing Statement.pdf']);

    expect(await runShareSequence(steps, confirmYes)).toBe(2);
    expect(sharedTargets).toEqual([
      'file://cache/shared-pdfs/CSR-000001 Customer Service Report.pdf',
      'file://cache/shared-pdfs/CSR-000001 Billing Statement.pdf',
    ]);
    expect(files.has('file://docs/documents/CSR-000001.pdf')).toBe(true);
    expect(raw.prepare("SELECT share_state FROM service_reports WHERE id=?").get(reportId)).toEqual({ share_state: 'shared' });
    expect(raw.prepare("SELECT share_state FROM billing_statements WHERE service_report_id=?").get(reportId)).toEqual({ share_state: 'shared' });
  });

  it('shares only the CSR when the user skips the linked statement', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    expect(await runShareSequence(await getServiceReportShareSteps(db, reportId), async () => false)).toBe(1);
    expect(sharedTargets).toHaveLength(1);
    expect(raw.prepare('SELECT share_state FROM billing_statements WHERE id=?').get(statementId)).toEqual({ share_state: 'not_shared' });
  });

  it('shares just the CSR when nothing is linked', async () => {
    const reportId = await createServiceReportDraft(db, { ...DRAFT, equipmentId: 'washer' });
    await addReportServiceUsage(db, reportId, 'service');
    await finalizeAndRenderServiceReport(db, reportId);
    const steps = await getServiceReportShareSteps(db, reportId);
    expect(steps.map((step) => step.fileName)).toEqual(['CSR-000001 Customer Service Report.pdf']);
  });

  it('adds the statement number to each name when the CSR has several statements', async () => {
    const { reportId } = await finalizedCsrWithStatement();
    raw.exec("INSERT INTO billing_statements(id,bs_number,customer_id,service_report_id,document_state,business_date,pdf_state,created_at,finalized_at) VALUES('second','BS-000009','customer','" + reportId + "','finalized','2026-09-05','ready','now','2026-09-05T13:00:00Z')");
    raw.prepare("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES('att','billing_statement','second','generated_pdf','BS-000009.pdf','file://docs/documents/BS-000009.pdf','x','now')").run();
    files.set('file://docs/documents/BS-000009.pdf', 'JVBERi0xLjQK');
    const names = (await getServiceReportShareSteps(db, reportId)).map((step) => step.fileName);
    expect(names).toEqual([
      'CSR-000001 Customer Service Report.pdf',
      'CSR-000001 Billing Statement BS-000001.pdf',
      'CSR-000001 Billing Statement BS-000009.pdf',
    ]);
  });

  it('skips draft and voided statements', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    await createBillingStatementDraft(db, { ...DRAFT, serviceReportId: reportId });
    await voidBillingStatement(db, statementId, 'Entered in error', []);
    const steps = await getServiceReportShareSteps(db, reportId);
    expect(steps.map((step) => step.title)).toEqual(['Customer Service Report']);
  });

  it('renders a missing statement PDF before any share sheet opens', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    raw.prepare("UPDATE billing_statements SET pdf_state='not_generated' WHERE id=?").run(statementId);
    printer.mockClear();
    await getServiceReportShareSteps(db, reportId);
    expect(printer).toHaveBeenCalledTimes(1);
    expect(sharedTargets).toHaveLength(0);
    expect(raw.prepare('SELECT pdf_state FROM billing_statements WHERE id=?').get(statementId)).toEqual({ pdf_state: 'ready' });
  });

  it('prints every PDF as a portrait page at its document size', async () => {
    await finalizedCsrWithStatement();
    const sizes = printer.mock.calls.map(([options]) => [options.width, options.height]);
    expect(sizes).toEqual([[612, 1008], [595, 842]]);
    for (const [width, height] of sizes) expect(height).toBeGreaterThan(width);
    expect(printer.mock.calls.every(([options]) => !options.html.includes('device-width'))).toBe(true);
  });

  it('sharing a linked Billing Statement offers its CSR next, named from the CSR ID', async () => {
    const { statementId } = await finalizedCsrWithStatement();
    const steps = await getBillingStatementShareSteps(db, statementId);
    expect(steps.map((step) => step.fileName)).toEqual(['CSR-000001 Billing Statement.pdf', 'CSR-000001 Customer Service Report.pdf']);
    expect(await runShareSequence(steps, confirmYes)).toBe(2);
    expect(sharedTargets).toEqual([
      'file://cache/shared-pdfs/CSR-000001 Billing Statement.pdf',
      'file://cache/shared-pdfs/CSR-000001 Customer Service Report.pdf',
    ]);
    expect(await runShareSequence(await getBillingStatementShareSteps(db, statementId), async () => false)).toBe(1);
  });

  it('sharing a standalone Billing Statement offers only itself', async () => {
    const statementId = await createBillingStatementDraft(db, DRAFT);
    await addServiceLine(db, statementId, { serviceId: 'service' });
    await finalizeAndRenderBillingStatement(db, statementId);
    const steps = await getBillingStatementShareSteps(db, statementId);
    expect(steps.map((step) => step.fileName)).toEqual(['BS-000001 Billing Statement.pdf']);
  });

  it('renders a missing CSR PDF before sharing its statement, and refuses an unfinalized statement', async () => {
    const { reportId, statementId } = await finalizedCsrWithStatement();
    files.delete('file://docs/documents/CSR-000001.pdf');
    printer.mockClear();
    await getBillingStatementShareSteps(db, statementId);
    expect(printer).toHaveBeenCalledTimes(1);
    expect(files.has('file://docs/documents/CSR-000001.pdf')).toBe(true);
    expect(reportId).toBeTruthy();
    const draft = await createBillingStatementDraft(db, DRAFT);
    await expect(getBillingStatementShareSteps(db, draft)).rejects.toThrow(/finalized/);
  });
});

