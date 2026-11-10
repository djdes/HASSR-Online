import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TopvisorError,
  buildMatrix,
  mapLogicalRegionsToProject,
  parsePosition,
  parsePositionKey,
  summarize,
  unwrap,
} from "@/lib/topvisor";

describe("unwrap", () => {
  it("возвращает result, когда errors пуст", () => {
    assert.deepEqual(unwrap<{ a: number }>({ result: { a: 1 }, errors: null }), {
      a: 1,
    });
  });

  it("бросает TopvisorError при непустом errors, хотя HTTP был 200", () => {
    // Главная ловушка Topvisor: ошибка приезжает со статусом 200,
    // поэтому res.ok проверять бесполезно.
    assert.throws(
      () =>
        unwrap({
          result: null,
          errors: [{ code: 53, string: "Header 'User-Id' is missing" }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof TopvisorError);
        assert.equal(error.code, 53);
        assert.match(error.message, /User-Id/);
        return true;
      }
    );
  });

  it("не считает ошибкой пустой массив errors", () => {
    assert.equal(unwrap<number>({ result: 145, errors: [] }), 145);
  });
});

describe("parsePosition", () => {
  it("превращает строку в число", () => {
    assert.equal(parsePosition("14"), 14);
  });

  it('считает "--" отсутствием позиции, а не нулём', () => {
    assert.equal(parsePosition("--"), null);
  });

  it("не отдаёт NaN на мусоре и пустоте", () => {
    for (const raw of ["", "   ", "abc", undefined, null]) {
      assert.equal(parsePosition(raw), null);
    }
  });
});

describe("parsePositionKey", () => {
  it("разбирает составной ключ <дата>:<проект>:<регион>", () => {
    assert.deepEqual(parsePositionKey("2026-09-07:32866188:1"), {
      date: "2026-09-07",
      projectId: 32866188,
      regionIndex: 1,
    });
  });

  it("отвергает ключи неверной формы", () => {
    for (const key of ["2026-09-07", "x:y:z", "2026-09-07:32866188"]) {
      assert.equal(parsePositionKey(key), null);
    }
  });
});

/** Форма ответа снята с боевого get/positions_2/history. */
const RAW = {
  headers: { dates: ["2026-09-09", "2026-09-07"] },
  keywords: [
    {
      name: "журналы хассп",
      positionsData: {
        "2026-09-07:32866188:1": {
          position: "14",
          relevant_url: "https://wesetup.ru/zhurnal-haccp",
        },
        "2026-09-09:32866188:1": {
          position: "17",
          relevant_url: "https://wesetup.ru/blanki",
        },
      },
    },
    {
      name: "гигиенический журнал",
      positionsData: {
        "2026-09-09:32866188:1": { position: "--" },
      },
    },
  ],
  existsDates: ["2026-09-07", "2026-09-09"],
};

describe("buildMatrix", () => {
  it("строит матрицу с датами по убыванию", () => {
    const matrix = buildMatrix(RAW);
    assert.deepEqual(matrix.dates, ["2026-09-09", "2026-09-07"]);
    assert.equal(matrix.rows.length, 2);
  });

  it("берёт свежую позицию и страницу, которой ответил поисковик", () => {
    const row = buildMatrix(RAW).rows[0];
    assert.equal(row.latest, 17);
    assert.equal(row.latestUrl, "https://wesetup.ru/blanki");
  });

  it("считает падение отрицательной дельтой, а рост положительной", () => {
    // Было 14-е, стало 17-е — это ухудшение на 3 пункта.
    assert.equal(buildMatrix(RAW).rows[0].delta, -3);
  });

  it('фразу вне выдачи оставляет без позиции, не роняя матрицу', () => {
    const row = buildMatrix(RAW).rows[1];
    assert.equal(row.latest, null);
    assert.equal(row.byDate["2026-09-09"].position, null);
  });

  it("восстанавливает даты из ключей, когда headers пуст", () => {
    const matrix = buildMatrix({ ...RAW, headers: null });
    assert.deepEqual(matrix.dates, ["2026-09-09", "2026-09-07"]);
  });

  it("не падает на пустом и мусорном ответе", () => {
    assert.deepEqual(buildMatrix(null).rows, []);
    assert.deepEqual(buildMatrix({ keywords: [{ name: "" }] }).rows, []);
  });
});

describe("summarize", () => {
  it("считает ТОП-3/10/50 накопительно на свежую дату", () => {
    const matrix = buildMatrix({
      headers: { dates: ["2026-09-09"] },
      keywords: [
        { name: "a", positionsData: { "2026-09-09:1:1": { position: "2" } } },
        { name: "b", positionsData: { "2026-09-09:1:1": { position: "9" } } },
        { name: "c", positionsData: { "2026-09-09:1:1": { position: "44" } } },
        { name: "d", positionsData: { "2026-09-09:1:1": { position: "88" } } },
        { name: "e", positionsData: { "2026-09-09:1:1": { position: "--" } } },
      ],
    });
    const summary = summarize(matrix);
    assert.equal(summary.top3, 1);
    assert.equal(summary.top10, 2);
    assert.equal(summary.top50, 3);
    assert.equal(summary.outside, 2);
    assert.equal(summary.tracked, 5);
  });

  it("отдаёт нули, когда съёмов ещё не было", () => {
    assert.deepEqual(summarize(buildMatrix({})), {
      top3: 0,
      top10: 0,
      top50: 0,
      outside: 0,
      tracked: 0,
    });
  });
});

describe("mapLogicalRegionsToProject", () => {
  it("сопоставляет слоты 1/5/2/7 с реальными region.index проекта в Topvisor", () => {
    const searchers = [
      {
        key: 0,
        name: "Яндекс",
        enabled: 1,
        regions: [
          { index: "11", key: 225, areaName: "Россия", enabled: 1 },
          { index: "12", key: 213, areaName: "Москва", enabled: 1 },
        ],
      },
      {
        key: 1,
        name: "Google",
        enabled: 1,
        regions: [
          { index: "13", key: 225, areaName: "Россия", enabled: 1 },
          { index: "14", key: 213, areaName: "Москва", enabled: 1 },
        ],
      },
    ];

    assert.deepEqual(mapLogicalRegionsToProject([1, 5], searchers), [12, 11]);
    assert.deepEqual(mapLogicalRegionsToProject([2, 7], searchers), [14, 13]);
  });

  it("возвращает исходные индексы, если ответ searchers пуст", () => {
    assert.deepEqual(mapLogicalRegionsToProject([1, 5], null), [1, 5]);
  });
});
