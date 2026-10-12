import {test,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import fs from 'node:fs';
test('export current score and complete concert, download on phone, then revoke QR',async({page,browser})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('#library-open').click();await page.locator('#library-all').click();await page.locator('.library-row').filter({hasText:'첫번째 악보'}).locator('[data-view]').click();await expect(page.locator('#stage canvas')).toBeVisible();
 await page.locator('#export-open').click();await page.locator('#export-prepare').click();await expect(page.locator('#export-status')).toContainText('PDF가 준비되었습니다.');
 const current=await page.request.get(await page.locator('#export-local').getAttribute('href'));expect(current.status()).toBe(200);expect((await PDFDocument.load(await current.body())).getPageCount()).toBe(2);
 await page.locator('#export-scope').selectOption('playlist');await page.locator('#export-prepare').click();await expect(page.locator('#export-status')).toContainText('PDF가 준비되었습니다.');
 const concert=await page.request.get(await page.locator('#export-local').getAttribute('href'));expect(concert.status()).toBe(200);const bytes=await concert.body();expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(3);fs.writeFileSync('test-results/export-concert.pdf',bytes);
 await page.locator('#export-share').click();await expect(page.locator('#export-qr')).toBeVisible();const box=await page.locator('#export-qr').boundingBox();expect(box.y).toBeGreaterThanOrEqual(0);expect(box.y+box.height).toBeLessThanOrEqual(900);await page.screenshot({path:'test-results/export-qr.png'});
 const session=await(await page.request.get('/api/export/phone')).json();expect(session.mode).toBe('download');
 const context=await browser.newContext({viewport:{width:390,height:844}}),phone=await context.newPage();
 try{
 await phone.goto(session.url);await expect(phone.locator('#download-info')).toBeVisible();await phone.screenshot({path:'test-results/export-phone.png'});
 const downloadHref=await phone.locator('#download').getAttribute('href'),url=new URL(session.url),base=url.origin;
 expect((await context.request.get(base+'/download')).status()).toBe(403);expect((await context.request.get(base+'/api/state')).status()).toBe(404);
 const result=await context.request.get(base+downloadHref);expect(result.status()).toBe(200);expect(await result.body()).toEqual(bytes);expect(result.headers()['content-disposition']).toContain('attachment');
 await page.locator('#export-close').click();await expect.poll(async()=>(await(await page.request.get('/api/export/phone')).json()).active).toBe(false);
 expect(errors).toEqual([]);
 }finally{await page.request.delete('/api/export/phone');await context.close();}
});
