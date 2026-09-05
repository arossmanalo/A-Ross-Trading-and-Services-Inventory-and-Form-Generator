// Desktop smoke test only; the Android WebView still requires device testing.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const runtimeRequire = createRequire(process.env.AROSS_RUNTIME_PACKAGE_JSON || import.meta.url);
const { chromium } = runtimeRequire('playwright');
const source = readFileSync('src/features/signatures/signature-pad.tsx','utf8');
const html = source.match(/export const SIGNATURE_PAD_HTML = `([\s\S]*?)`;/)[1];
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
  console.log('Canvas: blank rejection, drawing, stable resize, PNG export, clear, and offline checks passed.');
} finally {await browser.close();}
