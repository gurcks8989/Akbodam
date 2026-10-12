import {test,expect} from '@playwright/test';
import {pdfFixture,pngFixture} from './fixtures.mjs';
test('phone browser sends a PDF, detects duplicates and adds it to the current setlist',async({page,browser})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('#library-open').click();await page.locator('#phone-open').click();
 await expect(page.locator('#phone-start')).toBeEnabled();await page.locator('#phone-start').click();
 await expect(page.locator('#phone-qr')).toBeVisible();
 const session=await(await page.request.get('/api/phone')).json();
 expect(session.active).toBe(true);
 await page.screenshot({path:'test-results/phone-qr.png'});
 const context=await browser.newContext({viewport:{width:390,height:844}}),phone=await context.newPage();phone.on('pageerror',e=>errors.push(e.message));
 try{
 await phone.goto(session.url);await expect(phone.locator('#files')).toBeEnabled();
 await phone.locator('#files').setInputFiles({name:'휴대폰 전송.pdf',mimeType:'application/pdf',buffer:Buffer.concat([pdfFixture(),Buffer.from('\n% phone test\n')])});
 await phone.locator('#send').click();await expect(phone.locator('#results')).toContainText('보관함에 저장했습니다.');
 await expect(page.locator('#phone-received')).toContainText('휴대폰 전송');
 await phone.locator('#send').click();await expect(phone.locator('#results')).toContainText('이미 보관된 악보');
 await expect(page.locator('#phone-received li')).toHaveCount(2);
 await phone.locator('#files').setInputFiles({name:'휴대폰 사진.png',mimeType:'image/png',buffer:pngFixture});
 await phone.locator('#send').click();await expect(phone.locator('#results')).toContainText('보관');
 await expect(page.locator('#phone-received li')).toHaveCount(3);
 await phone.screenshot({path:'test-results/phone-upload.png'});
 const before=await(await page.request.get('/api/state')).json();
 await page.locator('#phone-received button').first().click();await expect(page.locator('#phone-received button').first()).toHaveText('콘티에 담았어요');
 const after=await(await page.request.get('/api/state')).json();
 expect(after.scores.filter(s=>s.title==='휴대폰 전송')).toHaveLength(1);
 expect(after.playlists.reduce((n,p)=>n+p.items.length,0)).toBe(before.playlists.reduce((n,p)=>n+p.items.length,0)+1);
 await page.locator('#phone-close').click();await expect.poll(async()=>(await(await page.request.get('/api/phone')).json()).active).toBe(false);
 await expect(page.locator('.library-row').filter({hasText:'휴대폰 전송'})).toHaveCount(1);
 expect(errors).toEqual([]);
 }finally{await page.request.delete('/api/phone');await context.close();}
});
