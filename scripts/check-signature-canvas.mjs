// Desktop smoke test only; the Android WebView still requires device testing.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const runtimeRequire = createRequire(process.env.AROSS_RUNTIME_PACKAGE_JSON || import.meta.url);
const { chromium } = runtimeRequire('playwright');
const source = readFileSync('src/features/signatures/signature-pad.tsx','utf8');
const html = source.match(/export const SIGNATURE_PAD_HTML = `([\s\S]*?)`;/)[1];
const repository = readFileSync('src/features/signatures/signature-draft-repository.ts','utf8');
const documentScript = repository.match(/const script = `([\s\S]*?)`;/)[1];
const documentStyle = repository.match(/const styles = `([\s\S]*?)`;/)[1];
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
  const context = await browser.newContext({viewport:{width:600,height:300},offline:true});
  const page = await context.newPage();
  const requests=[];page.on('request',request=>requests.push(request.url()));
  await page.setContent(html);
  await page.evaluate(()=>{window.messages=[];window.ReactNativeWebView={postMessage:message=>window.messages.push(JSON.parse(message))};window.exportSignature();});
  assert.equal(await page.evaluate(()=>window.messages.at(-1).type),'error');
  // Clearly artificial zigzag test mark, not a person's signature.
  await page.mouse.move(60,150);await page.mouse.down();
  for(let i=0;i<8;i++) await page.mouse.move(100+i*55,i%2?185:85,{steps:4});
  await page.mouse.up();
  await page.evaluate(()=>window.exportSignature());
  const png=await page.evaluate(()=>window.messages.at(-1).data);
  assert.ok(png.startsWith('data:image/png;base64,'));
  await page.setViewportSize({width:900,height:450});
  await page.evaluate(()=>window.exportSignature());
  assert.equal(await page.evaluate(()=>window.messages.at(-1).data),png);
  mkdirSync('tmp/pdfs',{recursive:true});
  writeFileSync('tmp/pdfs/test-signature-data.txt',png);
  await page.screenshot({path:'tmp/pdfs/canvas-check.png'});
  await page.evaluate(()=>{window.clearSignature();window.exportSignature();});
  assert.equal(await page.evaluate(()=>window.messages.at(-1).type),'error');
  assert.deepEqual(requests,[]);
  // Exercise the actual document-canvas script too, including interruption
  // while drawing and controls outside the canvas. This is not a native UI test.
  for (const role of ['customer','preparer']) {
    const bridge = `<script>window.messages=[];window.outsideClicks=0;window.ReactNativeWebView={postMessage:m=>window.messages.push(JSON.parse(m))};</script>`;
    await page.setContent(`<!DOCTYPE html><html><head>${bridge}${documentStyle}</head><body>
      <div class="signature-input" style="width:400px"><canvas id="signature-canvas"></canvas></div>
      <div class="signature-name" data-signature-name-slot="${role}">Test</div>
      <button id="outside" onclick="window.outsideClicks=(window.outsideClicks||0)+1">Outside canvas</button>
      ${documentScript.replaceAll('${role}',role)}</body></html>`);
    const canvas = page.locator('#signature-canvas');
    const box = await canvas.boundingBox();
    for (const interruption of ['lift','clear','export','blur','lostcapture']) {
      await page.mouse.move(box.x+30,box.y+50);await page.mouse.down();
      await page.mouse.move(box.x+150,box.y+90,{steps:5});
      assert.equal(await canvas.evaluate(c => c.hasPointerCapture(1)),true);
      if (interruption === 'clear') await page.evaluate(()=>window.clearSignature());
      if (interruption === 'export') await page.evaluate(()=>window.exportSignature());
      if (interruption === 'blur') await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
      if (interruption === 'lostcapture') await canvas.evaluate(c=>c.releasePointerCapture(1));
      await page.mouse.up();
      assert.equal(await canvas.evaluate(c => c.hasPointerCapture(1)),false);
      await page.locator('#outside').click();
      // A new stroke and export must work without reopening the document.
      const count = await page.evaluate(()=>window.messages.filter(m=>m.type==='changed'&&m.hasInk).length);
      await page.mouse.move(box.x+50,box.y+60);await page.mouse.down();
      await page.mouse.move(box.x+200,box.y+80,{steps:4});await page.mouse.up();
      assert.equal(await page.evaluate(()=>window.messages.filter(m=>m.type==='changed'&&m.hasInk).length),count+1);
      await page.evaluate(()=>window.exportSignature());
      assert.ok(await page.evaluate(()=>window.messages.at(-1).data.startsWith('data:image/png;base64,')));
    }
    assert.equal(await page.evaluate(()=>window.outsideClicks),5);
  }
  assert.deepEqual(requests,[]);
  console.log('Canvas: drawing, stable resize, PNG export, redraw, interrupted-pointer recovery, repeated outside controls, both document roles, and offline checks passed.');
} finally {await browser.close();}
