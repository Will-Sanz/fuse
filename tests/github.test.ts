import { expect, it, vi } from 'vitest';
import { importGitHub } from '../server/github';
const a='a'.repeat(40),b='b'.repeat(40),base='c'.repeat(40);
const args={repository:'team/project',refA:'feature/guards',refB:'feature/schema',fileName:'src/checkout.ts'};
it('pins branch tips, uses the actual merge base, and fetches exact snapshots',async()=>{
 const urls:string[]=[];
 const fake=vi.fn(async(url: string | URL | Request)=>{
  urls.push(String(url));let data:unknown;
  if(String(url).includes('/commits/'))data={sha:String(url).includes('guards')?a:b};
  else if(String(url).includes('/compare/'))data={merge_base_commit:{sha:base}};
  else data={type:'file',encoding:'base64',size:10,content:Buffer.from(`// ${String(url).split('ref=')[1]}`).toString('base64')};
  return new Response(JSON.stringify(data),{status:200});
 });
 const result=await importGitHub(args,'test-token',fake);
 expect(urls).toContain(`https://api.github.com/repos/team/project/compare/${a}...${b}`);
 expect(result.base).toBe(`// ${base}`);expect(result.agentA).toBe(`// ${a}`);
 expect(result.origin).toContain(base);expect(result.origin).not.toContain('test-token');
});
it('reports permission failures without leaking secrets',async()=>{
 const fake=vi.fn(async()=>new Response('secret upstream details',{status:403}));
 await expect(importGitHub(args,'secret',fake)).rejects.toThrow('GitHub denied access');
});
it('rejects files missing at all commits',async()=>{
 const fake=vi.fn(async(url:string|URL|Request)=>{
  if(String(url).includes('/contents/'))return new Response('',{status:404});
  return new Response(JSON.stringify(String(url).includes('/compare/')?{merge_base_commit:{sha:base}}:{sha:a}));
 });
 await expect(importGitHub(args,undefined,fake)).rejects.toThrow('does not exist');
});
