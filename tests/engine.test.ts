import { describe, it, expect } from 'vitest';
import { analyze, resolve, diagnostics } from '../server/engine';
import { checkoutExample as example } from '../shared/example';
import type { Input } from '../shared/types';
import { ts } from 'ts-morph';
import vm from 'node:vm';
const input = (base:string,a:string,b:string):Input => ({...example,base,agentA:a,agentB:b});
function execute(source: string) {
  // Only our fixed test fixture is executed. User-submitted code is never executed by the application.
  const js = ts.transpile(source, {module:ts.ModuleKind.CommonJS});
  const sandbox = {exports:{} as {requestHandler:(order:unknown)=>unknown}};
  vm.runInNewContext(js,sandbox,{timeout:1000});
  return sandbox.exports.requestHandler;
}
describe('TypeScript analysis and reconciliation',()=>{
 it('finds the real checkout overlap and statically resolved call edges',()=>{
  const a=analyze(example);
  expect(a.conflicts.map(c=>c.id)).toEqual(['overlap:validateBody']);
  expect(a.conflicts[0].canCombine).toBe(true);
  expect(a.nodes.find(n=>n.id==='validateBody')?.calls).toContain('schemaCheck');
 });
 it('composes checkout guards in the requested order with different observable results',()=>{
  const a=analyze(example);
  const first=resolve(example,{'overlap:validateBody':{choice:'both',order:'a-first',note:''}},a);
  const second=resolve(example,{'overlap:validateBody':{choice:'both',order:'b-first',note:''}},a);
  expect(diagnostics(first)).toEqual([]);
  expect(execute(first)({})).toEqual({ok:false,error:'Your order is incomplete'});
  expect(execute(second)({})).toEqual({ok:false,error:'email: enter a valid email address'});
  expect(execute(first)({email:'ok@example.com',items:['a']})).toEqual({ok:true});
  expect(execute(first)({email:'wrong',items:['a']})).toEqual({ok:false,error:'email: enter a valid email address'});
 });
 it('keeps either version and refuses unresolved decisions',()=>{
  expect(()=>resolve(example,{})).toThrow('decision');
  expect(execute(resolve(example,{'overlap:validateBody':{choice:'a',note:''}}))({email:'wrong',items:['a']})).toEqual({ok:true});
  expect(execute(resolve(example,{'overlap:validateBody':{choice:'b',note:''}}))({})).toEqual({ok:false,error:'email: enter a valid email address'});
 });
 it('merges disjoint functions but asks for review when they share a call path',()=>{
  const base='function a(){return b()}\nfunction b(){return 1}';
  const i=input(base,base.replace('return b()','return b()+1'),base.replace('return 1','return 2'));
  const a=analyze(i);
  expect(a.conflicts[0].kind).toBe('dependency');
  const result=resolve(i,{[a.conflicts[0].id]:{choice:'reviewed',note:'Reviewed return contract'}},a);
  expect(result).toContain('return b()+1'); expect(result).toContain('return 2');
 });
 it('handles unrelated edits, equal changes, additions and deletions',()=>{
  const base='function a(){return 1}\nfunction b(){return 1}';
  const i=input(base,'function a(){return 2}\nfunction b(){return 1}', 'function a(){return 1}\nfunction b(){return 3}\nfunction c(){return 4}');
  const result=resolve(i,{}); expect(result).toContain('return 2');expect(result).toContain('return 3');expect(result).toContain('function c');
  expect(resolve(input(base,base,base.replace('function b(){return 1}','')),{})).not.toContain('function b');
  expect(resolve(input(base,'function a(){return 2}','function a(){return 2}'),{})).toBe('function a(){return 2}');
 });
 it('rejects replacement-body composition and delete/edit composition',()=>{
  const base='function a(){return 1}';
  expect(analyze(input(base,'function a(){return 2}','function a(){return 3}')).conflicts[0].canCombine).toBe(false);
  expect(analyze(input(base,'','function a(){return 3}')).conflicts[0].canCombine).toBe(false);
 });
 it('fails closed on module changes and preserves the selected full snapshot',()=>{
  const i=input('const x=1; function a(){return x}','const x=2; function a(){return x}','const x=1; function a(){return x+1}');
  expect(analyze(i).conflicts[0].kind).toBe('file');
  expect(resolve(i,{file:{choice:'a',note:''}})).toBe(i.agentA);
  expect(()=>resolve(i,{file:{choice:'both',order:'a-first',note:''}})).toThrow();
 });
 it('rejects invalid syntax and duplicate binding composition',()=>{
  expect(()=>analyze(input('function {','',''))).toThrow('Base');
  const base='function a(){return 1}';
  const a='function a(){const x=1;return 1}',b='function a(){const x=2;return 1}';
  expect(analyze(input(base,a,b)).conflicts[0].canCombine).toBe(false);
 });
 it('does not treat a shadowed function name as a local call edge',()=>{
  const base='function a(b:()=>void){b()}\nfunction b(){}';
  expect(analyze(input(base,base,base)).nodes.find(n=>n.id==='a')?.calls).toEqual([]);
 });
});
