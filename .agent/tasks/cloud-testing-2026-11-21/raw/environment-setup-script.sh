#!/bin/bash
# HASSR-Online: dependencies, Prisma client and the Playwright MCP package, so that
# `npm run smoke:local` and the playwright MCP server start at once. A failed step is reported
# and skipped: the session still starts.
if [ -d HASSR-Online ]; then
  cd HASSR-Online || exit 0
  npm ci --no-audit --no-fund || echo "setup: npm ci failed"
  npx prisma generate || echo "setup: prisma generate failed"
  npx -y @playwright/mcp@0.0.84 --version || echo "setup: @playwright/mcp download failed"
fi
exit 0
