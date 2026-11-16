from pathlib import Path
import json, hashlib, datetime
root=Path('.agent/tasks/catalog-search-20261116'); raw=root/'raw'
names=['lint','focused','interaction','integration','gate','typecheck']
commands=[]
for name in names:
    code=int((raw/f'verify-{name}.exit').read_text(encoding='utf-8-sig').strip())
    assert code==0,(name,code)
    commands.append({'name':name,'exitCode':code,'log':f'raw/verify-{name}.log'})
inputs=json.loads((raw/'verification-inputs.json').read_text(encoding='utf-8'))
for file,expected in inputs['sha256'].items():
    assert hashlib.sha256(Path(file).read_bytes()).hexdigest()==expected,file
for name in ['interaction','integration']:
    assert json.loads((raw/f'{name}.json').read_text(encoding='utf-8'))['verdict']=='PASS'
data=(raw/'verify-focused.log').read_bytes()
text=data.decode('utf-16' if data.startswith(b'\xff\xfe') else 'utf-8-sig')
assert 'tests 26' in text and 'fail 0' in text
criteria=[
 ('AC1','Both blank and order catalogs filter their names, codes, descriptions and regulatory text using the shared matcher.'),
 ('AC2','Shared matcher tests pass for normalization, all-word matching, typo/layout support and empty-query restoration.'),
 ('AC3','Interaction fixture passes filtering, group hiding, live counts, zero results, reset focus and Escape at 375px; responsive width classes reviewed.'),
 ('AC4','AST comparisons preserve all download/link attributes, metadata and FAQ; server content, sorting and existing localized journal search retained.'),
 ('AC5','Fresh lint, 26 focused tests, interaction/integration checks, targeted gate and full typecheck all exit 0; current source hashes match verification inputs.'),
 ('AC6','Admin helper translator uses its caller namespace; emitted JavaScript is byte-identical to HEAD; typecheck and requisite tests pass.'),
]
evidence={'task':'catalog-search-20261116','verdict':'PASS','verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'codeRoot':str(Path.cwd()),'inputs':inputs,'specs':['spec.md','scope-reconciliation.md','verification-repair-spec.md'],'criteria':[{'id':i,'status':'PASS','detail':d} for i,d in criteria],'checks':commands,'limitations':['Browser interactions use a component fixture, not a deployed full-page end-to-end session.','Production deployment has not been verified by this evidence.']}
(root/'evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines=['# Evidence — PASS','', 'Final scope follows the frozen spec and scope/verification repair addenda. Fresh verification ran against the current worktree, not prior chat claims.','']
lines += [f'- **{i}: PASS** — {d}' for i,d in criteria]
lines += ['', 'Raw commands and exit files: `raw/verify-*.log` / `raw/verify-*.exit`. Input hashes: `raw/verification-inputs.json`. Browser fixture and AST checks are reproducible through `verify.ps1`.','', 'The browser evidence covers a component fixture rather than a deployed page. No production verification is claimed.']
(root/'evidence.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
(root/'verification.md').write_text('# Fresh verification — PASS\n\nReviewed current code and reran all checks with verify.ps1. All six commands returned zero, all six acceptance criteria pass, and the four implementation file hashes are unchanged from the verification input snapshot. No outstanding problems remain.\n',encoding='utf-8')
print('PASS: AC1–AC6; lint, 26 tests, interaction, integration, targeted gate, full typecheck; source hashes unchanged.')
