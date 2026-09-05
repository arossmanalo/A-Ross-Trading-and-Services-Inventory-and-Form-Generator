/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_V1 } from '@/db/schema';
import { financialReportCsv, getFinancialReport, validateReportFilter } from '@/features/reports/financial-report';

describe('financial reports',()=>{
  let raw:DatabaseSync;let db:SQLiteDatabase;
  const filter={from:'2026-09-01',to:'2026-09-30'};
  beforeEach(()=>{
    raw=new DatabaseSync(':memory:');raw.exec(SCHEMA_V1);
    db={getFirstAsync:async(sql:string,...params:Array<string|number|null>)=>raw.prepare(sql).get(...params)} as unknown as SQLiteDatabase;
    raw.exec(`INSERT INTO customers(id,name,created_at,updated_at) VALUES('a','A','now','now'),('b','B','now','now');`);
    const statement=raw.prepare(`INSERT INTO billing_statements(id,customer_id,business_date,document_state,subtotal_centavos,discounted_total_centavos,created_at) VALUES(?,?,?,?,?,?,'now')`);
    statement.run('sale','a','2026-09-01','finalized',10000,9000);
    statement.run('old','a','2026-08-01','finalized',5000,5000);
    statement.run('other','b','2026-09-30','finalized',2000,2000);
    statement.run('draft','a','2026-09-01','draft',99999,99999);
    statement.run('void','a','2026-09-01','voided',99999,99999);
    const payment=raw.prepare(`INSERT INTO payments(id,billing_statement_id,amount_centavos,business_date,method,state,created_at,finalized_at) VALUES(?,?,?,?,'cash',?,'now','now')`);
    payment.run('down','sale',3000,'2026-09-02','active');
    payment.run('balance','sale',6000,'2026-10-01','active');
    payment.run('old-paid','old',5000,'2026-09-03','active');
    payment.run('void-paid','sale',1000,'2026-09-03','voided');
    const expense=raw.prepare(`INSERT INTO expenses(id,customer_id,billing_statement_id,description,business_date,actual_cost_centavos,billable,created_at) VALUES(?,'a',?,'Expense','2026-08-31',?,?,'now')`);
    expense.run('cost1','sale',7000,1);expense.run('cost2','sale',6000,0);
    expense.run('cost3','draft',99999,0);expense.run('cost4','void',99999,1);
  });
  afterEach(()=>raw.close());
  it('keeps period collections distinct from sales and includes both expense types without multiplying joins',async()=>{
    expect(await getFinancialReport(db,filter)).toEqual({statementCount:2,grossSales:12000,discounts:1000,netCharges:11000,collections:8000,outstanding:2000,expenses:13000,netAfterExpenses:-2000});
  });
  it('filters customers and returns zeroes for an empty period',async()=>{
    expect((await getFinancialReport(db,{...filter,customerId:'b'})).collections).toBe(0);
    expect((await getFinancialReport(db,{...filter,customerId:'a'})).outstanding).toBe(0);
    expect(Object.values(await getFinancialReport(db,{from:'2025-01-01',to:'2025-12-31'}))).toEqual(Array(8).fill(0));
  });
  it('rejects impossible dates and reversed ranges',()=>{
    expect(()=>validateReportFilter({from:'2026-02-30',to:'2026-03-01'})).toThrow(/valid dates/);
    expect(()=>validateReportFilter({from:'2026-09-02',to:'2026-09-01'})).toThrow(/Start date/);
  });
  it('exports the actual calculated amounts and escapes customer names for spreadsheets',async()=>{
    const csv=financialReportCsv(await getFinancialReport(db,filter),filter,'=HYPERLINK("bad")');
    expect(csv).toContain('"Net Revenue After Recorded Expenses","-20.00"');
    expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
    expect(csv).toContain('Payment business dates');
  });
});
