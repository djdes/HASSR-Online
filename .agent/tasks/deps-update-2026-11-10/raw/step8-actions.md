# Step 8: actions/checkout v7 + actions/setup-node v7 (Dependabot #134, #136)

Files: deploy.yml (checkout x4, setup-node x2), gogetlinks-check.yml, screenshots.yml, translations-smoke.yml.
mobile-*.yml and setup-helper-check.yml already used checkout@v7 / setup-node@v7 successfully.

Release notes checked (actions/checkout CHANGELOG, actions/setup-node README "Breaking changes"):
- checkout v5: runs on Node 24 (removes the "Node.js 20 is deprecated" warning in every deploy log).
- checkout v6: credentials persisted to a separate file — no workflow here pushes with git after checkout.
- checkout v7: blocks checking out fork PRs for pull_request_target / workflow_run — none of these
  workflows use those triggers (deploy: push/workflow_dispatch; gogetlinks-check: pull_request;
  screenshots, translations-smoke: workflow_dispatch). sparse-checkout and fetch-depth unchanged.
- setup-node v5/v6: npm cache auto-enabled when package.json has `packageManager`/`devEngines.packageManager`
  set to npm. package.json has neither, but deploy.yml intentionally keeps the npm cache off, so both
  setup-node steps there now set `package-manager-cache: false` explicitly (also the action's own
  recommendation for workflows with secrets).
- setup-node v7: dummy NODE_AUTH_TOKEN fallback removed — only matters with `registry-url`, not used.

Local checks: YAML parses (deploy.yml 6 jobs), src/lib/deploy-scripts.test.ts 16/0, no test pins action versions.
Live checks: gogetlinks-check runs on this PR (its own workflow file changed) with checkout@v7 + setup-node@v7;
deploy.yml is exercised by the deploy run after merge. A checkout failure there happens before any SSH
step, so the server would not be touched.
