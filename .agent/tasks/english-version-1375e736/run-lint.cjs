const fs=require('node:fs'),cp=require('node:child_process');
const files=JSON.parse(fs.readFileSync(__dirname+'/owned-sources.json','utf8')).filter(f=>/\.tsx?$/.test(f));
const result=cp.spawnSync(process.execPath,['node_modules/eslint/bin/eslint.js',...files],{stdio:'inherit'});
process.exit(result.status??1);
