import assert from "node:assert/strict";
import test from "node:test";

import { dishShareOrgIds, type DishShareOrg } from "@/lib/dish-pool-share";

const CODE = "CABNT-00000";
const org = (id: string, accountId: string | null, over: Partial<DishShareOrg> = {}): DishShareOrg => ({
  id,
  accountId,
  kind: "restaurant",
  serviceCode: null,
  linkedServiceCode: CODE,
  ...over,
});

// Кабинет владельца (хозяин кода), две его организации, две компании других аккаунтов и организация без аккаунта.
const cabinet = org("cabinet", "owner", { kind: "directory", serviceCode: CODE, linkedServiceCode: null });
const ownerA = org("ownerA", "owner");
const ownerB = org("ownerB", "owner");
const companyA = org("companyA", "acc-a");
const companyA2 = org("companyA2", "acc-a");
const companyB = org("companyB", "acc-b");
const legacy = org("legacy", null);
const all = [cabinet, ownerA, ownerB, companyA, companyA2, companyB, legacy];
const ids = all.map((item) => item.id);

test("компания видит своё и кабинет владельца, но не другую компанию", () => {
  assert.deepEqual(dishShareOrgIds("companyA", ids, all), ["cabinet", "ownerA", "ownerB", "companyA", "companyA2"]);
  assert.deepEqual(dishShareOrgIds("companyB", ids, all), ["cabinet", "ownerA", "ownerB", "companyB"]);
});

test("организации владельца не получают названий компаний", () => {
  assert.deepEqual(dishShareOrgIds("ownerA", ids, all), ["cabinet", "ownerA", "ownerB"]);
  assert.deepEqual(dishShareOrgIds("cabinet", ids, all), ["cabinet", "ownerA", "ownerB"]);
});

test("организация без аккаунта — сама себе компания", () => {
  assert.deepEqual(dishShareOrgIds("legacy", ids, all), ["cabinet", "ownerA", "ownerB", "legacy"]);
  assert.equal(dishShareOrgIds("ownerA", ids, all).includes("legacy"), false);
});

test("кабинет, подключённый к коду организации: хозяин кода — тоже сторона кабинета", () => {
  const root = org("root", "owner", { serviceCode: CODE, linkedServiceCode: null });
  const linkedCabinet = org("cab2", "owner", { kind: "directory", serviceCode: "OTHER-00000" });
  const pool = [root, linkedCabinet, companyA, companyB];
  assert.deepEqual(dishShareOrgIds("companyA", pool.map((item) => item.id), pool), ["root", "cab2", "companyA"]);
});

test("пул без мастер-кабинета и пул из одной организации — как раньше", () => {
  const plain = [org("p1", "x", { serviceCode: CODE, linkedServiceCode: null }), org("p2", "y"), org("p3", null)];
  assert.deepEqual(dishShareOrgIds("p2", ["p1", "p2", "p3"], plain), ["p1", "p2", "p3"]);
  assert.deepEqual(dishShareOrgIds("solo", ["solo"], [org("solo", "z")]), ["solo"]);
  // Своя организация — всегда первой, если пул её не вернул.
  assert.deepEqual(dishShareOrgIds("solo", [], []), ["solo"]);
});

test("точка, подключённая к пулу своим кодом: сторона кабинета — по коду пула точки", () => {
  // Организация точки сама в другом пуле (или без него); пул — по коду точки.
  const pointOrg = org("pointOrg", "acc-a", { serviceCode: "OWNCD-00000", linkedServiceCode: null });
  const pool = [cabinet, ownerA, companyB, pointOrg];
  const poolIds = ["cabinet", "ownerA", "companyB"];
  assert.deepEqual(dishShareOrgIds("pointOrg", poolIds, pool, CODE), ["pointOrg", "cabinet", "ownerA"]);
  // Без кода пула точки хозяин кода не находится, но кабинет пула всё равно — сторона кабинета.
  assert.deepEqual(dishShareOrgIds("pointOrg", poolIds, pool), ["pointOrg", "cabinet", "ownerA"]);
});
