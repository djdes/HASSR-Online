import assert from "node:assert/strict";
import test from "node:test";

import { ORG_SPHERES } from "@/lib/org-profile";

import {
  BRAKERAGE_CODE,
  TODAY_STORAGE,
  brakerageDishesOn,
  buildTodayView,
  cleaningMarkedOn,
  registerFilledOn,
  sphereToday,
  todayAndYesterdayKeys,
  todayJournalCodes,
} from "./today";

test("у каждой сферы свой адресат, заголовок и табличка; у каждой отметки известен способ хранения", () => {
  for (const { value } of ORG_SPHERES) {
    const spec = sphereToday(value);
    assert.ok(spec.audience && spec.title && spec.lead, value);
    assert.ok(spec.signTitle && spec.signLead.includes("код"), value);
    assert.ok(spec.facts.length > 0, value);
    if (spec.dishes !== "none") assert.ok(spec.dishesTitle, value);
    for (const code of todayJournalCodes(spec)) {
      assert.ok(TODAY_STORAGE[code], `${value}: нет способа хранения для ${code}`);
    }
  }
});

test("школа — родителям: блюда списком, суточные пробы и витаминизация; кафе — гостям, блюда числом", () => {
  const school = sphereToday("education");
  assert.equal(school.audience, "Родителям");
  assert.equal(school.dishes, "list");
  assert.deepEqual(
    school.facts.map((item) => item.key),
    ["staff", "samples", "vitamins", "cold", "cleaning"],
  );
  assert.equal(sphereToday("medical").audience, "Пациентам и родственникам");
  assert.equal(sphereToday("medical").dishes, "list");
  assert.equal(sphereToday("cafe").audience, "Гостям");
  assert.equal(sphereToday("cafe").dishes, "count");
  assert.equal(sphereToday("canteen").dishes, "list");
  assert.deepEqual(sphereToday("fitness").facts.map((item) => item.key), ["pool", "cleaning"]);
  assert.deepEqual(sphereToday("beauty").facts.map((item) => item.key), ["sterilization", "cleaning"]);
  assert.equal(sphereToday("retail").dishes, "none");
  assert.ok(!todayJournalCodes(sphereToday("retail")).includes(BRAKERAGE_CODE));
});

test("уборка: отмечено хоть одно помещение в этот день", () => {
  const config = { matrix: { room1: { "2026-10-30": "" }, room2: { "2026-10-31": "✓" } } };
  assert.equal(cleaningMarkedOn(config, "2026-10-31"), true);
  assert.equal(cleaningMarkedOn(config, "2026-10-30"), false);
  assert.equal(cleaningMarkedOn(null, "2026-10-31"), false);
});

test("реестр: строка с датой дня", () => {
  const config = { rows: [{ id: "a", values: { date: "2026-10-31", dish: "Суп" } }, { id: "b", values: { date: "2026-10-30" } }] };
  assert.equal(registerFilledOn(config, "date", "2026-10-31"), true);
  assert.equal(registerFilledOn(config, "date", "2026-10-29"), false);
  assert.equal(registerFilledOn({}, "date", "2026-10-31"), false);
});

test("бракераж: только блюда дня и только безопасные для показа поля", () => {
  const config = {
    rows: [
      {
        productionDateTime: "2026-10-31T11:40",
        rejectionTime: "11:45",
        productName: "Суп гороховый",
        portionWeight: "200",
        organolepticResult: "Отлично",
        releaseAllowed: "yes",
        inspectorName: "Иванова А. А.",
        responsiblePerson: "Петров",
      },
      { productionDateTime: "2026-10-31T08:10", rejectionTime: "", productName: "Каша овсяная", releaseAllowed: "no" },
      { productionDateTime: "2026-10-30T12:00", productName: "Вчерашнее блюдо" },
      { productionDateTime: "2026-10-31T09:00", productName: "  " },
    ],
  };
  const dishes = brakerageDishesOn(config, "2026-10-31");
  assert.equal(dishes.length, 2);
  assert.deepEqual(dishes[0], { name: "Суп гороховый", weight: "200", time: "11:45", rating: "Отлично", allowed: true });
  assert.deepEqual(dishes[1], { name: "Каша овсяная", weight: null, time: "08:10", rating: null, allowed: false });
  assert.ok(!JSON.stringify(dishes).includes("Иванова"));
});

test("ключи дня: сегодня и вчера через границу месяца", () => {
  assert.deepEqual(todayAndYesterdayKeys("2026-11-01"), { today: "2026-11-01", yesterday: "2026-10-31" });
});

test("итог: отметки только по ведущимся журналам, гигиена или журнал здоровья, блюда по времени", () => {
  const spec = sphereToday("education");
  const view = buildTodayView(spec, {
    kept: new Set(["health_check", "daily_samples", "cleaning", BRAKERAGE_CODE]),
    filledToday: new Set(["health_check", "daily_samples"]),
    filledYesterday: new Set(["health_check", "daily_samples", "cleaning"]),
    dishes: [
      { name: "Компот", weight: "200", time: "12:30", rating: null, allowed: true },
      { name: "Каша", weight: "180", time: "08:15", rating: null, allowed: true },
    ],
  });
  assert.deepEqual(
    view.facts.map((item) => [item.key, item.today, item.yesterday]),
    [
      ["staff", true, true],
      ["samples", true, true],
      ["cleaning", false, true],
    ],
  );
  assert.deepEqual(view.dishes.map((dish) => dish.name), ["Каша", "Компот"]);
  assert.equal(view.keepsBrakerage, true);

  const shop = buildTodayView(sphereToday("retail"), {
    kept: new Set(["cold_equipment_control"]),
    filledToday: new Set(),
    filledYesterday: new Set(),
    dishes: [{ name: "x", weight: null, time: null, rating: null, allowed: true }],
  });
  assert.deepEqual(shop.dishes, []);
  assert.equal(shop.keepsBrakerage, false);
});
