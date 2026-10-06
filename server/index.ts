import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app';
import { Store } from './store';
const store=new Store(process.env.FUSE_DB || 'data/fuse.sqlite');
const app=createApp(store,{githubToken:process.env.GITHUB_TOKEN});
if(existsSync('dist/index.html')) {
  app.use(express.static('dist'));
  app.get('/{*path}',(_req,res)=>res.sendFile(resolve('dist/index.html')));
}
const port=Number(process.env.PORT || 3001);
const server=app.listen(port,'127.0.0.1',()=>console.log(`Fuse API / production app: http://127.0.0.1:${port}`));
function close(){server.close(()=>{store.close();process.exit(0);});}
process.on('SIGINT',close);process.on('SIGTERM',close);
