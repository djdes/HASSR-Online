/**
 * Environment of the e2e scenarios: the repository's `.env`, found from this file — not from the
 * current directory — so a scenario reads the same settings wherever it is started from. Variables
 * already set (CI passes them directly) are never overridden. `DOTENV_CONFIG_PATH` points elsewhere
 * (e.g. `/dev/null` to run with the process environment only, as in CI).
 *
 * The scenarios create and delete organizations, accounts and links: they refuse to run against a
 * database that is not local — host localhost, 127.0.0.1, ::1, a Unix socket, or `postgres` (the
 * CI service) — unless `E2E_ALLOW_REMOTE_DB=1` says it is on purpose.
 */
import path from "node:path";

import { config } from "dotenv";

config({ path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../.env"), quiet: true });

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres", ""]);

function dbHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

if (process.env.E2E_ALLOW_REMOTE_DB !== "1") {
  // db.ts connects to DATABASE_URL_DIRECT, else DATABASE_URL: both must be local.
  const urls = (["DATABASE_URL_DIRECT", "DATABASE_URL"] as const).filter((name) => process.env[name]);
  const remote = urls.filter((name) => !LOCAL_DB_HOSTS.has(dbHost(process.env[name]!) ?? "?"));
  if (urls.length === 0 || remote.length > 0) {
    console.error(
      urls.length === 0
        ? "e2e: DATABASE_URL is not set — refusing to run."
        : `e2e: refusing to run against a non-local database (${remote.map((name) => `${name} host «${dbHost(process.env[name]!) ?? "unparsable"}»`).join(", ")}). ` +
            "The scenarios write and delete data; allowed hosts: localhost, 127.0.0.1, ::1, a Unix socket, postgres (CI service). " +
            "Set E2E_ALLOW_REMOTE_DB=1 only for a throwaway database.",
    );
    process.exit(1);
  }
}
