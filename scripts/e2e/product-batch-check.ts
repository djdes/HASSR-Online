/*
 * Products of the directory exchange created in a batch (series E, Р3; review finding 3): a product
 * that appears in the receiving organization after the batch read its taken names (created by hand,
 * active or turned off, any letter case) is not duplicated at flush — the row is a «conflict», as the
 * one-by-one path (`createEntityRow`) would return. Names with LIKE wildcards (`%`, `_`, `\`) go one by
 * one, in queue order, with the one-by-one rule. Several organizations in one flush are checked
 * separately. Builds its own organizations in the local database and removes them.
 *
 *   npx tsx scripts/e2e/product-batch-check.ts
 */
import "./env";

import { db } from "@/lib/db";
import { createEntityRow, exchangeRowFromFields } from "@/lib/directory-exchange/entities.server";
import { ProductCreateBatch } from "@/lib/directory-exchange/product-batch.server";

const TAG = `pbchk${Date.now().toString(36)}`;
const orgIds: string[] = [];
let failed = 0;

function check(label: string, ok: boolean, extra?: unknown) {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${!ok && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
}

async function makeOrg(name: string) {
  const org = await db.organization.create({ data: { name: `${name} ${TAG}`, type: "restaurant" } });
  orgIds.push(org.id);
  return org;
}

const source = (name: string) => exchangeRowFromFields("product", { id: `src-${name}`, fields: { name, kind: "raw", unit: "kg" } });
const countNamed = (organizationId: string, name: string) =>
  db.product.count({ where: { organizationId, name: { equals: name, mode: "insensitive" } } });

async function main() {
  const a = await makeOrg("Пачка A");
  const b = await makeOrg("Пачка B");
  await db.product.createMany({
    data: [
      { organizationId: a.id, name: "Молоко", kind: "raw", unit: "l" },
      { organizationId: a.id, name: "Кефир", kind: "raw", unit: "l", isActive: false },
      { organizationId: a.id, name: "Сыр-1", kind: "raw", unit: "kg" },
    ],
  });

  const batch = new ProductCreateBatch<string>();
  // Прочитано при первом добавлении: «Молоко» и выключенный «Кефир» заняты сразу.
  check("taken at read time (any case, turned off too) — conflict at once", (await batch.add("молоко", a.id, source("молоко"))) === "conflict" && (await batch.add("КЕФИР", a.id, source("КЕФИР"))) === "conflict");
  const queued: string[] = [];
  for (const [label, organizationId, name] of [
    ["a:Сметана", a.id, "Сметана"],
    ["a:Творог", a.id, "Творог"],
    ["a:Сыр", a.id, "Сыр"],
    ["a:Масло", a.id, "Масло"],
    ["a:Мас_о", a.id, "Мас_о"],
    ["a:Сыр_1", a.id, "Сыр_1"],
    ["a:100% сок", a.id, "100% сок"],
    ["a:Йогурт", a.id, "Йогурт"],
    ["b:Сметана", b.id, "Сметана"],
    ["b:Ряженка", b.id, "Ряженка"],
  ] as const) {
    if ((await batch.add(label, organizationId, source(name))) === "queued") queued.push(label);
  }
  check("ten creations queued", queued.length === 10 && batch.size === 10, queued);

  // Между чтением и записью: в A руками завели «СМЕТАНА» (активную) и «творог» (выключенный), в B — «ряженка».
  await db.product.create({ data: { organizationId: a.id, name: "СМЕТАНА", kind: "raw", unit: "kg" } });
  await db.product.create({ data: { organizationId: a.id, name: "творог", kind: "raw", unit: "kg", isActive: false } });
  await db.product.create({ data: { organizationId: b.id, name: "ряженка", kind: "raw", unit: "l" } });

  const results = await batch.flush();
  const outcome = Object.fromEntries(results.map((result) => [result.item, result.outcome.status]));
  console.log("flush:", JSON.stringify(outcome));
  check("every queued creation has one result, in queue order", results.map((result) => result.item).join("|") === queued.join("|"), results.map((result) => result.item));
  check("names taken after the read are «conflict», not errors", outcome["a:Сметана"] === "conflict" && outcome["a:Творог"] === "conflict" && outcome["b:Ряженка"] === "conflict" && results.every((result) => !result.failed));
  check("free names are created", outcome["a:Сыр"] === "created" && outcome["a:Масло"] === "created" && outcome["a:Йогурт"] === "created" && outcome["b:Сметана"] === "created");
  check(
    "no duplicates: one «сметана» and one «творог» in A, one «ряженка» in B; B's «Сметана» created (other organization)",
    (await countNamed(a.id, "сметана")) === 1 && (await countNamed(a.id, "творог")) === 1 && (await countNamed(b.id, "ряженка")) === 1 && (await countNamed(b.id, "сметана")) === 1,
  );

  // Знаки шаблона — по одному и по порядку: «Мас_о» после «Масло» занято (ILIKE), «Сыр_1» — из-за «Сыр-1», «100% сок» свободно.
  check("wildcard names follow the one-by-one rule in queue order", outcome["a:Мас_о"] === "conflict" && outcome["a:Сыр_1"] === "conflict" && outcome["a:100% сок"] === "created", outcome);
  const c = await makeOrg("Пачка C");
  await db.product.create({ data: { organizationId: c.id, name: "Сыр-1", kind: "raw", unit: "kg" } });
  const oneByOne = await createEntityRow("product", c.id, source("Сыр_1"), null);
  check("the one-by-one path gives the same answer for «Сыр_1» next to «Сыр-1»", oneByOne.status === "conflict", oneByOne);

  // После записи: те же названия снова — «занято» (прочитанное после записи учитывает и созданное, и заведённое руками).
  check("after the flush the created and hand-made names are taken", (await batch.add("again", a.id, source("ЙОГУРТ"))) === "conflict" && (await batch.add("again2", a.id, source("сметана"))) === "conflict");
  check("an empty flush is a no-op", (await new ProductCreateBatch<string>().flush()).length === 0);
}

async function cleanup() {
  await db.product.deleteMany({ where: { organizationId: { in: orgIds } } });
  for (const id of orgIds) await db.organization.delete({ where: { id } }).catch(() => undefined);
  console.log(`cleanup: organizations left ${await db.organization.count({ where: { name: { contains: TAG } } })}`);
}

main()
  .catch((error) => {
    failed += 1;
    console.error("FAIL script crashed", error);
  })
  .finally(async () => {
    await cleanup().catch((error) => console.error("cleanup failed", error));
    console.log(failed === 0 ? "RESULT: all checks passed" : `RESULT: ${failed} check(s) failed`);
    await db.$disconnect().catch(() => undefined);
    process.exit(failed === 0 ? 0 : 1);
  });
