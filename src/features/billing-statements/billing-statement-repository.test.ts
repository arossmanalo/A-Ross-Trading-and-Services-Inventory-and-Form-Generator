/// <reference types="node" />

import { DatabaseSync } from 'node:sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8 } from '@/db/schema';

let idCounter=0;
vi.mock('expo-crypto',()=>({randomUUID:()=>`test-id-${++idCounter}`,CryptoDigestAlgorithm:{SHA256:'SHA-256'},digestStringAsync:async()=> 'ABCDEF1234567890'}));
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-09-05T12:00:00.000Z') }));
afterEach(() => vi.useRealTimers());

import { addCsrUsageLine, addDirectItemLine, addServiceLine, addStatementExpense, createBillingStatementDraft, finalizeBillingStatement, getBillingStatement, listCsrsForBilling, removeBillingLine, updateBillingStatementDraft, voidBillingStatement } from './billing-statement-repository';
import { createLaterPayment, listPaymentsForStatement, voidPayment } from '@/features/payments/payment-repository';
import { addReportItemUsage, addReportServiceUsage, createServiceReportDraft, deleteServiceReportDraft, finalizeServiceReport, getServiceReport, removeReportItemUsage } from '@/features/service-reports/service-report-repository';

type Params=Array<string|number|null>;
function adapter(database:DatabaseSync):SQLiteDatabase {
  const api={
    getFirstAsync:async<T>(sql:string,...params:Params)=>database.prepare(sql).get(...params) as T|undefined,
    getAllAsync:async<T>(sql:string,...params:Params)=>database.prepare(sql).all(...params) as T[],
    runAsync:async(sql:string,...params:Params)=>{const result=database.prepare(sql).run(...params);return{changes:Number(result.changes),lastInsertRowId:Number(result.lastInsertRowid)};},
    withExclusiveTransactionAsync:async<T>(task:(tx:SQLiteDatabase)=>Promise<T>)=>{database.exec('BEGIN IMMEDIATE');try{const result=await task(api as unknown as SQLiteDatabase);database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}},
  };
  return api as unknown as SQLiteDatabase;
}

