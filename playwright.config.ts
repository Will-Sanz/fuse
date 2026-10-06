import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',fullyParallel:false,workers:1,timeout:45000,
  expect:{timeout:10000},reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:3101',trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'npm run build && npm start',url:'http://127.0.0.1:3101/api/health',reuseExistingServer:false,timeout:60000,env:{PORT:'3101',FUSE_DB:'test-results/browser.sqlite'}},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}}],
});
