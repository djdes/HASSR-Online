const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const phase = process.argv[2] || 'verifier';
const task = __dirname;
const out = path.join(task, 'raw', phase);
fs.mkdirSync(out, { recursive: true });
const npmCli = 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js';
const env = { ...process.env,
  PATH: path.dirname(process.execPath) + ';C:/Program Files/Git/bin;C:/Program Files/Git/usr/bin;' + process.env.PATH,
  DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/wesetup_test',
  TEST_CONCURRENCY: '4',
};
const commands = [
  ['browser', process.execPath, [path.join(task, 'browser-check.cjs'), phase]],
  ['lint', process.execPath, ['node_modules/eslint/bin/eslint.js', 'src/components/i18n/language-switch.tsx']],
  ['locale-tests', process.execPath, ['--import', 'tsx', '--test', 'src/i18n/site-locale.test.ts', 'src/i18n/locales.test.ts']],
  ['typecheck', process.execPath, [npmCli, 'run', 'typecheck']],
  ['test-gate', process.execPath, [npmCli, 'run', 'test:gate']],
];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const result = { phase, node: process.version, startedAt: new Date().toISOString(),
  headSha: head(),
  specSha256: hash(path.join(task, 'spec.md')),
  lockSha256: hash('package-lock.json'),
  sourceSha256: hash('src/components/i18n/language-switch.tsx'), commands: [] };
for (const [name, executable, args] of commands) {
  const logfile = path.join(out, name + '.log');
  const fd = fs.openSync(logfile, 'w');
  const startedAt = new Date().toISOString();
  const run = spawnSync(executable, args, { env, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  result.commands.push({ name, executable, args, startedAt, endedAt: new Date().toISOString(),
    exitCode: run.status, signal: run.signal, error: run.error?.message, log: path.relative(task, logfile) });
  fs.writeFileSync(path.join(out, 'commands.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${name}: ${run.status === 0 ? 'PASS' : 'FAIL'}`);
}
result.headShaAfter = head();
result.inputsStable = result.headSha === result.headShaAfter &&
  result.sourceSha256 === hash('src/components/i18n/language-switch.tsx') &&
  result.lockSha256 === hash('package-lock.json');
result.status = result.commands.every(c => c.exitCode === 0) && result.inputsStable ? 'PASS' : 'FAIL';
result.endedAt = new Date().toISOString();
fs.writeFileSync(path.join(out, 'commands.json'), JSON.stringify(result, null, 2) + '\n');
process.exitCode = result.status === 'PASS' ? 0 : 1;
