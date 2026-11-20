/**
 * Environment of the e2e scenarios: the repository's `.env`, found from this file — not from the
 * current directory — so a scenario reads the same settings wherever it is started from. Variables
 * already set (CI passes them directly) are never overridden. `DOTENV_CONFIG_PATH` points elsewhere
 * (e.g. `/dev/null` to run with the process environment only, as in CI).
 */
import path from "node:path";

import { config } from "dotenv";

config({ path: process.env.DOTENV_CONFIG_PATH || path.resolve(__dirname, "../../.env"), quiet: true });
