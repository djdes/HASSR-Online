$ErrorActionPreference = 'Continue'
$taskProof = '.agent/tasks/catalog-search-20261116/raw'
$env:PATH = 'C:/Program Files/Git/bin;' + $env:PATH
npx eslint src/components/public/searchable-catalog.tsx src/app/blanki/page.tsx src/app/prikazy/page.tsx "src/app/root/organizations/[id]/client-requisites-card.tsx" *> "$taskProof/verify-lint.log"
$LASTEXITCODE | Set-Content "$taskProof/verify-lint.exit"
if ($LASTEXITCODE -ne 0) { exit 1 }
node --import tsx --test src/lib/journal-search.test.ts src/components/public/public-dark-theme.test.ts src/app/sanpin-2-3-2-4-4282-26/sanpin-page.test.ts src/lib/organization-profile-patch.test.ts src/app/root/requisites/requisites-presentation.test.ts *> "$taskProof/verify-focused.log"
$LASTEXITCODE | Set-Content "$taskProof/verify-focused.exit"
if ($LASTEXITCODE -ne 0) { exit 1 }
node .agent/tasks/catalog-search-20261116/interaction.cjs *> "$taskProof/verify-interaction.log"
$LASTEXITCODE | Set-Content "$taskProof/verify-interaction.exit"
if ($LASTEXITCODE -ne 0) { exit 1 }
node .agent/tasks/catalog-search-20261116/integration.cjs *> "$taskProof/verify-integration.log"
$LASTEXITCODE | Set-Content "$taskProof/verify-integration.exit"
if ($LASTEXITCODE -ne 0) { exit 1 }
npm run test:gate *> "$taskProof/verify-gate.log"
$LASTEXITCODE | Set-Content "$taskProof/verify-gate.exit"
if ($LASTEXITCODE -ne 0) { exit 1 }
npm run typecheck *> "$taskProof/verify-typecheck.log"
$LASTEXITCODE | Set-Content "$taskProof/verify-typecheck.exit"
exit $LASTEXITCODE
