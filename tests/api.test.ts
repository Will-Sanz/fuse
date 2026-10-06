import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import { checkoutExample } from '../shared/example';
const stores:Store[]=[];
const setup=()=>{const store=new Store(':memory:');stores.push(store);return createApp(store);};
afterEach(()=>{stores.splice(0).forEach(s=>s.close());});
describe('persistent review API',()=>{
 it('creates, previews, saves, finalizes, downloads, and records exact source hashes',async()=>{
  const app=setup();
  let response=await request(app).post('/api/example').send({}).expect(201);
  let w=response.body;
  await request(app).get(`/api/workspaces/${w.id}/download`).expect(422);
  await request(app).post(`/api/workspaces/${w.id}/finalize`).send({revision:0}).expect(422);
  const body={revision:0,conflictId:'overlap:validateBody',decision:{choice:'both',order:'a-first',note:'Reject missing fields before detailed schema errors.'}};
  response=await request(app).post(`/api/workspaces/${w.id}/preview`).send(body).expect(200);
  expect(response.body.code).toContain('schemaCheck(order)');
  response=await request(app).patch(`/api/workspaces/${w.id}/decisions`).send(body).expect(200);
  w=response.body;expect(w.revision).toBe(1);
  await request(app).patch(`/api/workspaces/${w.id}/decisions`).send(body).expect(409);
  w=(await request(app).post(`/api/workspaces/${w.id}/finalize`).send({revision:1}).expect(200)).body;
  expect(w.diagnostics).toEqual([]);expect(w.outputHash).toHaveLength(64);expect(w.events).toHaveLength(3);
  const download=await request(app).get(`/api/workspaces/${w.id}/download`).expect(200);
  expect(download.text).toBe(w.output);
  const audit=await request(app).get(`/api/workspaces/${w.id}/audit`).expect(200);
  expect(audit.body.analysis.hashes.base).toHaveLength(64);
  expect((await request(app).get('/api/workspaces')).body[0].resolved).toBe(true);
  const revised=(await request(app).patch(`/api/workspaces/${w.id}/decisions`).send({...body,revision:2,decision:{choice:'a',note:'Reconsidered'}}).expect(200)).body;
  expect(revised.output).toBeNull();await request(app).get(`/api/workspaces/${w.id}/download`).expect(422);
 });
 it('rejects invalid inputs, unknown decisions, and cross-origin writes',async()=>{
  const app=setup();
  await request(app).post('/api/workspaces').send({}).expect(400);
  await request(app).post('/api/example').set('Origin','https://evil.example').send({}).expect(403);
  await request(app).get('/api/workspaces').set('Host','evil.example').expect(403);
  await request(app).post('/api/example').type('form').send({}).expect(415);
  const w=(await request(app).post('/api/example').send({})).body;
  await request(app).patch(`/api/workspaces/${w.id}/decisions`).send({revision:0,conflictId:'unknown',decision:{choice:'a',note:''}}).expect(422);
  await request(app).patch(`/api/workspaces/${w.id}/decisions`).send({revision:0,conflictId:'overlap:validateBody',decision:{choice:'both',note:''}}).expect(422);
  await request(app).post('/api/workspaces').send({...checkoutExample,base:'function {'}).expect(422);
  await request(app).get('/api/workspaces/missing').expect(404);
 });
 it('recovers workspace state after closing and reopening the database',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fuse-test-'));
  const path=join(dir,'review.sqlite');
  let store=new Store(path);
  try {
   const app=createApp(store);
   const w=(await request(app).post('/api/example').send({}).expect(201)).body;
   store.close();store=new Store(path);
   const result=await request(createApp(store)).get(`/api/workspaces/${w.id}`).expect(200);
   expect(result.body.input).toEqual(w.input);expect(result.body.events).toEqual(w.events);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
 });
 it('finalizes a clean, disjoint merge without inventing conflicts',async()=>{
  const app=setup(),base='function a(){return 1}\nfunction b(){return 1}';
  const w=(await request(app).post('/api/workspaces').send({...checkoutExample,base,agentA:base.replace('a(){return 1','a(){return 2'),agentB:base.replace('b(){return 1','b(){return 3')}).expect(201)).body;
  expect(w.analysis.conflicts).toHaveLength(0);
  const result=(await request(app).post(`/api/workspaces/${w.id}/finalize`).send({revision:0}).expect(200)).body;
  expect(result.output).toContain('return 2');expect(result.output).toContain('return 3');
 });
});
