const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const c = await b.newContext();
  const csrf = await (await c.request.get("http://localhost:3000/api/auth/csrf")).json();
  const r = await c.request.post("http://localhost:3000/api/auth/callback/credentials", { form: { email: "alexey@local.test", password: "AdminPass123!", csrfToken: csrf.csrfToken, json: "true" }, maxRedirects: 0 });
  const enter = await c.request.post("http://localhost:3000/api/root/impersonate", { data: { organizationId: "org-cafe" } });
  const s = await (await c.request.get("http://localhost:3000/api/auth/session")).json();
  console.log(`${process.argv[2]}: login=${r.status()} impersonate=${enter.status()} actingAs=${s?.user?.actingAsOrganizationId} role=${s?.user?.role}`);
  await b.close();
})();
