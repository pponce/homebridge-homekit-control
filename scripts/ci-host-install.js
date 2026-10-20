'use strict';
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
let report = '';
for (const args of [['install','--global','npm@11.19.1'], ['install','--no-save','--package-lock=false','--ignore-scripts','homebridge@2.4.0']]) {
  const result = spawnSync('npm', args, { encoding: 'utf8', timeout: 180000 });
  const output = (result.stdout || '') + (result.stderr || '') + (result.error || '');
  report += '```text\n' + output.slice(-16000) + '\n```\n';
  console.log(output);
  if (result.status !== 0) {
    fs.writeFileSync('ci-report.md', 'Reported host dependency setup failed\n\n' + report);
    process.exit(result.status || 1);
  }
}
