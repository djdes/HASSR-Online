/**
 * A1 integration check against the private worktree DB (wesetup_wt_a) and
 * the local dev server (http://localhost:3031). Creates throw-away orgs,
 * exercises the master-cabinet backend end to end and deletes them.
 *
 * Run: npx tsx .agent/tasks/master-cabinet-2026-09/e2e/a1-integration.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";

import { db } from "@/lib/db";
import { ensureServiceCode, linkDishPool } from "@/lib/dish-pool";
import { createOrInviteMasterCabinet } from "@/lib/master-cabinet";
import { findPoolMasterOrgId, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { pushSharedListsToOrg, withMasterSharedLists } from "@/lib/master-directory-push";
import { listNameSuggestions } from "@/lib/name-suggestions-db";
import { loadOrgDirectory } from "@/lib/org-directory-db";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";

const BASE = process.env.E2E_BASE ?? "http://localhost:3031";
const stamp = Date.now().toString(36);
const log = (...args: unknown[]) => console.log("*", ...args);
const results: Array<{ check: string; ok: boolean; detail?: unknown }> = [];
function check(name: string, fn: () => void, detail?: unknown) {
  try {
    fn();
    results.push({ check: name, ok: true, detail });
    log("PASS", name);
  } catch (err) {
    results.push({ check: name, ok: false, detail: String(err) });
    log("FAIL", name, String(err));
  }
}

type Jar = Map<string, string>;
function absorb(jar: Jar, res: Response) {
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1));
  }
}
async function http(jar: Jar, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (jar.size) headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  const res = await fetch(`${BASE}${path}`, { ...init, headers, redirect: "manual" });
  absorb(jar, res);
  return res;
}
async function login(email: string, password: string): Promise<Jar> {
  const jar: Jar = new Map();
  const res = await http(jar, "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login ${email}: ${res.status} ${await res.text()}`);
  return jar;
}
function docConfig(doc: { config: unknown }) {
  return (doc.config ?? {}) as Record<string, unknown>;
}
const location = (res: Response) => res.headers.get("location") ?? "";

const created: string[] = [];
async function main() {
  const [fpTemplate, prTemplate] = await Promise.all([
    db.journalTemplate.findFirstOrThrow({ where: { code: "finished_product" } }),
    db.journalTemplate.findFirstOrThrow({ where: { code: "perishable_rejection" } }),
  ]);
  const password = "Test12345!";
  const passwordHash = await bcrypt.hash(password, 10);

  async function makeOrg(label: string) {
    const org = await db.organization.create({ data: { name: `E2E ${label} ${stamp}`, type: "cafe" } });
    created.push(org.id);
    const owner = await db.user.create({
      data: {
        name: `Руководитель ${label}`,
        email: `e2e-${label.toLowerCase()}-${stamp}@example.test`,
        passwordHash,
        role: "manager",
        organizationId: org.id,
        isActive: true,
      },
    });
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    const fp = await db.journalDocument.create({
      data: {
        templateId: fpTemplate.id,
        organizationId: org.id,
        title: "БЖГП",
        dateFrom: from,
        dateTo: to,
        config: { rows: [], itemsCatalog: [`Своё блюдо ${label}`], productLists: [] },
      },
    });
    const pr = await db.journalDocument.create({
      data: {
        templateId: prTemplate.id,
        organizationId: org.id,
        title: "Скоропорт",
        dateFrom: from,
        dateTo: to,
        config: {
          rows: [],
          productLists: [{ id: "l1", name: "Изделия", items: [`Своё сырьё ${label}`] }],
          suppliers: [`Свой поставщик ${label}`],
          manufacturers: [],
        },
      },
    });
    return { org, owner, fp, pr };
  }

  const X = await makeOrg("X");
  const Y = await makeOrg("Y");
  const codeX = await ensureServiceCode(X.org.id);
  const linked = await linkDishPool(Y.org.id, codeX);
  assert.ok(!("error" in linked), "Y linked to X");
  await db.nameSuggestion.create({ data: { organizationId: X.org.id, scope: "dish", value: "Пуловое блюдо X" } });

  // Review Focus 1: pool without master — nothing changes.
  const beforeSuggestions = await listNameSuggestions(Y.org.id, "dish");
  const sameConfig = { itemsCatalog: ["a"] };
  const seededWithoutMaster = await withMasterSharedLists(Y.org.id, "finished_product", sameConfig);
  check("RF1: pool without master - suggestions only from pool, config untouched", () => {
    assert.deepEqual(beforeSuggestions.values, ["Пуловое блюдо X"]);
    assert.equal(seededWithoutMaster, sameConfig);
  });

  // Create the cabinet (settings API logic) with an invite link.
  const ownerEarly = await login(X.owner.email, password);
  const createRes = await http(ownerEarly, "/api/settings/master-cabinet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Бэк Офисов", email: `e2e-master-${stamp}@example.test` }),
  });
  const createBody = (await createRes.json()) as {
    created: boolean;
    master: { organizationId: string; name: string };
    inviteUrl: string;
    user: { email: string };
    emailSent: boolean;
  };
  assert.equal(createRes.status, 200, `settings POST ${createRes.status} ${JSON.stringify(createBody)}`);
  const cabinet = {
    masterOrganizationId: createBody.master.organizationId,
    inviteUrl: createBody.inviteUrl,
    user: createBody.user,
  };
  created.push(cabinet.masterOrganizationId);
  log("settings POST", { created: createBody.created, emailSent: createBody.emailSent, name: createBody.master.name });
  const masterOrg = await db.organization.findUniqueOrThrow({ where: { id: cabinet.masterOrganizationId } });
  check(
    "AC-A1: cabinet created as kind=directory in X pool with invite link",
    () => {
      assert.equal(masterOrg.kind, "directory");
      assert.equal(masterOrg.linkedServiceCode, codeX);
      assert.ok(cabinet.inviteUrl.includes("/invite/"));
      assert.ok((masterOrg.disabledJournalCodes as string[]).length > 30);
    },
    { name: masterOrg.name, disabledJournals: (masterOrg.disabledJournalCodes as string[]).length }
  );

  const again = await createOrInviteMasterCabinet({
    organizationId: Y.org.id,
    actorUserId: Y.owner.id,
    name: "Второй Офисов",
    email: `e2e-master2-${stamp}@example.test`,
  });
  check("second POST in the same pool only invites into the existing cabinet", () => {
    assert.equal(again.created, false);
    assert.equal(again.masterOrganizationId, cabinet.masterOrganizationId);
  });
  let conflict = 0;
  await createOrInviteMasterCabinet({
    organizationId: X.org.id,
    actorUserId: X.owner.id,
    name: "Занятый",
    email: Y.owner.email,
  }).catch((err: { status?: number }) => {
    conflict = err.status ?? 0;
  });
  check("email taken by another user -> 409", () => assert.equal(conflict, 409));

  // Accept invite + login as the back-office employee.
  const raw = cabinet.inviteUrl.split("/invite/")[1];
  const acceptJar: Jar = new Map();
  const accept = await http(acceptJar, `/api/invite/${raw}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(accept.status, 200, "invite accept");
  const master = await login(cabinet.user.email, password);

  const dash = await http(master, "/dashboard");
  const journals = await http(master, "/journals");
  const staff = await http(master, "/api/staff");
  const settingsApi = await http(master, "/api/settings/dish-pool");
  check(
    "AC-A2: master session - pages redirect to /master, other APIs 403",
    () => {
      assert.ok([307, 308].includes(dash.status), `dashboard ${dash.status}`);
      assert.ok(location(dash).endsWith("/master"));
      assert.ok(location(journals).endsWith("/master"));
      assert.equal(staff.status, 403);
      assert.equal(settingsApi.status, 403);
    },
    { dashboard: `${dash.status} -> ${location(dash)}`, staff: staff.status, settings: settingsApi.status }
  );

  const get0 = await http(master, "/api/master/directory?kind=dish");
  const get0Body = (await get0.json()) as { total: number; code: string; organizations: Array<{ id: string }> };
  check("GET /api/master/directory - empty list, code and 2 objects", () => {
    assert.equal(get0.status, 200);
    assert.equal(get0Body.total, 0);
    assert.equal(get0Body.code, codeX);
    assert.deepEqual(get0Body.organizations.map((o) => o.id).sort(), [X.org.id, Y.org.id].sort());
  });

  // Menu from xlsx (3 dishes).
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Наименование"], ["Борщ"], ["Плов"], ["Компот"]]), "Меню");
  const xlsx = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const form = new FormData();
  form.set("kind", "dish");
  form.set("file", new Blob([new Uint8Array(xlsx)]), "menu.xlsx");
  const preview = await http(master, "/api/master/directory/preview", { method: "POST", body: form });
  const previewBody = (await preview.json()) as { items: Array<{ name: string }>; diff: { added: string[] } };
  check("AC-A3: xlsx preview shows 3 added", () => {
    assert.equal(preview.status, 200);
    assert.deepEqual(previewBody.diff.added, ["Борщ", "Плов", "Компот"]);
  });
  const putDish = await http(master, "/api/master/directory", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "dish", items: previewBody.items }),
  });
  const putDishBody = await putDish.json();
  log("PUT dish", putDishBody);

  // Raw materials from text.
  const previewText = await http(master, "/api/master/directory/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "product", text: "Молоко | ИП Иванов | Молокозавод\nКефир | ИП Иванов; Творог" }),
  });
  const previewTextBody = (await previewText.json()) as { items: unknown[] };
  const putProduct = await http(master, "/api/master/directory", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "product", items: previewTextBody.items }),
  });
  const putProductBody = await putProduct.json();
  log("PUT product", putProductBody);

  const yFp1 = docConfig(await db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } }));
  const xFp1 = docConfig(await db.journalDocument.findUniqueOrThrow({ where: { id: X.fp.id } }));
  const yPr1 = docConfig(await db.journalDocument.findUniqueOrThrow({ where: { id: Y.pr.id } }));
  check(
    "AC-A3: menu is in active finished_product docs of X and Y (local items kept)",
    () => {
      assert.deepEqual(putDishBody, { total: 3, added: 3, removed: 0, organizations: 2, documents: 4 });
      assert.deepEqual(yFp1.itemsCatalog, ["Своё блюдо Y", "Борщ", "Плов", "Компот"]);
      assert.deepEqual(xFp1.itemsCatalog, ["Своё блюдо X", "Борщ", "Плов", "Компот"]);
    },
    { y: yFp1.itemsCatalog }
  );
  check(
    "AC-A4: raw materials in perishable_rejection - items, suppliers, manufacturers",
    () => {
      assert.equal(putProduct.status, 200);
      const lists = yPr1.productLists as Array<{ items: string[] }>;
      assert.deepEqual(lists[0].items, ["Своё сырьё Y", "Молоко", "Кефир", "Творог"]);
      assert.deepEqual(yPr1.suppliers, ["Свой поставщик Y", "ИП Иванов"]);
      assert.deepEqual(yPr1.manufacturers, ["Молокозавод"]);
    },
    { items: (yPr1.productLists as Array<{ items: string[] }>)[0].items, suppliers: yPr1.suppliers }
  );

  const dishSug = await listNameSuggestions(Y.org.id, "dish");
  const productSug = await listNameSuggestions(Y.org.id, "product");
  const supplierDir = await loadOrgDirectory(Y.org.id, "supplier");
  const dishDir = await loadOrgDirectory(Y.org.id, "dish");
  check(
    "AC-A3/A4: suggestions (site + QR API) and org directory read master lists",
    () => {
      assert.deepEqual(dishSug.values, ["Пуловое блюдо X", "Борщ", "Плов", "Компот"]);
      assert.deepEqual(productSug.values, ["Молоко", "Кефир", "Творог"]);
      assert.ok(supplierDir.includes("ИП Иванов"));
      assert.ok(dishDir.includes("Плов"));
    },
    { dishSug: dishSug.values, productSug: productSug.values }
  );

  // Remove one dish at the master.
  const putDish2 = await http(master, "/api/master/directory", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "dish", items: [{ name: "Борщ" }, { name: "Компот" }] }),
  });
  const putDish2Body = await putDish2.json();
  const yFp2 = docConfig(await db.journalDocument.findUniqueOrThrow({ where: { id: Y.fp.id } }));
  check(
    "AC-A5: removing one dish at the master removes only it; local dish stays",
    () => {
      assert.deepEqual(putDish2Body, { total: 2, added: 0, removed: 1, organizations: 2, documents: 4 });
      assert.deepEqual(yFp2.itemsCatalog, ["Своё блюдо Y", "Борщ", "Компот"]);
    },
    { y: yFp2.itemsCatalog }
  );

  // New document seeding (same path as POST /api/journal-documents and cron auto-create).
  const seeded = await prefillResponsiblesForNewDocument({ organizationId: Y.org.id, journalCode: "finished_product" });
  const seededPr = await prefillResponsiblesForNewDocument({ organizationId: Y.org.id, journalCode: "perishable_rejection" });
  check("AC-A6: new finished_product/perishable document of a pool org has the master lists", () => {
    assert.deepEqual(seeded.config.itemsCatalog, ["Борщ", "Компот"]);
    assert.deepEqual(seeded.config.sharedCatalog, ["Борщ", "Компот"]);
    const lists = seededPr.config.productLists as Array<{ items: string[] }>;
    assert.deepEqual(lists[0].items, ["Молоко", "Кефир", "Творог"]);
  });

  // Late joiner Z: link to the code -> gets the lists (same calls as the dish-pool route).
  const Z = await makeOrg("Z");
  const zJar = await login(Z.owner.email, password);
  const linkRes = await http(zJar, "/api/settings/dish-pool", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: codeX, confirm: true }),
  });
  const linkBody = (await linkRes.json()) as { masterDocuments?: number };
  const masterForZ = await findPoolMasterOrgId(Z.org.id);
  const pushedZ = { documents: linkBody.masterDocuments ?? -1 };
  void pushSharedListsToOrg;
  const zFp = docConfig(await db.journalDocument.findUniqueOrThrow({ where: { id: Z.fp.id } }));
  check("AC-A6: org joining the code later receives the lists on link", () => {
    assert.equal(masterForZ, cabinet.masterOrganizationId);
    assert.equal(pushedZ.documents, 2);
    assert.deepEqual(zFp.itemsCatalog, ["Своё блюдо Z", "Борщ", "Компот"]);
  });

  // Review Focus 4: crons skip the directory org.
  const cronOrgs = await db.organization.findMany({
    where: {
      id: { in: [X.org.id, cabinet.masterOrganizationId] },
      subscriptionPlan: { notIn: ["paused", "cancelled"] },
      ...NOT_DIRECTORY_ORG_WHERE,
    },
    select: { id: true },
  });
  check("AC-A7: cron organization queries skip kind=directory", () => {
    assert.deepEqual(cronOrgs.map((o) => o.id), [X.org.id]);
  });

  // Regular session: /master closed; the creator can switch into the cabinet.
  const owner = await login(X.owner.email, password);
  const ownerMaster = await http(owner, "/master");
  const ownerMasterApi = await http(owner, "/api/master/directory?kind=dish");
  const ownerSettings = await http(owner, "/api/settings/master-cabinet");
  const ownerSettingsBody = (await ownerSettings.json()) as {
    code: string;
    master: { users: Array<{ invited: boolean }> };
  };
  check("regular session: /master -> /dashboard, /api/master -> 403, settings GET works", () => {
    assert.ok(location(ownerMaster).endsWith("/dashboard"));
    assert.equal(ownerMasterApi.status, 403);
    assert.equal(ownerSettings.status, 200);
    assert.equal(ownerSettingsBody.code, codeX);
    assert.equal(ownerSettingsBody.master.users.length, 2);
    assert.equal(ownerSettingsBody.master.users.filter((u) => !u.invited).length, 1);
  });
  const sw = await http(owner, "/api/me/active-organization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: cabinet.masterOrganizationId }),
  });
  const afterSwitch = await http(owner, "/dashboard");
  const masterApiAfterSwitch = await http(owner, "/api/master/directory?kind=product");
  check("creator switches into the cabinet: orgKind in token -> /dashboard redirects to /master", () => {
    assert.equal(sw.status, 200);
    assert.ok(location(afterSwitch).endsWith("/master"));
    assert.equal(masterApiAfterSwitch.status, 200);
  });
  const back = await http(owner, "/api/me/active-organization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId: X.org.id }),
  });
  const dashAfterBack = await http(owner, "/dashboard");
  check(
    "switch back to the kitchen restores normal access",
    () => {
      assert.equal(back.status, 200);
      assert.notEqual(location(dashAfterBack).endsWith("/master"), true);
    },
    { dashboard: dashAfterBack.status }
  );

  const audits = await db.auditLog.findMany({
    where: {
      action: { in: ["master_cabinet.created", "master_cabinet.invited", "master_directory.updated"] },
      organizationId: { in: created },
    },
    select: { action: true },
  });
  check(
    "audit log records master_directory.updated",
    () => {
      assert.ok(audits.some((a) => a.action === "master_directory.updated"));
    },
    [...new Set(audits.map((a) => a.action))]
  );
}

main()
  .catch((err) => {
    console.error(err);
    results.push({ check: "script", ok: false, detail: String(err) });
  })
  .finally(async () => {
    await db.organization.deleteMany({ where: { id: { in: created } } }).catch((err) => console.error("cleanup", err));
    const failed = results.filter((r) => !r.ok);
    console.log(JSON.stringify({ passed: results.length - failed.length, failed: failed.length, results }, null, 2));
    await db.$disconnect();
    process.exit(failed.length ? 1 : 0);
  });
