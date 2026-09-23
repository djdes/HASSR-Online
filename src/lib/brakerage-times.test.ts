import assert from "node:assert/strict";
import test from "node:test";

import {
  addMinutesToLocalDateTime,
  brakerageChainCaption,
  chainBrakerageTimes,
  correctedBrakerageTimes,
  deriveBrakerageTimes,
  withLocalTime,
} from "@/lib/brakerage-times";

/**
 * Время бракеража по умолчанию — изготовление + 5 минут, разрешение к
 * реализации — бракераж + 5 минут (решение владельца). Раньше оба ставились
 * «сейчас» в момент подписи, даже если блюдо приготовили час назад.
 */
test("сдвиг местного времени, в том числе через полночь", () => {
  assert.equal(addMinutesToLocalDateTime("2026-09-22 12:40", 5), "2026-09-22 12:45");
  assert.equal(addMinutesToLocalDateTime("2026-09-22 23:58", 5), "2026-09-23 00:03");
  assert.equal(addMinutesToLocalDateTime("2026-12-31 23:59", 1), "2027-01-01 00:00");
  assert.equal(addMinutesToLocalDateTime("мусор", 5), "");
});

test("пустые времена выводятся из изготовления: +5 и ещё +5", () => {
  assert.deepEqual(deriveBrakerageTimes({ productionDateTime: "2026-09-22 12:40" }), {
    rejectionTime: "2026-09-22 12:45",
    releasePermissionTime: "2026-09-22 12:50",
  });
});

test("заданные вручную времена не трогаем; «не разрешено» — без времени разрешения", () => {
  assert.deepEqual(
    deriveBrakerageTimes({ productionDateTime: "2026-09-22 12:40", rejectionTime: "2026-09-22 13:10", releasePermissionTime: "" }),
    { rejectionTime: "2026-09-22 13:10", releasePermissionTime: "2026-09-22 13:15" }
  );
  assert.deepEqual(
    deriveBrakerageTimes({ productionDateTime: "2026-09-22 12:40", releaseAllowed: "no" }),
    { rejectionTime: "2026-09-22 12:45", releasePermissionTime: "" }
  );
  assert.deepEqual(
    deriveBrakerageTimes({ productionDateTime: "2026-09-22 12:40", offsets: { rejectionAfterProductionMinutes: 10, releaseAfterRejectionMinutes: 0 } }),
    { rejectionTime: "2026-09-22 12:50", releasePermissionTime: "2026-09-22 12:50" }
  );
});

test("без изготовления — пусто (подставит вызывающий: «сейчас»)", () => {
  assert.deepEqual(deriveBrakerageTimes({ productionDateTime: "" }), { rejectionTime: "", releasePermissionTime: "" });
});

test("время ЧЧ:ММ из поля QR ставится на дату строки", () => {
  assert.equal(withLocalTime("2026-09-22 12:40", "13:05"), "2026-09-22 13:05");
  assert.equal(withLocalTime("2026-09-22 12:40", "9:05"), "2026-09-22 09:05");
  assert.equal(withLocalTime("2026-09-22 12:40", "25:00"), null);
});

/**
 * Решение владельца 2026-09-23: при добавлении блюд ставится только время
 * изготовления. Бракераж = +N1, разрешение = бракераж + N2 — сразу в строке.
 */
test("новая строка: время бракеража и разрешения — цепочкой от изготовления", () => {
  assert.deepEqual(chainBrakerageTimes({ productionDateTime: "2026-09-23 12:40" }), {
    rejectionTime: "2026-09-23 12:45",
    releasePermissionTime: "2026-09-23 12:50",
  });
  assert.deepEqual(chainBrakerageTimes({ productionDateTime: "2026-09-23 12:40", releaseAllowed: "no" }), {
    rejectionTime: "2026-09-23 12:45",
    releasePermissionTime: "",
  });
  assert.deepEqual(
    chainBrakerageTimes({ productionDateTime: "2026-09-23 12:40", offsets: { rejectionAfterProductionMinutes: 10, releaseAfterRejectionMinutes: 15 } }),
    { rejectionTime: "2026-09-23 12:50", releasePermissionTime: "2026-09-23 13:05" }
  );
  // Прежние времена (например, от шаблона окна) не держим — считаем заново.
  assert.deepEqual(
    chainBrakerageTimes({ productionDateTime: "2026-09-23 12:40", rejectionTime: "2026-09-23 09:00", releasePermissionTime: "2026-09-23 09:05" }),
    { rejectionTime: "2026-09-23 12:45", releasePermissionTime: "2026-09-23 12:50" }
  );
});

test("коррекция изготовления: у неподписанной строки цепочка сдвигается, у подписанной — нет", () => {
  const row = {
    productionDateTime: "2026-09-23 12:40",
    rejectionTime: "2026-09-23 12:45",
    releasePermissionTime: "2026-09-23 12:50",
    releaseAllowed: "yes",
  };
  assert.deepEqual(correctedBrakerageTimes({ row, nextProductionDateTime: "2026-09-23 13:00", signed: false }), {
    rejectionTime: "2026-09-23 13:05",
    releasePermissionTime: "2026-09-23 13:10",
  });
  assert.deepEqual(correctedBrakerageTimes({ row, nextProductionDateTime: "2026-09-23 13:00", signed: true }), {
    rejectionTime: "2026-09-23 12:45",
    releasePermissionTime: "2026-09-23 12:50",
  });
  assert.deepEqual(correctedBrakerageTimes({ row, nextProductionDateTime: "2026-09-23 12:40", signed: false }), {
    rejectionTime: "2026-09-23 12:45",
    releasePermissionTime: "2026-09-23 12:50",
  });
});

test("подпись в окне добавления: что поставится в бракераж и разрешение", () => {
  assert.equal(
    brakerageChainCaption({ productionDateTime: "2026-09-23 12:40" }),
    "Бракераж — 12:45, разрешение к реализации — 12:50 (через 5 и 5 мин, меняется в настройках журнала)"
  );
  assert.equal(
    brakerageChainCaption({ productionDateTime: "2026-09-23 12:40", releaseAllowed: "no" }),
    "Бракераж — 12:45, без разрешения к реализации (через 5 мин, меняется в настройках журнала)"
  );
  assert.equal(brakerageChainCaption({ productionDateTime: "" }), "Укажите время изготовления — бракераж и разрешение посчитаются сами");
});
