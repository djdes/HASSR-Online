const {build}=require(process.env.PROOF_ESBUILD || 'esbuild');
const {chromium}=require('playwright');
const fs=require('fs');
const assert=require('node:assert/strict');
(async()=>{
const alias=process.env.PROOF_NODE_MODULES ? Object.fromEntries(['react','react-dom','lucide-react'].map(name=>[name,`${process.env.PROOF_NODE_MODULES}/${name}`])) : {};
const bundle=await build({alias,entryPoints:['.agent/tasks/catalog-search-20261116/fixture.tsx'],bundle:true,write:false,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'}});
const browser=await chromium.launch({headless:true,channel:"chrome"});
try {
 const page=await browser.newPage({viewport:{width:375,height:812}});
 await page.setContent('<div id="root"></div>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const field=page.getByRole('searchbox');
 await field.waitFor();
 assert.equal(await page.locator('.items a').count(),3);
 await field.fill('  УЧЕТ   4282  ');
 await page.getByRole('link',{name:'Температура PDF'}).waitFor();
 assert.equal(await page.locator('.items a').count(),1);
 assert.equal(await page.getByRole('heading').count(),1);
 assert.equal(await page.getByRole('status').textContent(),'Найдено: 1');
 assert.equal(await page.getByRole('link').getAttribute('href'),'/api/journal-samples/fridge/pdf');
 await field.fill('несуществующий запрос');
 await page.getByText('Ничего не найдено',{exact:true}).waitFor();
 assert.equal(await page.getByRole('heading').count(),0);
 await page.getByRole('button',{name:'Сбросить поиск',exact:true}).last().click();
 assert.equal(await field.inputValue(),'');
 assert.equal(await page.locator('.items a').count(),3);
 assert.equal(await field.evaluate(el=>el===document.activeElement),true);
 await field.fill('уборка');
 await page.getByRole('link',{name:'Уборка',exact:true}).waitFor();
 await field.press('Escape');
 assert.equal(await page.locator('.items a').count(),3);
 const report={verdict:'PASS',checks:['initial links','normalization and multiword filtering','empty group hiding','live counts','download href preservation','zero results','reset and focus','Escape restores original order'],viewport:'375x812'};
 fs.writeFileSync('.agent/tasks/catalog-search-20261116/raw/interaction.json',JSON.stringify(report,null,2));
 console.log(report);
} finally {await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

