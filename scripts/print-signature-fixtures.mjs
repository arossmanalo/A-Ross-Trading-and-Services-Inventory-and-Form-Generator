import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const runtimeRequire = createRequire(process.env.AROSS_RUNTIME_PACKAGE_JSON || import.meta.url);
const { chromium } = runtimeRequire('playwright');
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  for (const kind of ['csr','billing','payment']) {
    const page = await browser.newPage();
    await page.setContent(readFileSync(`tmp/pdfs/${kind}-signed.html`,'utf8'));
    await page.pdf({path:`tmp/pdfs/${kind}-signed.pdf`,preferCSSPageSize:true,printBackground:true});
    await page.close();
  }
} finally {await browser.close();}
