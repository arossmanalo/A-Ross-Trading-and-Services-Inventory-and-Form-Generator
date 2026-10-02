// Desktop print QA only. Android Expo Print still needs a device acceptance check.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';

const localRequire = createRequire(import.meta.url);
const runtimeRequire = createRequire(process.env.AROSS_RUNTIME_PACKAGE_JSON || import.meta.url);
const { chromium } = runtimeRequire('playwright');
const ts = localRequire('typescript');
const loaded = new Map();
// Compile pure template modules with the same @/ mapping used by TypeScript/Metro.
function loadTemplate(path) {
  const absolute = resolve(path);
  if (loaded.has(absolute)) return loaded.get(absolute).exports;
  const module = { exports: {} };
  loaded.set(absolute, module);
  const code = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (specifier) => specifier.startsWith('@/')
    ? loadTemplate(resolve('src', `${specifier.slice(2)}.ts`))
    : specifier.startsWith('.') ? loadTemplate(resolve(dirname(absolute), `${specifier}.ts`)) : localRequire(specifier);
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  return module.exports;
}

const { buildCsrHtml } = loadTemplate('src/features/service-reports/csr-template.ts');
const { buildBillingStatementHtml } = loadTemplate('src/features/billing-statements/billing-statement-template.ts');
const { signatureBlock, applySignatureCapturesToDocument } = loadTemplate('src/features/signatures/signature-html.ts');
const { withDocumentHeaderLayout } = loadTemplate('src/features/documents/document-header.ts');
const business = { name: 'A Ross Trading And Services', address: 'Pagasa Street\nPahinga Norte\nCandelaria, Quezon', contactDetails: 'owner@example.com\n0917 5794065\n0920 2970054' };
const customer = { name: 'QA Laundry - synthetic fixture', address: 'Quezon' };
const csr = { csrNumber: 'CSR-QA', businessDate: '2026-10-02', fingerprint: 'QA-ONLY', business, customer,
  equipment: { machineType: 'Washer', model: 'QA', serialNumber: '', nicknameOrLocation: '' },
  serviceOutcome: 'completed', reportedProblem: ['Inspection requested'], diagnosis: ['Replacement needed'], actionTaken: ['Replaced part'], recommendations: ['Monitor equipment'], billing: [], customerRemarks: [], machineStatus: 'Operational', warrantyText: 'Owner terms', servicedBy: 'TEST OWNER', acknowledgedBy: 'TEST CUSTOMER', totalBillCentavos: 290000,
  usages: [{ description: 'Detergent', quantity: 2, unitLabel: 'carboy', billable: true }], services: [{ description: 'Labor', rateCentavos: 50000 }] };
const billing = { bsNumber: 'BS-QA', businessDate: csr.businessDate, fingerprint: csr.fingerprint, business, customer, serviceReportNumber: csr.csrNumber,
  lines: [{ description: 'Detergent', quantity: 2, unitLabel: 'carboy', unitPriceCentavos: 120000, amountCentavos: 240000 }, { description: 'Labor', quantity: 1, unitLabel: 'service', unitPriceCentavos: 50000, amountCentavos: 50000 }], subtotalCentavos: 290000, discountLabel: null, discountCentavos: 0, totalCentavos: 290000, paymentsReceivedCentavos: 0, balanceDueCentavos: 290000, vatDisplayMode: 'disabled', vatRateBasisPoints: 0 };

mkdirSync('tmp/pdfs', { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const markPage = await browser.newPage();
  // Artificial QA zigzag, not a real signature.
  const png = await markPage.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 180;
    const ctx = canvas.getContext('2d'); ctx.strokeStyle = '#0b377f'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(30,130); ctx.lineTo(120,35); ctx.lineTo(200,120); ctx.lineTo(350,50); ctx.lineTo(550,110); ctx.stroke();
    return canvas.toDataURL('image/png');
  });
  await markPage.close();
  const marks = ['preparer', 'customer'].map(role => signatureBlock({ signerName: `TEST ${role.toUpperCase()}`, pngDataUrl: png, createdAt: '2026-10-02T00:00:00Z' }, role === 'preparer' ? 'Preparer' : 'Customer'));
  const fixtures = [
    ['csr-short', buildCsrHtml(csr)],
    ['billing-short', buildBillingStatementHtml(billing)],
    ['csr-long', buildCsrHtml({ ...csr, reportedProblem: Array.from({length:60},(_,i)=>`QA inspection note ${i+1} - long document pagination check`) })],
    ['billing-long', buildBillingStatementHtml({ ...billing, lines: Array.from({length:70},(_,i)=>({...billing.lines[0],description:`QA item ${i+1}`})),subtotalCentavos:16800000,totalCentavos:16800000,balanceDueCentavos:16800000 })],
  ];
  for (const [name, original] of fixtures) {
    const page = await browser.newPage({ viewport: { width: name.startsWith('csr') ? 750 : 680, height: 1000 } });
    await page.setContent(withDocumentHeaderLayout(applySignatureCapturesToDocument(original, marks)));
    await page.locator('.header img').evaluate(img => img.decode());
    const header = await page.locator('.header').boundingBox();
    const logo = await page.locator('.mark').boundingBox();
    const identity = await page.locator('.business-block').boundingBox();
    assert.ok(header && logo && identity && logo.x + logo.width <= identity.x);
    assert.equal(await page.locator('.contact').innerText(), `${business.address}\n0917 5794065\n0920 2970054\nowner@example.com`);
    assert.equal(await page.locator('.signature-image').count(), 2);
    await page.pdf({ path: `tmp/pdfs/${name}-signed.pdf`, preferCSSPageSize: true, printBackground: true });
    await page.close();
  }
  // Exercise narrow WebView layout and historical Billing Statement markup too.
  const current = buildBillingStatementHtml(billing);
  const legacyHeader = '<header class="header"><div class="mark"><img src="' + loadTemplate('src/features/settings/default-business-logo.ts').DEFAULT_BUSINESS_LOGO_DATA_URL + '" style="width:100%;height:100%;object-fit:contain"/></div><div class="business"><div class="business-name">Saved Company</div><div class="muted">Saved address\nowner@example.com\n0917\n0920</div></div></header>';
  const legacy = current.replace(/<header[\s\S]*?<\/header>/, legacyHeader).replace('</head>', '<style>.business{width:250px}.mark{width:92px;height:54px}</style></head>');
  for (const [name, html] of [['billing',current],['csr',buildCsrHtml(csr)],['legacy-billing',legacy]]) {
    for (const width of [360,800]) {
      const page = await browser.newPage({viewport:{width,height:1000}});
      await page.setContent(withDocumentHeaderLayout(html));
      await page.locator('.header img').evaluate(img => img.decode());
      const mark = await page.locator('.mark').boundingBox();
      const businessBox = await page.locator('.business-block').boundingBox();
      assert.ok(mark && businessBox && mark.x + mark.width <= businessBox.x && businessBox.x + businessBox.width <= width);
      if (name === 'legacy-billing') assert.equal(await page.locator('.contact').innerText(),'Saved address\n0917\n0920\nowner@example.com');
      await page.screenshot({path:`tmp/pdfs/${name}-${width}-preview.png`,fullPage:true});
      await page.close();
    }
  }
  console.log('Print QA passed: shared/legacy headers at phone/tablet widths, contacts, inline signatures; four PDFs generated for visual inspection.');
} finally { await browser.close(); }
