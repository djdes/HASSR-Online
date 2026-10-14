"""Package verified partial coverage without claiming the whole task is done."""
import hashlib
import json
import subprocess
from pathlib import Path

TASK = Path(__file__).resolve().parent
ROOT = TASK.parents[2]
raw = TASK / 'raw'
manifest = json.loads((raw / 'source-manifest.json').read_text())
for name, expected in manifest.items():
    assert hashlib.sha256((ROOT / name).read_bytes().replace(b'\r\n', b'\n')).hexdigest() == expected, name
assert (raw / 'verify.exit').read_text().strip() == '0'
assert (raw / 'build.exit').read_text().strip() == '0'
assert 'pass=3375, fail=0' in (raw / 'verify-gate.log').read_text(encoding='utf-8')
assert '# pass 40' in (raw / 'verify-focused.log').read_text(encoding='utf-8')
browser = json.loads((raw / 'browser-report.json').read_text(encoding='utf-8'))
assert len(browser['cases']) >= 9 and all(c['pass'] for c in browser['cases']) and not browser['errors']
evidence = {
    'task': '1375e736-e5b6-4bd8-974d-b5ba34e22b42',
    'baseline': '7be7048115981f46c5e2c4f45a549c2349f81b58',
    'verdict': 'INCOMPLETE',
    'technicalVerificationOfImplementedSlice': 'PASS',
    'criteria': {
        'AC1': {'verdict': 'PASS', 'evidence': ['raw/verify-focused.log', 'raw/browser-report.json']},
        'AC2': {'verdict': 'PASS', 'evidence': ['raw/browser-report.json', 'raw/verify-focused.log'], 'limit': 'Live database content and real CAPTCHA/email writes not exercised'},
        'AC3': {'verdict': 'INCOMPLETE', 'evidence': ['coverage.md'], 'reason': 'Final public/app scope unanswered; other public pages and authenticated workspace remain untranslated'},
        'AC4': {'verdict': 'PASS', 'evidence': ['raw/verify-focused.log', 'raw/browser-report.json']},
        'AC5': {'verdict': 'PASS', 'evidence': ['review.md', 'raw/source-manifest.json', 'raw/verify.exit', 'raw/build.exit', 'raw/browser-report.json']},
        'AC6': {'verdict': 'PASS', 'evidence': ['auth-spec.md', 'raw/browser-report.json', 'raw/verify-gate.log'], 'limit': 'Passkey flow source-reviewed; physical authenticator not exercised'},
    },
    'sourceSha256Lf': manifest,
    'checks': {'focusedPassed': 40, 'fullGatePassed': 3375, 'fullGateFailed': 0, 'typecheck': 'PASS', 'lint': 'PASS (3 pre-existing warnings)', 'productionBuild': 'PASS', 'browserCasesPassed': len(browser['cases'])},
    'environment': 'Actual Next.js 16 production build in isolated Linux checkout; unreachable dummy database; browser API writes and CAPTCHA mocked; test-only JWT for signed-in landing/redirects',
    'publication': {'github': 'NOT_PUSHED', 'production': 'NOT_DEPLOYED', 'projectsFlow': 'in_progress'},
    'coverage': 'coverage.md',
}
(TASK / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
report = '''# Evidence — verified partial delivery

**Overall task: INCOMPLETE.** AC3 does not pass: only the main landing, login and registration have English routes. Scope clarification is outstanding; other public pages and the authenticated application are not translated. See `coverage.md`. The ProjectsFlow task remains in progress. No publication or production deployment.

The implemented slice passes current verification: 40 focused tests, all 3375 tests in the full gate, TypeScript, ESLint (no errors; 3 existing warnings), production build, and all browser scenarios in `raw/browser-report.json`. Source hashes are recorded in `raw/source-manifest.json` and checked by `package-evidence.py`. `review.md` records current-source findings and limitations; `problems.md` records failed checks and minimal fixes.

AC1, AC2, AC4, AC5 and the auth addendum AC6 pass for the explicit implemented slice. AC3 remains INCOMPLETE. These results must not be presented as a PASS for the entire English-site task.

Browser coverage: actual English SSR and SEO without JavaScript; RU/EN switching with query/hash and cookie; visible header controls at 320/400/640/768/1024px and two scroll positions; transition into a Russian page; all six QR chapters; equipment controls; registration CAPTCHA/consent/429 and unchanged payload; login, second factor, email-link/reset feedback; support validation; signed-in landing with original-language customer name; auth-layout redirects; sitemap, English PNG preview and 404 for unknown English private/API aliases.

Reproduction: install the repository dependencies, use an isolated database/configuration, run `checks.sh` (adjust its checkout path), run `next build --webpack` and `next start` with a dedicated `NEXT_DIST_DIR`, set `ENGLISH_FIXTURE_URL` to the loopback server, and run `node browser-check.mjs` with Playwright/Chrome installed. Browser auth fixture secret must match the isolated server test secret. Never use this fixture against production. Checks do not create real accounts, send email or complete a real CAPTCHA. Live database values and physical passkey hardware are not exercised.

Raw logs: `raw/verify-*`, `raw/build.log`, `raw/build.exit`; browser report and local screenshots `raw/english-mobile.png`, `raw/english-og.png`. Failed development-server reports are diagnostic history, superseded by the production-build browser run. No new dependency or schema change. Unrelated working-tree changes remain outside the task manifest.
'''
(TASK / 'evidence.md').write_text(report, encoding='utf-8')
paths = subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines()
unrelated = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in paths if name not in manifest and (ROOT / name).is_file()}
(raw / 'unrelated-before-commit.json').write_text(json.dumps(unrelated, indent=2) + '\n')
print('Partial-delivery evidence generated. Technical checks PASS; overall task INCOMPLETE.')
