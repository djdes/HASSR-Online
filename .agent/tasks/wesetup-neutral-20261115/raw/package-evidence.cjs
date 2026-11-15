const fs = require('node:fs');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const task = path.dirname(__dirname);
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
const checks = {
  source: read('source-audit.json'),
  browser: read('browser-result.json'),
  commands: Object.fromEntries(['typecheck-release','gate-master-v2','i18n-final','lint-final','lint-supplement','focused']
    .map(name => [name, {exit: Number(fs.readFileSync(path.join(__dirname, name+'.exit'),'utf8').replace(/^\uFEFF/, '').trim()), log: 'raw/'+name+'.log'}])),
};
if (checks.source.status !== 'PASS' || checks.browser.status !== 'PASS' || checks.browser.checks.length !== 24 || checks.browser.errors.length) {
  throw new Error('Current source/browser evidence is incomplete');
}
for (const [name,result] of Object.entries(checks.commands)) {
  if (result.exit !== 0) throw new Error(name+' failed');
}
const criteria = Object.fromEntries(['AC1','AC2','AC3','AC4'].map(ac=>[ac,'PASS']));
criteria.AC5 = 'PENDING_RELEASE';
const evidence = {
  task: 'wesetup-neutral-20261115', status: 'READY_FOR_RELEASE', checkedAt: new Date().toISOString(),
  verifier: 'Separate current-code review in-thread, no delegation requested',
  base: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  criteria, checks,
  scope: {locales:['ru','en','uz'], changesPerLocale:84, databaseChanges:false, customerDataWrites:false},
  limitations: ['Browser fixture exercises actual components with synthetic data, HTTP mocked, Next navigation/link adapters.',
    'Food-specific journals, real professions, posters, recorded videos and editorial/customer content retained in their named context.'],
};
fs.writeFileSync(path.join(task,'evidence.json'), JSON.stringify(evidence,null,2)+'\n');
fs.writeFileSync(path.join(task,'verdict.json'),JSON.stringify({status:evidence.status,checkedAt:evidence.checkedAt,criteria,sourceHashes:checks.source.hashes},null,2)+'\n');
fs.writeFileSync(path.join(task,'evidence.md'),`# Current-code verification\n\nStatus: READY_FOR_RELEASE. AC1–AC4 PASS; AC5 awaits the green master release and live build identity.\n\nThe frozen scope is checked against the current code after incorporating origin/master (${evidence.base}). A separate verification phase reran the source audit and mandatory commands; repaired findings are in problems.md.\n\n- AC1: 84 exact message paths per locale checked in ru/en/uz, ICU parameters/tags retained. Actual role labels preserved. Schedule reminders address the responsible employee on duty.\n- AC2: Shared marketing, auth, footer, metadata, equipment/pricing and general guidance include medical centres and neutral workplaces. Generic FAQ does not extend food-specific law to medical users.\n- AC3: Actual staff component captures replace universal canteen examples. QR staff captions localized. Auth uses existing industry icons. All 24 browser checks pass across three locales, desktop/mobile; corrected desktop login, staff, schedule and QR captures visually inspected. See audit.md for retained food-specific media.\n- AC4: typecheck, gate (276 tests across 66 files), locale checks (97), focused brand/QR tests (16) and changed-source ESLint pass. Source hashes and exact catalog paths are in raw/source-audit.json. Editorial convention: docs/brand-content.md.\n- AC5: Pending PR/production verification. No database/schema/customer changes.\n\nRaw commands/logs, the synthetic browser fixture and screenshots are alongside this document. Node dependencies are reused from an existing checkout; the fixture makes no live API writes.\n`);
console.log('Evidence packaged: AC1–AC4 PASS; AC5 pending release');
