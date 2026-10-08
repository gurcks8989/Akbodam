import {test,expect} from '@playwright/test';
test('touch reorder and pointer cancellation',async({page})=>{
 await page.route('**/drag-test',route=>route.fulfill({contentType:'text/html',body:`<style>li{height:100px}button{touch-action:none;width:50px;height:50px}</style><ol id="queue"></ol><script type="module">
 import {installQueueDrag} from '/queue-drag.js';
 let ids=['a','b','c'];window.saved=[];
 const q=document.querySelector('ol');const draw=()=>q.innerHTML=ids.map(id=>'<li data-item="'+id+'"><button data-drag="'+id+'">'+id+'</button></li>').join('');draw();
 installQueueDrag(q,{snapshot:()=>({ids:[...ids]}),reset:draw,commit:(_,next)=>{ids=next;window.saved=next;draw();}});window.ready=true;
 </script>`}));
 await page.goto('/drag-test');await page.waitForFunction(()=>window.ready);
 const cdp=await page.context().newCDPSession(page);
 const from=await page.locator('[data-drag=a]').boundingBox();
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:from.x+20,y:from.y+20}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:from.x+20,y:290}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(()=>page.evaluate(()=>window.saved)).toEqual(['b','c','a']);
 const b=await page.locator('[data-drag=b]').boundingBox();
 await page.mouse.move(b.x+20,b.y+20);await page.mouse.down();await page.mouse.move(b.x+20,290);await page.keyboard.press('Escape');await page.mouse.up();
 await expect(page.locator('[data-item]')).toHaveText(['b','c','a']);
 await page.locator('[data-drag=c]').focus();await page.keyboard.press('ArrowUp');
 await expect.poll(()=>page.evaluate(()=>window.saved)).toEqual(['c','b','a']);
});
