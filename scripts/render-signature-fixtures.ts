import { readFileSync, writeFileSync } from 'node:fs';
import { appendSigningPage, signatureBlock } from '../src/features/signatures/signature-html.ts';

const data = readFileSync('tmp/pdfs/test-signature-data.txt','utf8');
const sample = {signerName:'TEST MARK - NOT A REAL SIGNATURE',pngDataUrl:data,createdAt:'2026-09-05T06:00:00.000Z'};
for (const [kind,number] of [['csr','CSR-000042'],['billing','BS-000042'],['payment','PA-000042']]) {
  const source = readFileSync(`tmp/pdfs/${kind}-fixture.html`,'utf8');
  const prepared = source.replace('<footer class="footer">',`${signatureBlock(sample,'Prepared by - QA fixture')}<footer class="footer">`);
  const html = kind === 'payment' ? prepared : appendSigningPage(prepared,[signatureBlock(sample,'Customer - QA fixture')],number,'TEST-FINGERPRINT','TEST-VERSION');
  writeFileSync(`tmp/pdfs/${kind}-signed.html`,html);
}
