const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
process.chdir(path.resolve(__dirname,'..'));fs.mkdirSync('test-output',{recursive:true});
const kind=process.argv[2]||'unit';let files=fs.readdirSync('tests').filter(n=>kind==='unit'?n.endsWith('.test.cjs'):kind==='journey'?n==='journey-browser.cjs':n==='browser.cjs'||n.endsWith('-browser.cjs')).sort();
let failed=0;for(const f of files){console.log('TEST '+f);const r=spawnSync(process.execPath,['tests/'+f],{stdio:'inherit',env:process.env,timeout:120000});if(r.status!==0)failed++;}console.log(`${files.length} suites; ${failed} failed`);process.exitCode=failed?1:0;