describe('billing statement repository',()=>{let raw:DatabaseSync;let db:SQLiteDatabase;beforeEach(()=>{idCounter=0;raw=new DatabaseSync(':memory:');raw.exec(`PRAGMA foreign_keys=ON;${SCHEMA_V1}${SCHEMA_V2}${SCHEMA_V3}${SCHEMA_V4}${SCHEMA_V5}${SCHEMA_V6}${SCHEMA_V7}${SCHEMA_V8}`);const now='2026-09-05T00:00:00.000Z';raw.prepare("INSERT INTO app_meta(key,value) VALUES('database_revision','0')").run();raw.exec("INSERT INTO sequences(name,high_water_mark) VALUES('CSR',1),('BS',0),('PA',0)");raw.prepare(`INSERT INTO settings(id,business_name,business_address,contact_details,owner_name,created_at,updated_at) VALUES('business','A.Ross','Quezon','0917','Owner',?,?)`).run(now,now);raw.prepare(`INSERT INTO customers(id,name,address,active,created_at,updated_at) VALUES('customer','Laundry','Sariaya',1,?,?)`).run(now,now);raw.prepare(`INSERT INTO items(id,name,unit_label,base_selling_price_centavos,active,created_at,updated_at) VALUES('item','Detergent','carboy',120000,1,?,?)`).run(now,now);raw.prepare(`INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('opening','item','restock',10,'Opening',?)`).run(now);raw.prepare(`INSERT INTO services(id,name,base_rate_centavos,active,created_at,updated_at) VALUES('service','Labor',50000,1,?,?)`).run(now,now);db=adapter(raw);});afterEach(()=>raw.close());

  async function draftPair() {
    raw.exec("INSERT INTO customer_equipment(id,customer_id,machine_type,created_at,updated_at) VALUES('equipment','customer','Washer','now','now')");
    const reportId=await createServiceReportDraft(db,{customerId:'customer',equipmentId:'equipment',businessDate:'2026-09-05'});
    const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05',reuseExistingLinkedDraft:true});
    return {reportId,statementId};
  }

  it('keeps additions from BOTH screens on the CSR, freezes all charges and posts stock only once',async()=>{
    const {reportId,statementId}=await draftPair();
    await addDirectItemLine(db,statementId,{itemId:'item',quantity:2});
    await addReportServiceUsage(db,reportId,'service');
    raw.exec("INSERT INTO services(id,name,base_rate_centavos,created_at,updated_at) VALUES('service-2','Inspection',10000,'now','now')");
    await addServiceLine(db,statementId,{serviceId:'service-2'});
    expect((await getServiceReport(db,reportId))?.totalBillCentavos).toBe(300000);
    expect((await getServiceReport(db,reportId))?.usages).toMatchObject([{itemName:'Detergent',quantity:2}]);
    expect((await getBillingStatement(db,statementId))?.lines).toHaveLength(3);
    await expect(addDirectItemLine(db,statementId,{itemId:'item',quantity:2})).rejects.toThrow(/already listed on the CSR/);
    await expect(addServiceLine(db,statementId,{serviceId:'service'})).rejects.toThrow(/already listed on the CSR/);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:10});
    const finalized=await finalizeServiceReport(db,reportId);
    expect(finalized.snapshot).toMatchObject({totalBillCentavos:300000,usages:[{description:'Detergent',quantity:2}],services:[{description:'Labor'},{description:'Inspection'}]});
    expect(finalized.html).toContain('Detergent');
    expect(finalized.html).toContain('Inspection');
    await expect(addDirectItemLine(db,statementId,{itemId:'item',quantity:2})).rejects.toThrow(/already recorded on the linked CSR/);
    const billed=await finalizeBillingStatement(db,statementId);
    expect(billed.snapshot.totalCentavos).toBe(300000);
    await finalizeBillingStatement(db,statementId);
    await finalizeServiceReport(db,reportId);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:8});
    expect(raw.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE billing_statement_id=?').get(statementId)).toEqual({count:0});
  });

  it('retains explicit item and service overrides added through linked billing on both documents',async()=>{
    const {reportId,statementId}=await draftPair();
    await addDirectItemLine(db,statementId,{itemId:'item',quantity:2,unitPriceCentavos:100000,overrideReason:'Owner rate'});
    await addServiceLine(db,statementId,{serviceId:'service',rateCentavos:25000,overrideReason:'Owner rate'});
    const csr=await finalizeServiceReport(db,reportId);
    expect(csr.snapshot.totalBillCentavos).toBe(225000);
    expect((await finalizeBillingStatement(db,statementId)).snapshot.totalCentavos).toBe(225000);
  });

  it('imports services when the Billing Statement is created after CSR finalization too',async()=>{
    const {reportId,statementId}=await draftPair();
    await addReportServiceUsage(db,reportId,'service');
    // Remove the initial blank statement, then create a statement after the CSR has issued.
    raw.prepare('DELETE FROM billing_statement_lines WHERE billing_statement_id=?').run(statementId);
    raw.prepare('DELETE FROM billing_statements WHERE id=?').run(statementId);
    await finalizeServiceReport(db,reportId);
    expect(await listCsrsForBilling(db,'customer')).toMatchObject([{id:reportId,availableLineCount:1}]);
    const linkedId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05'});
    expect((await getBillingStatement(db,linkedId))?.lines).toMatchObject([{sourceCsrServiceUsageId:expect.any(String),description:'Labor',amountCentavos:50000}]);
    expect((await finalizeBillingStatement(db,linkedId)).snapshot.totalCentavos).toBe(50000);
  });

  it('reattaches a removed finalized CSR service using its frozen source rate instead of a separate charge',async()=>{
    const {reportId,statementId}=await draftPair();
    await addReportServiceUsage(db,reportId,'service');
    await finalizeServiceReport(db,reportId);
    const line=(await getBillingStatement(db,statementId))!.lines[0];
    await removeBillingLine(db,statementId,line.id);
    raw.exec("UPDATE services SET base_rate_centavos=90000 WHERE id='service'");
    await expect(addServiceLine(db,statementId,{serviceId:'service',rateCentavos:90000})).rejects.toThrow(/cannot be repriced/);
    await addServiceLine(db,statementId,{serviceId:'service'});
    expect((await getBillingStatement(db,statementId))?.lines).toMatchObject([{sourceCsrServiceUsageId:line.sourceCsrServiceUsageId,unitPriceCentavos:50000}]);
    await expect(addServiceLine(db,statementId,{serviceId:'service'})).rejects.toThrow(/already been included/);
    expect((await finalizeBillingStatement(db,statementId)).snapshot.totalCentavos).toBe(50000);
  });

  it('keeps non-billable CSR usage on the CSR but out of its bill, and preserves separate additional sales',async()=>{
    const {reportId,statementId}=await draftPair();
    raw.exec("INSERT INTO items(id,name,unit_label,base_selling_price_centavos,created_at,updated_at) VALUES('extra','Spare part','pc',10000,'now','now'); INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('extra-stock','extra','restock',5,'Opening','now')");
    await addReportItemUsage(db,reportId,'item',1,false);
    await addServiceLine(db,statementId,{serviceId:'service'});
    expect((await getBillingStatement(db,statementId))?.lines).toMatchObject([{lineType:'service',amountCentavos:50000}]);
    const csr=await finalizeServiceReport(db,reportId);
    expect(csr.snapshot.usages).toMatchObject([{billable:false,quantity:1}]);
    expect(csr.snapshot.totalBillCentavos).toBe(50000);
    // A different item sold after CSR finalization is a separate statement-only sale.
    await addDirectItemLine(db,statementId,{itemId:'extra',quantity:2});
    expect((await finalizeBillingStatement(db,statementId)).snapshot.totalCentavos).toBe(70000);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:9});
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='extra'").get()).toEqual({stock:3});
    expect((await finalizeServiceReport(db,reportId)).snapshot).toEqual(csr.snapshot);
  });

  it('rechecks current stock and rolls back numbers and snapshots if CSR stock is insufficient',async()=>{
    const {reportId,statementId}=await draftPair();
    await addDirectItemLine(db,statementId,{itemId:'item',quantity:2});
    raw.exec("INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,description,created_at) VALUES('other-consumption','item','nonbillable_usage',-9,'Other job','now')");
    await expect(finalizeServiceReport(db,reportId)).rejects.toThrow(/only 1 available/);
    expect(raw.prepare("SELECT csr_number,document_state,content_snapshot_json FROM service_reports WHERE id=?").get(reportId)).toEqual({csr_number:null,document_state:'draft',content_snapshot_json:null});
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='CSR'").get()).toEqual({high_water_mark:1});
    await expect(finalizeBillingStatement(db,statementId)).rejects.toThrow(/Finalize the linked CSR/);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE service_report_id=? OR billing_statement_id=?').get(reportId,statementId)).toEqual({count:0});
  });

  it('rolls back CSR insertion if synchronizing its linked bill would fail',async()=>{
    const {reportId,statementId}=await draftPair();
    raw.exec("CREATE TRIGGER simulate_sync_failure BEFORE INSERT ON billing_statement_lines BEGIN SELECT RAISE(ABORT,'Simulated sync failure'); END");
    await expect(addDirectItemLine(db,statementId,{itemId:'item',quantity:1})).rejects.toThrow(/Simulated sync failure/);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM service_report_item_usage WHERE service_report_id=?').get(reportId)).toEqual({count:0});
    expect((await getServiceReport(db,reportId))?.totalBillCentavos).toBe(0);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:10});
  });

  it('blocks legacy billing-only draft charges before freezing an incomplete CSR',async()=>{
    const {reportId,statementId}=await draftPair();
    raw.prepare(`INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,item_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES('legacy',?,'item','item','Detergent',2,120000,240000,'base','now')`).run(statementId);
    await expect(finalizeServiceReport(db,reportId)).rejects.toThrow(/Remove its separate charge/);
    expect(raw.prepare('SELECT document_state FROM service_reports WHERE id=?').get(reportId)).toEqual({document_state:'draft'});
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='CSR'").get()).toEqual({high_water_mark:1});
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:10});
    await removeBillingLine(db,statementId,'legacy');
    await addDirectItemLine(db,statementId,{itemId:'item',quantity:2});
    expect((await finalizeServiceReport(db,reportId)).snapshot.usages).toHaveLength(1);
    await finalizeBillingStatement(db,statementId);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:8});
  });

  it('blocks legacy duplicate direct charges and mismatched source quantities without posting stock or a number',async()=>{
    const {reportId,statementId}=await draftPair();
    await addReportItemUsage(db,reportId,'item',2,true);
    await finalizeServiceReport(db,reportId);
    raw.prepare(`INSERT INTO billing_statement_lines(id,billing_statement_id,line_type,item_id,description_snapshot,quantity_integer,unit_price_centavos,amount_centavos,price_source,created_at) VALUES('duplicate',?,'item','item','Detergent',2,120000,240000,'base','now')`).run(statementId);
    await expect(finalizeBillingStatement(db,statementId)).rejects.toThrow(/already recorded on the linked CSR/);
    await removeBillingLine(db,statementId,'duplicate');
    raw.prepare('UPDATE billing_statement_lines SET quantity_integer=3,amount_centavos=360000 WHERE billing_statement_id=?').run(statementId);
    await expect(finalizeBillingStatement(db,statementId)).rejects.toThrow(/does not match/);
    expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='BS'").get()).toEqual({high_water_mark:0});
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:8});
  });

  it('finalizes mixed charges atomically and reverses returned direct stock on void',async()=>{const statementId=await createBillingStatementDraft(db,{customerId:'customer',businessDate:'2026-09-05'});await addDirectItemLine(db,statementId,{itemId:'item',quantity:2});await addServiceLine(db,statementId,{serviceId:'service'});await addStatementExpense(db,statementId,{description:'Parking',actualCostCentavos:10000,billable:true,billedAmountCentavos:15000});await addStatementExpense(db,statementId,{description:'Meals',actualCostCentavos:8000,billable:false});await updateBillingStatementDraft(db,statementId,{businessDate:'2026-09-05',discountType:'percentage',discountValue:1000});const finalized=await finalizeBillingStatement(db,statementId);expect(finalized.bsNumber).toBe('BS-000001');expect(finalized.snapshot.subtotalCentavos).toBe(305000);expect(finalized.snapshot.totalCentavos).toBe(274500);expect((raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get() as {stock:number}).stock).toBe(8);await expect(finalizeBillingStatement(db,statementId)).resolves.toMatchObject({bsNumber:'BS-000001'});expect((raw.prepare("SELECT COUNT(*) AS count FROM stock_transactions WHERE billing_statement_id=? AND transaction_type='sale'").get(statementId) as {count:number}).count).toBe(1);await voidBillingStatement(db,statementId,'Incorrect customer',[{itemId:'item',returnedToStock:true}]);expect((raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get() as {stock:number}).stock).toBe(10);});

  it('bills a CSR item without deducting its already-posted stock again',async()=>{const now='2026-09-05T00:00:00.000Z';raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);raw.prepare(`INSERT INTO service_reports(id,csr_number,customer_id,equipment_id,document_state,service_outcome,business_date,created_at,finalized_at) VALUES('csr','CSR-000001','customer','equipment','finalized','completed','2026-09-05',?,?)`).run(now,now);raw.prepare(`INSERT INTO service_report_item_usage(id,service_report_id,item_id,quantity_integer,billable,resolved_selling_price_centavos,price_source,description_snapshot,created_at) VALUES('usage','csr','item',1,1,120000,'base','Detergent',?)`).run(now);raw.prepare(`INSERT INTO inventory_movements(id,item_id,movement_type,quantity_delta_integer,service_report_id,description,created_at) VALUES('csr-use','item','sale',-1,'csr','CSR use',?)`).run(now);const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:'csr',businessDate:'2026-09-05'});const imported=(await getBillingStatement(db,statementId))!.lines[0];expect(imported.sourceCsrUsageId).toBe('usage');await removeBillingLine(db,statementId,imported.id);await addCsrUsageLine(db,statementId,'usage');await finalizeBillingStatement(db,statementId);expect((raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get() as {stock:number}).stock).toBe(9);expect((raw.prepare("SELECT COUNT(*) AS count FROM stock_transactions WHERE billing_statement_id=? AND transaction_type='sale'").get(statementId) as {count:number}).count).toBe(0);});

  it('allows starting a linked Billing Statement from a CSR draft but blocks premature finalization',async()=>{const now='2026-09-05T00:00:00.000Z';raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);raw.prepare(`INSERT INTO service_reports(id,customer_id,equipment_id,document_state,service_outcome,business_date,created_at) VALUES('draft-csr','customer','equipment','draft','incomplete','2026-09-05',?)`).run(now);expect(await listCsrsForBilling(db,'customer')).toMatchObject([{id:'draft-csr',documentState:'draft',availableLineCount:0}]);const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:'draft-csr',businessDate:'2026-09-05'});await addServiceLine(db,statementId,{serviceId:'service'});await expect(finalizeBillingStatement(db,statementId)).rejects.toThrow(/Finalize the linked CSR/);expect((raw.prepare("SELECT high_water_mark FROM sequences WHERE name='BS'").get() as {high_water_mark:number}).high_water_mark).toBe(0);});

  it('finalizes a CSR after its billable items and service are linked to a statement draft',async()=>{
    const now='2026-09-05T00:00:00.000Z';
    raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);
    const reportId=await createServiceReportDraft(db,{customerId:'customer',equipmentId:'equipment',businessDate:'2026-09-05'});
    await addReportItemUsage(db,reportId,'item',2,true);
    await addReportServiceUsage(db,reportId,'service');
    const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05'});

    const finalized=await finalizeServiceReport(db,reportId);

    expect(finalized.csrNumber).toBe('CSR-000002');
    expect(raw.prepare('SELECT document_state FROM service_reports WHERE id=?').get(reportId)).toEqual({document_state:'finalized'});
    expect((raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get() as {stock:number}).stock).toBe(8);
    expect((await getBillingStatement(db,statementId))?.lines).toHaveLength(2);
    expect(finalized.snapshot.usages).toEqual([{description:'Detergent',quantity:2,unitLabel:'carboy',billable:true}]);
    expect(finalized.snapshot.services).toEqual([{description:'Labor',rateCentavos:50000}]);
    expect(finalized.snapshot.totalBillCentavos).toBe(290000);
    expect(finalized.html).toContain('Items Used');
    expect(finalized.html).toContain('Services Used');
    expect(finalized.html).toContain('₱2,900.00');
    const statement = await finalizeBillingStatement(db,statementId);
    expect(statement.snapshot.totalCentavos).toBe(290000);
    await finalizeServiceReport(db,reportId);
    await finalizeBillingStatement(db,statementId);
    expect(raw.prepare("SELECT SUM(quantity_delta_integer) AS stock FROM inventory_movements WHERE item_id='item'").get()).toEqual({stock:8});
    expect(raw.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE service_report_id=?').get(reportId)).toEqual({count:1});
    expect(raw.prepare('SELECT COUNT(*) AS count FROM inventory_movements WHERE billing_statement_id=?').get(statementId)).toEqual({count:0});
  });

  it('reopens the populated linked draft on repeat and recovers from an older blank duplicate',async()=>{
    const now='2026-09-05T12:00:00.000Z';
    raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);
    const reportId=await createServiceReportDraft(db,{customerId:'customer',equipmentId:'equipment',businessDate:'2026-09-05'});
    await addReportItemUsage(db,reportId,'item',2,true);
    await addReportServiceUsage(db,reportId,'service');
    const itemUsageId=(raw.prepare('SELECT id FROM service_report_item_usage WHERE service_report_id=?').get(reportId) as {id:string}).id;
    const serviceUsageId=(raw.prepare('SELECT id FROM service_report_service_usage WHERE service_report_id=?').get(reportId) as {id:string}).id;
    expect(await listCsrsForBilling(db,'customer')).toMatchObject([{id:reportId,availableLineCount:2}]);

    const populatedDraftId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05'});
    const populatedDraft=await getBillingStatement(db,populatedDraftId);
    expect(populatedDraft?.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({lineType:'item',sourceCsrUsageId:itemUsageId,description:'Detergent',quantity:2,amountCentavos:240000}),
      expect.objectContaining({lineType:'service',sourceCsrServiceUsageId:serviceUsageId,description:'Labor',quantity:1,amountCentavos:50000}),
    ]));
    expect(populatedDraft?.subtotalCentavos).toBe(290000);

    // Simulate the blank duplicate made by the old repeat-tap behavior.
    const oldBlankDuplicateId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05'});
    expect((await getBillingStatement(db,oldBlankDuplicateId))?.lines).toHaveLength(0);

    // The CSR screen's action must reopen the statement holding its lines, not create another one.
    const reopenedId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05',reuseExistingLinkedDraft:true});
    const repeatedReopenId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05',reuseExistingLinkedDraft:true});
    expect(reopenedId).toBe(populatedDraftId);
    expect(repeatedReopenId).toBe(populatedDraftId);
    expect((await getBillingStatement(db,reopenedId))?.lines).toHaveLength(2);
    expect(raw.prepare("SELECT COUNT(*) AS count FROM billing_statements WHERE service_report_id=? AND document_state='draft'").get(reportId)).toEqual({count:2});

    await expect(finalizeBillingStatement(db,reopenedId)).rejects.toThrow(/Finalize the linked CSR/);
    await finalizeServiceReport(db,reportId);
    raw.prepare(`UPDATE services SET base_rate_centavos=90000 WHERE id='service'`).run();
    const finalized=await finalizeBillingStatement(db,reopenedId);
    expect(finalized.snapshot.subtotalCentavos).toBe(290000);
    expect(finalized.snapshot.lines.map(line=>line.unitPriceCentavos)).toEqual([120000,50000]);
    expect((raw.prepare(`SELECT COUNT(*) AS count FROM stock_transactions WHERE billing_statement_id=?`).get(reopenedId) as {count:number}).count).toBe(0);
  });

  it('deletes linked unnumbered Billing Statement drafts when deleting a CSR draft',async()=>{const now='2026-09-05T12:00:00.000Z';raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);const reportId=await createServiceReportDraft(db,{customerId:'customer',equipmentId:'equipment',businessDate:'2026-09-05'});await addReportItemUsage(db,reportId,'item',1,true);const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05'});expect((await getBillingStatement(db,statementId))?.lines).toHaveLength(1);await deleteServiceReportDraft(db,reportId);expect(raw.prepare('SELECT id FROM service_reports WHERE id=?').get(reportId)).toBeUndefined();expect(raw.prepare('SELECT id FROM billing_statements WHERE id=?').get(statementId)).toBeUndefined();expect(raw.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE entity_id IN (?,?) AND event_type IN (\'csr.draft_deleted\',\'billing_statement.draft_deleted\')').get(reportId,statementId)).toEqual({count:2});expect(raw.prepare("SELECT high_water_mark FROM sequences WHERE name='BS'").get()).toEqual({high_water_mark:0});});

  it('does not cascade-delete a linked non-draft Billing Statement',async()=>{const now='2026-09-05T12:00:00.000Z';raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);const reportId=await createServiceReportDraft(db,{customerId:'customer',equipmentId:'equipment',businessDate:'2026-09-05'});const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:reportId,businessDate:'2026-09-05'});raw.prepare(`UPDATE billing_statements SET document_state='finalized' WHERE id=?`).run(statementId);await expect(deleteServiceReportDraft(db,reportId)).rejects.toThrow(/non-draft Billing Statement/);expect(raw.prepare('SELECT document_state FROM service_reports WHERE id=?').get(reportId)).toEqual({document_state:'draft'});expect(raw.prepare('SELECT document_state FROM billing_statements WHERE id=?').get(statementId)).toEqual({document_state:'finalized'});});

  it('keeps linked Billing Statement draft charges synchronized as CSR item and service usage changes',async()=>{const now='2026-09-05T00:00:00.000Z';raw.prepare(`INSERT INTO customer_equipment(id,customer_id,machine_type,active,created_at,updated_at) VALUES('equipment','customer','Washer',1,?,?)`).run(now,now);raw.prepare(`INSERT INTO service_reports(id,customer_id,equipment_id,document_state,service_outcome,business_date,created_at) VALUES('live-csr','customer','equipment','draft','incomplete','2026-09-05',?)`).run(now);const statementId=await createBillingStatementDraft(db,{customerId:'customer',serviceReportId:'live-csr',businessDate:'2026-09-05'});const itemUsageId=await addReportItemUsage(db,'live-csr','item',1,true);const serviceUsageId=await addReportServiceUsage(db,'live-csr','service');expect((await getBillingStatement(db,statementId))?.lines).toHaveLength(2);await removeReportItemUsage(db,'live-csr',itemUsageId);expect((await getBillingStatement(db,statementId))?.lines).toEqual([expect.objectContaining({sourceCsrServiceUsageId:serviceUsageId})]);});

  it('enforces one down payment followed by the exact remaining balance',async()=>{const statementId=await createBillingStatementDraft(db,{customerId:'customer',businessDate:'2026-09-05'});await addServiceLine(db,statementId,{serviceId:'service'});const initial=await finalizeBillingStatement(db,statementId,'reject',{choice:'down_payment',payment:{amountCentavos:20000,businessDate:'2026-09-05',method:'cash'}});expect(initial.initialPayment?.paNumber).toBe('PA-000001');await expect(createLaterPayment(db,statementId,{amountCentavos:20000,businessDate:'2026-09-05',method:'cash'})).rejects.toThrow(/full remaining balance/);const balance=await createLaterPayment(db,statementId,{amountCentavos:30000,businessDate:'2026-09-05',method:'e_wallet',referenceNumber:'GCASH-1'});expect(balance.paNumber).toBe('PA-000002');expect((await listPaymentsForStatement(db,statementId)).status).toBe('paid');await expect(voidPayment(db,initial.initialPayment!.paymentId,'Wrong amount')).rejects.toThrow(/remaining-balance payment/);await voidPayment(db,balance.paymentId,'Wrong reference');expect((await listPaymentsForStatement(db,statementId)).status).toBe('balance_due');});

  it('requires a single exact pay-later payment and a non-cash reference',async()=>{const statementId=await createBillingStatementDraft(db,{customerId:'customer',businessDate:'2026-09-05'});await addServiceLine(db,statementId,{serviceId:'service'});await finalizeBillingStatement(db,statementId);await expect(createLaterPayment(db,statementId,{amountCentavos:60000,businessDate:'2026-09-05',method:'cash'})).rejects.toThrow(/full remaining balance/);await expect(createLaterPayment(db,statementId,{amountCentavos:50000,businessDate:'2026-09-05',method:'bank_transfer'})).rejects.toThrow(/reference/);const input={idempotencyKey:'payment-request-1',amountCentavos:50000,businessDate:'2026-09-05',method:'bank_transfer' as const,referenceNumber:'BANK-1'};const payment=await createLaterPayment(db,statementId,input);const retry=await createLaterPayment(db,statementId,input);expect(retry.paymentId).toBe(payment.paymentId);expect(payment.snapshot.remainingBalanceCentavos).toBe(0);expect((raw.prepare("SELECT high_water_mark FROM sequences WHERE name='PA'").get() as {high_water_mark:number}).high_water_mark).toBe(1);expect((await listPaymentsForStatement(db,statementId)).status).toBe('paid');await expect(createLaterPayment(db,statementId,{amountCentavos:1,businessDate:'2026-09-05',method:'cash'})).rejects.toThrow(/no remaining balance/);});

  it('rolls back statement and number allocation when an initial full payment is invalid',async()=>{const statementId=await createBillingStatementDraft(db,{customerId:'customer',businessDate:'2026-09-05'});await addServiceLine(db,statementId,{serviceId:'service'});await expect(finalizeBillingStatement(db,statementId,'reject',{choice:'paid_in_full',payment:{amountCentavos:49999,businessDate:'2026-09-05',method:'cash'}})).rejects.toThrow(/must equal/);expect((raw.prepare("SELECT document_state FROM billing_statements WHERE id=?").get(statementId) as {document_state:string}).document_state).toBe('draft');expect((raw.prepare("SELECT high_water_mark FROM sequences WHERE name='BS'").get() as {high_water_mark:number}).high_water_mark).toBe(0);const result=await finalizeBillingStatement(db,statementId,'reject',{choice:'paid_in_full',payment:{amountCentavos:50000,businessDate:'2026-09-05',method:'cash'}});expect(result.bsNumber).toBe('BS-000001');expect(result.initialPayment?.paNumber).toBe('PA-000001');});
});
