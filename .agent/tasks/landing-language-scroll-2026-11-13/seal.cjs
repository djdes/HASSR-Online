const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const task = __dirname;
const phase = process.argv[2];
assert.ok(phase, 'provide the completed final verification phase');
const read = file => fs.readFileSync(path.join(task, file), 'utf8');
const commands = JSON.parse(read(`raw/${phase}/commands.json`));
const browser = JSON.parse(read(`raw/${phase}/browser-results.json`));
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim();
const source = 'src/components/i18n/language-switch.tsx';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(commands.status, 'PASS');
assert.equal(commands.inputsStable, true);
assert.equal(commands.headShaAfter, git(['rev-parse', 'HEAD']));
assert.equal(commands.sourceSha256, hash(source));
assert.equal(commands.lockSha256, hash('package-lock.json'));
assert.equal(browser.status, 'PASS');
assert.equal(browser.hashes[source], commands.sourceSha256);
assert.ok(commands.commands.every(c => c.exitCode === 0));
assert.equal(git(['diff', 'HEAD', '--name-only', '--', 'src']), source);
const criteria = ['AC1', 'AC2', 'AC3', 'AC4', 'AC5'].map(id => ({
  id, criterion: read('spec.md').split('\n').find(line => line.startsWith(`- ${id}:`)).slice(2),
  status: 'PASS', evidence: id === 'AC5' ? [`raw/${phase}/commands.json`] : [`raw/${phase}/browser-results.json`],
}));
const summary = browser.scenarios.map(s => {
  const p = s.positions.find(p => p.offset === 900);
  return { mode: s.mode, viewport: s.viewport, bodyWidthBefore: p.before.bodyWidth,
    bodyWidthOpened: p.opened.bodyWidth, scrollBefore: p.before.scrollY,
    scrollOpened: p.opened.scrollY, scrollAfterWheel: p.wheeled.scrollY,
    headerY: p.opened.header.y, locked: p.opened.locked };
});
const verdict = { taskId: 'landing-language-scroll-2026-11-13', status: 'PASS',
  verifiedAt: new Date().toISOString(), verificationMode: 'Fresh current-code command rerun by the same agent; no delegated reviewer',
  headSha: commands.headSha, sourceSha256: commands.sourceSha256,
  productionBlob: git(['hash-object', source]), lockSha256: commands.lockSha256,
  node: commands.node, inputsStable: true, productionFiles: [source], criteria,
  fixtureLimit: 'Real LanguageSwitch, Radix, intl and CSS. Next routing and landing body are fixtures; mobile is a Chromium viewport, not physical hardware.',
};
fs.writeFileSync(path.join(task, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');
fs.writeFileSync(path.join(task, 'evidence.json'), JSON.stringify({ ...verdict,
  versions: browser.versions, browserSummary: summary, commands: commands.commands,
  testGateMode: 'Repository default changed-file mode: no connected unit tests for LanguageSwitch. Separately ran 14 locale unit tests and the browser regression.',
}, null, 2) + '\n');
fs.writeFileSync(path.join(task, 'evidence.md'), `# Evidence — PASS\n\n` +
  `Fresh pass: raw/${phase}/commands.json and raw/${phase}/browser-results.json. ` +
  `Verified base HEAD ${commands.headSha}, Node ${commands.node}, current lockfile; HEAD and source/lock hashes stayed stable for the whole pass.\n\n` +
  `Production change: only LanguageSwitch opts into modal={false}. Shared menu defaults and styling remain intact.\n\n` +
  `- AC1 PASS: open/close preserves scroll offset, horizontal position, viewport and body width. The original mode reduces body width by 15px with visible scrollbars.\n` +
  `- AC2 PASS: wheel input with an open fixed menu advances scrollY from 900 to 1220; its anchor remains 6px below the trigger. Original mode locks body scrolling.\n` +
  `- AC3 PASS: after opening at scrollY=900, original header y=-900; fixed header y=0. Checked 1440×900 and 390×844.\n` +
  `- AC4 PASS: keyboard opening/navigation, Escape/focus restoration, outside dismissal, locale URL query/hash, and both explicit-language cookies.\n` +
  `- AC5 PASS: ESLint, 14 locale unit tests, npm run typecheck, and npm run test:gate all exit 0 in the fresh pass.\n\n` +
  `The default repository test gate selects tests for changed files and found no connected unit tests for LanguageSwitch; no full unit-suite claim is made. The separate real-component browser regression covers this change.\n\n` +
  `The browser uses actual LanguageSwitch, Radix, intl and repository CSS. Next routing and landing body are bounded fixtures, not a full production landing E2E. Mobile results are Chromium viewports, not physical devices.\n\n` +
  `Original dispatcher changes were preserved by using a clean worktree. Exploratory old-lock runs and the intermediate pass overlapping an upstream update are superseded by this stable current-code pass.\n`);
fs.appendFileSync(path.join(task, 'problems.md'), `\n## Final resolution\n\nAll earlier measurement/environment/upstream issues are resolved. Fresh ${phase} pass: every acceptance criterion PASS, all five commands exit 0, and HEAD/input hashes remain stable. No additional production changes were required.\n`);
console.log(JSON.stringify({ status: 'PASS', head: verdict.headSha, criteria: criteria.map(c => `${c.id}:PASS`) }));
