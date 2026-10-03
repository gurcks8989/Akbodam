import { defineConfig } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
const dataDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(),'score-ui-')), '.hidden-project', 'data');
export default defineConfig({testDir:'./test',testMatch:'*.spec.mjs',workers:1,use:{baseURL:'http://127.0.0.1:4187',viewport:{width:1280,height:900}},webServer:{command:'node server.mjs',port:4187,env:{PORT:'4187',SCORE_DATA_DIR:dataDir},reuseExistingServer:false}});
