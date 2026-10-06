import { expect, test } from '@playwright/test';

test('checkout review: overview → preview → decision → persisted result → download',async({page},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('/');
 await page.getByRole('button',{name:'New review',exact:true}).first().click();
 await page.getByRole('button',{name:'Open checkout example'}).click();
 await expect(page.getByRole('heading',{name:'Parallel work, in focus.'})).toBeVisible();
 await expect(page.getByText('1 decision needed',{exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('overview.png'),fullPage:true});
 await page.getByRole('button',{name:'Review conflict'}).click();
 await expect(page.getByRole('heading',{name:'Both agents changed validateBody'})).toBeVisible();
 await page.getByRole('button',{name:'Merge both Combine additive changes'}).click();
 await page.getByLabel('Validation order').selectOption('b-first');
 await expect(page.locator('.result-preview')).toContainText('const schema = schemaCheck(order)');
 await expect(page.getByRole('button',{name:'Save decision',exact:true})).toBeEnabled();
 await page.getByLabel('Decision note').fill('Schema checks first so invalid fields have precise errors.');
 await page.screenshot({path:testInfo.outputPath('resolution.png'),fullPage:true});
 await page.getByRole('button',{name:'Save decision',exact:true}).click();
 await expect(page.getByText('Decision saved',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Generate resolved file',exact:true}).click();
 await expect(page.getByText('Standalone type check passed',{exact:true})).toBeVisible();
 await expect(page.getByText('Schema checks first so invalid fields have precise errors.',{exact:false})).toBeVisible();
 const downloadEvent=page.waitForEvent('download');
 await page.getByRole('link',{name:'Download TypeScript'}).click();
 const download=await downloadEvent;expect(download.suggestedFilename()).toBe('checkout.ts');
 const url=page.url();await page.reload();
 await expect(page.getByText('Resolution saved',{exact:true})).toBeVisible();
 expect(page.url()).toBe(url);
 await page.getByRole('button',{name:'Resolved summary',exact:true}).click();
 await expect(page.getByText('Schema checks first so invalid fields have precise errors.',{exact:false})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('summary.png'),fullPage:true});
 expect(errors).toEqual([]);
});

test('custom revisions reject syntax errors and accept a clean merge',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'New review',exact:true}).first().click();
 await page.getByRole('button',{name:'TypeScript files',exact:true}).click();
 await page.getByLabel('Review title').fill('Custom merge');
 await page.getByRole('textbox',{name:'Common base source',exact:true}).fill('function {');
 await page.getByRole('button',{name:'Analyze revisions'}).click();
 await expect(page.getByRole('alert')).toContainText('Base:');
 await page.getByRole('textbox',{name:'Common base source',exact:true}).fill('function a(){return 1}\nfunction b(){return 1}');
 await page.getByRole('textbox',{name:'Agent A source',exact:true}).fill('function a(){return 2}\nfunction b(){return 1}');
 await page.getByRole('textbox',{name:'Agent B source',exact:true}).fill('function a(){return 1}\nfunction b(){return 3}');
 await page.getByRole('button',{name:'Analyze revisions'}).click();
 await expect(page.getByText('Ready to generate',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Generate resolved file',exact:true}).click();
 await expect(page.locator('.output-panel pre')).toContainText('return 2');
 await expect(page.locator('.output-panel pre')).toContainText('return 3');
});

test('mobile layout and GitHub import errors are usable',async({page},testInfo)=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'New review',exact:true}).first().click();
 await page.getByRole('button',{name:'GitHub branches',exact:true}).click();
 await expect(page.getByText('Public repositories work without a key.',{exact:false})).toBeVisible();
 await page.route('**/api/github/import',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({error:'GitHub could not find that repository or branch.'})}));
 await page.getByLabel('Repository',{exact:true}).fill('team/missing');
 await page.getByLabel('Agent A branch').fill('a');await page.getByLabel('Agent B branch').fill('b');
 await page.getByLabel('TypeScript file path').fill('src/file.ts');
 await page.getByRole('button',{name:'Analyze revisions'}).click();await expect(page.getByRole('alert')).toContainText('could not find');
 await page.getByRole('button',{name:'Checkout example',exact:true}).click();
 await page.getByRole('button',{name:'Open checkout example'}).click();
 await expect(page.getByRole('heading',{name:'Parallel work, in focus.'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('mobile.png'),fullPage:true});
});
