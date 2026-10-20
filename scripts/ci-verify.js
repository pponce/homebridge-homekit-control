'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const tasks = [['build',['run','build']],['lint',['run','lint']],['tests',['exec','--','node','--test','tests/*.test.js']],['package',['pack','--dry-run']]];
if(process.env.HKC_UI_TEST) tasks.push(['browser',['scripts/ui-smoke.js']]);
let failed=false;let report='Runtime: '+JSON.stringify({...require('../tests/helpers/host').versions,npm:spawnSync('npm',['--version'],{encoding:'utf8'}).stdout.trim()})+'\n\n';
for(const [name,args] of tasks){
  // Explicit files avoid shell expansion and also work on Node 18.
  const command=name==='tests'||name==='browser'?'node':'npm';
  const argv=name==='tests'?['--test',...fs.readdirSync('tests').filter(x=>x.endsWith('.test.js')).map(x=>'tests/'+x)]:args;
  const r=spawnSync(command,argv,{encoding:'utf8',timeout:120000});
  const text=(r.stdout||'')+(r.stderr||'')+(r.error?String(r.error):'');
  console.log(name+'\n'+text);report+=`### ${name}: ${r.status===0?'passed':'failed'}\n\n\`\`\`text\n${text.slice(-10000)}\n\`\`\`\n\n`;failed ||= r.status!==0;
}
fs.writeFileSync('ci-report.md',report);process.exitCode=failed?1:0;
