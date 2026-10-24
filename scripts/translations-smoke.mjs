// Read-only smoke check of the translation editor on a running site.
// Logs in as ROOT and checks the editor page, its APIs and the translator
// list. Credentials come only from the environment (GitHub Actions secrets):
//   SMOKE_BASE_URL (default https://wesetup.ru), SMOKE_ROOT_EMAIL,
//   SMOKE_ROOT_PASSWORD, optional SMOKE_TRANSLATOR_EMAIL.
// Nothing is written: no overrides are saved, no rights change.

const base = (process.env.SMOKE_BASE_URL || "https://wesetup.ru").replace(/\/+$/, "");
const email = process.env.SMOKE_ROOT_EMAIL;
const password = process.env.SMOKE_ROOT_PASSWORD;
const translator = process.env.SMOKE_TRANSLATOR_EMAIL;
if (!email || !password) {
  console.error("Set SMOKE_ROOT_EMAIL and SMOKE_ROOT_PASSWORD");
  process.exit(2);
}

const jar = new Map();
function remember(response) {
  for (const line of response.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(";");
    const index = pair.indexOf("=");
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1));
  }
}
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
async function call(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, redirect: "manual", headers: { ...init.headers, cookie: cookie() } });
  remember(response);
  return response;
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const csrf = await (await call("/api/auth/csrf")).json();
await call("/api/auth/callback/credentials", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ email, password, csrfToken: csrf.csrfToken, json: "true" }),
});
const session = await (await call("/api/auth/session")).json().catch(() => ({}));
check("root login", session?.user?.isRoot === true);

const page = await call("/root/translations");
check("/root/translations opens", page.status === 200, String(page.status));

const categories = await call("/api/translations/categories");
const body = categories.ok ? await categories.json() : { categories: [] };
const total = body.categories.reduce((sum, item) => sum + item.total, 0);
check("categories API", categories.ok && body.categories[0]?.id === "journal-hygiene" && total > 10000, `${body.categories.length} categories, ${total} strings`);

const entries = await call("/api/translations?category=journal-hygiene&limit=5");
check("hygiene strings API", entries.ok && (await entries.json()).entries.length > 0, String(entries.status));

if (translator) {
  const list = await call("/api/root/translators");
  const rows = list.ok ? (await list.json()).translators : [];
  check(`translator ${translator} has access`, rows.some((row) => row.email.toLowerCase() === translator.toLowerCase()));
}

process.exit(results.every(Boolean) ? 0 : 1);
