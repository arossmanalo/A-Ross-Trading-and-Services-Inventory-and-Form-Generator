/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { schemaSql } from '@/test-utils/schema';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'v12-test-id' }));

import { migrateDatabase } from '@/db/migrations';

type Params = Array<string | number | null>;

function adapter(database: DatabaseSync): SQLiteDatabase {
  const api = {
    execAsync: async (sql: string) => { database.exec(sql); },
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

const T = '2026-09-05T00:00:00.000Z';

/** A database exactly as the v11 app left it, with rows in every table the migration rebuilds. */
describe('upgrading a v11 database to quotations and deliveries', () => {
  let raw: DatabaseSync;
  let db: SQLiteDatabase;

  beforeEach(async () => {
    raw = new DatabaseSync(':memory:');
    raw.exec(`PRAGMA foreign_keys=ON;${schemaSql(11)}PRAGMA user_version = 11;`);
    raw.exec("INSERT INTO app_meta(key,value) VALUES('database_revision','7')");
    raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',4),('BS',2),('PA',1)");
    raw.prepare("INSERT INTO customers(id,name,created_at,updated_at) VALUES('customer','Quicklean',?,?)").run(T, T);
    raw.prepare("INSERT INTO billing_statements(id,customer_id,business_date,created_at) VALUES('bs-old','customer','2026-09-01',?)").run(T);
    raw.prepare("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES('att','billing_statement','bs-old','generated_pdf','BS-000001.pdf','/x/BS-000001.pdf','abc',?)").run(T);
    raw.prepare("INSERT INTO signature_captures(id,owner_type,owner_id,role,signer_name,png_data_url,created_at,render_template_snapshot,deterministic_filename) VALUES('cap','billing_statement','bs-old','customer','Cust','data:image/png;base64,AA',?,'<html></html>','BS-000001-in-person-cap.pdf')").run(T);
    raw.prepare("INSERT INTO signature_drafts(owner_type,owner_id,role,signer_name,png_data_url,updated_at) VALUES('billing_statement','bs-old','preparer','Prep','data:image/png;base64,AA',?)").run(T);
    db = adapter(raw);
    await migrateDatabase(db);
  });

  it('reaches version 12 and keeps every existing row and sequence value', () => {
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 12 });
    expect(raw.prepare('SELECT name, high_water_mark FROM sequences ORDER BY name').all()).toEqual([
      { name: 'BS', high_water_mark: 2 }, { name: 'CSR', high_water_mark: 4 }, { name: 'DF', high_water_mark: 0 },
      { name: 'PA', high_water_mark: 1 }, { name: 'QT', high_water_mark: 0 },
    ]);
    expect(raw.prepare('SELECT id, owner_type FROM document_attachments').all()).toEqual([{ id: 'att', owner_type: 'billing_statement' }]);
    expect(raw.prepare('SELECT id, signer_name, deterministic_filename FROM signature_captures').all()).toEqual([{ id: 'cap', signer_name: 'Cust', deterministic_filename: 'BS-000001-in-person-cap.pdf' }]);
    expect(raw.prepare('SELECT owner_id, role FROM signature_drafts').all()).toEqual([{ owner_id: 'bs-old', role: 'preparer' }]);
    expect(raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(raw.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
  });

  it('keeps signatures immutable and the one-generated-PDF rule', () => {
    expect(() => raw.prepare("UPDATE signature_captures SET signer_name='Changed' WHERE id='cap'").run()).toThrow(/SIGNATURE_IS_IMMUTABLE/);
    expect(() => raw.prepare("DELETE FROM signature_captures WHERE id='cap'").run()).toThrow(/SIGNATURE_IS_IMMUTABLE/);
    expect(() => raw.prepare("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES('att2','billing_statement','bs-old','generated_pdf','x.pdf','/x','abc',?)").run(T)).toThrow(/UNIQUE/);
  });

  it('accepts the new document kinds and rejects unknown ones', () => {
    for (const ownerType of ['quotation', 'delivery']) {
      raw.prepare("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES(?,?,?,'generated_pdf','x.pdf','/x','abc',?)").run(`att-${ownerType}`, ownerType, `${ownerType}-1`, T);
      raw.prepare("INSERT INTO signature_captures(id,owner_type,owner_id,role,signer_name,png_data_url,created_at) VALUES(?,?,?,'customer','Cust','data:image/png;base64,AA',?)").run(`cap-${ownerType}`, ownerType, `${ownerType}-1`, T);
      raw.prepare("INSERT INTO signature_drafts(owner_type,owner_id,role,signer_name,png_data_url,updated_at) VALUES(?,?,'customer','Cust','data:image/png;base64,AA',?)").run(ownerType, `${ownerType}-1`, T);
    }
    expect(() => raw.prepare("INSERT INTO document_attachments(id,owner_type,owner_id,attachment_type,deterministic_filename,private_path,checksum,created_at) VALUES('bad','bogus','x','generated_pdf','x.pdf','/x','abc',?)").run(T)).toThrow(/CHECK/);
    expect(() => raw.prepare("INSERT INTO sequences(name,high_water_mark) VALUES('XX',0)").run()).toThrow(/CHECK/);
  });

  it('allows one live Billing Statement per delivery and never both a CSR and a delivery link', () => {
    raw.prepare("INSERT INTO deliveries(id,customer_id,business_date,created_at) VALUES('delivery','customer','2026-09-02',?)").run(T);
    const insert = (id: string, state: string) => raw.prepare("INSERT INTO billing_statements(id,customer_id,business_date,source_delivery_id,document_state,created_at) VALUES(?,'customer','2026-09-02','delivery',?,?)").run(id, state, T);
    insert('bs-a', 'draft');
    expect(() => insert('bs-b', 'draft')).toThrow(/UNIQUE/);
    raw.prepare("UPDATE billing_statements SET document_state='voided' WHERE id='bs-a'").run();
    expect(() => insert('bs-c', 'draft')).not.toThrow();
    expect(() => raw.prepare("INSERT INTO billing_statements(id,customer_id,business_date,service_report_id,source_delivery_id,created_at) VALUES('bs-d','customer','2026-09-02','csr','delivery',?)").run(T)).toThrow(/BILLING_STATEMENT_SINGLE_SOURCE/);
  });

  it('allows one billing line per delivery line and one stock sale per delivery line', () => {
    raw.prepare("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,created_at,updated_at) VALUES('item','Filter','pc',1000,?,?)").run(T, T);
    raw.prepare("INSERT INTO deliveries(id,customer_id,business_date,created_at) VALUES('delivery','customer','2026-09-02',?)").run(T);
    raw.prepare("INSERT INTO delivery_lines(id,delivery_id,item_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES('dl','delivery','item','Filter',2,1000,2000,'base',?)").run(T);
    expect(() => raw.prepare("INSERT INTO delivery_lines(id,delivery_id,item_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES('dl2','delivery','item','Filter',1,1000,1000,'base',?)").run(T)).toThrow(/UNIQUE/);
    const line = (id: string) => raw.prepare("INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,item_id,source_delivery_line_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES(?,'bs-old','item','item','dl','Filter',2,1000,2000,'base',?)").run(id, T);
    line('bl-1');
    expect(() => line('bl-2')).toThrow(/UNIQUE/);
  });
});
