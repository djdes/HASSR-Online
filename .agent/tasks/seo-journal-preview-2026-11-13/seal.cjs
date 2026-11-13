const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');
const phase=process.argv[2]||'verifier';
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const task=__dirname;
const report=JSON.parse(fs.readFileSync(path.join(task,'raw',phase,'commands.json'),'utf8'));
const browser=JSON.parse(fs.readFileSync(path.join(task,'raw',phase,'browser.json'),'utf8'));
assert.equal(report.verdict,'PASS');assert.equal(browser.verdict,'PASS');
assert.equal(report.specSha256,sha(path.join(task,'spec.md')));
assert.equal(report.specSha256,fs.readFileSync(path.join(task,'raw/spec-frozen.sha256'),'utf8').trim());
for(const [file,hash] of Object.entries(report.hashes))assert.equal(sha(file),hash,file);
for(const name of ['browser','lint','typecheck','test-gate'])assert.equal(report.commands.find(c=>c.name===name).exitCode,0,name);
assert.equal(browser.responsive.length,4);assert.equal(browser.landings.length,26);assert.deepEqual(browser.errors,[]);
const baseline='5a251168e8a6c30b2c39126d4fc4f816e2ea9f53';
const unchanged=['src/components/public/blank-download.tsx','src/components/public/blank-download-client.tsx','src/app/api/journal-samples/[code]/pdf/route.ts'];
for(const file of unchanged){
  const original=execFileSync('git',['show',`${baseline}:${file}`]);
  assert.equal(original.toString('utf8').replaceAll('\r\n','\n'),fs.readFileSync(file,'utf8').replaceAll('\r\n','\n'),`${file} must be unchanged`);
}
const fresh=phase==='verifier';
const criteria={
  AC1:{status:'PASS',evidence:'Real cleaning template: sample section index 1, required fields immediately afterwards, four rooms plus responsible/controller rows, 16 columns and demo-data copy.'},
  AC2:{status:'PASS',evidence:'All 13 landing configurations checked at 375 and 1440 px; supported PNG/WebP assets decoded; unsupported pages omit the preview.'},
  AC3:{status:'PASS',evidence:'320/375/768/1440 px: no horizontal document overflow. At 320/375 px real wheel and keyboard input scroll the table, vertical wheel still scrolls the page. Fixture requires no auth, DB or app server.'},
  AC4:{status:'PASS',evidence:'Registration href and cleaning PDF boundary props preserved; custom download URL priority and unsupported PDF fallback verified. Original download components and PDF route are unchanged. Existing cleaning card matrix scrolls.'},
  AC5:{status:fresh?'PASS':'PENDING',evidence:fresh?'Fresh verification reran browser, ESLint, typecheck and repository changed-test gate with stable HEAD and unchanged spec/source/lock hashes.':'Builder checks pass; fresh verification still required.'},
};
const evidence={task:'seo-journal-preview-2026-11-13',verdict:fresh?'PASS':'PENDING_FRESH_VERIFICATION',phase,
  verifiedAt:report.endedAt,verifiedHead:report.head,specSha256:report.specSha256,hashes:report.hashes,
  criteria,commands:report.commands,fixture:browser.fixture,unchangedDownloadFiles:unchanged,
  limitations:['Bounded browser fixture: public header/footer and Next Link are stubbed; download props are observed at the existing email-dialog boundary. No full Next server, email delivery, PDF generation, database or production deployment test is claimed.',
    'npm run test:gate uses the repository changed-file runner; this is not a claim that the full test suite ran.'],
};
fs.writeFileSync(path.join(task,'evidence.json'),JSON.stringify(evidence,null,2)+'\n');
const lines=[`# Journal landing preview evidence`, ``, `Verdict: **${evidence.verdict}**.`, ``,
  `Verified source at HEAD \`${report.head}\` with the production file hashes in evidence.json.`,
  `Frozen spec SHA-256: \`${report.specSha256}\`.`, ``,
  '| Criterion | Status | Evidence |','| --- | --- | --- |',
  ...Object.entries(criteria).map(([key,value])=>`| ${key} | ${value.status} | ${value.evidence} |`),``,
  '## Commands',``,...report.commands.map(c=>`- ${c.name}: exit ${c.exitCode}; raw log: ${c.log.replaceAll('\\','/')}`),``,
  '## Scope and limits',``,...evidence.limitations.map(s=>`- ${s}`),``,
  `Raw browser measurements: raw/${phase}/browser.json. Responsive screenshots: raw/${phase}/cleaning-{320,375,768,1440}.png.`,
  'The original missing sample and blocked matrix scrolling were reproduced against the pinned original master SHA. Fixture setup failures and their corrections are recorded in problems.md; production source did not require a correction.',``,
  'Production impact: two presentation components only; no schema changes. Registration and the email-gated PDF download implementation remain unchanged.',``,
];
fs.writeFileSync(path.join(task,'evidence.md'),lines.join('\n'));
if(fresh)fs.writeFileSync(path.join(task,'verdict.json'),JSON.stringify({verdict:'PASS',criteria:Object.fromEntries(Object.keys(criteria).map(key=>[key,'PASS'])),verifiedHead:report.head,specSha256:report.specSha256,hashes:report.hashes},null,2)+'\n');
console.log(evidence.verdict);
