import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  TopvisorError,
  buildMatrix,
  evaluateActiveCheckStatus,
  getCheckerPrice,
  getPositionsHistory,
  mapLogicalRegionsForHistory,
  mapLogicalRegionsToProject,
  parsePosition,
  parsePositionKey,
  parseProjectCheckerProgress,
  parseStoredCheckState,
  resetTopvisorSearcherCache,
  runChecker,
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

  it("не подменяет Яндекс на Google, если в проекте пока есть только Google", () => {
    const onlyGoogle = [
      {
        key: 1,
        name: "Google",
        enabled: 1,
        regions: [
          { index: "2", key: 213, areaName: "Москва", enabled: 1 },
          { index: "7", key: 225, areaName: "Россия", enabled: 1 },
        ],
      },
    ];
    assert.deepEqual(mapLogicalRegionsToProject([1, 5], onlyGoogle), []);
    assert.deepEqual(mapLogicalRegionsToProject([2, 7], onlyGoogle), [2, 7]);
  });
});

describe("parseProjectCheckerProgress", () => {
  it("распознаёт активный съём по pos_status и percent_of_parse", () => {
    assert.deepEqual(
      parseProjectCheckerProgress({ pos_status: 2, percent_of_parse: "45" }),
      { active: true, percent: 45 }
    );
    assert.deepEqual(
      parseProjectCheckerProgress({ pos_status: 0, percent_of_parse: 100 }),
      { active: false, percent: 100 }
    );
  });

  it("безопасно обрабатывает пустой ответ", () => {
    assert.deepEqual(parseProjectCheckerProgress(null), {
      active: null,
      percent: null,
    });
  });
});

describe("evaluateActiveCheckStatus", () => {
  it("удерживает статус активного съёма после запуска и сбрасывает при появлении новой даты в матрице", () => {
    const startedMs = 1_700_000_000_000;
    const stored = parseStoredCheckState(
      JSON.stringify({
        startedAt: new Date(startedMs).toISOString(),
        price: 35.46,
        regions: [1, 5],
        baselineDates: ["2026-09-07"],
        baselineFilledCount: 1,
      })
    );
    assert.ok(stored);

    // Сразу после запуска съём считается активным даже при pos_status = 0 (grace period)
    const activeEarly = evaluateActiveCheckStatus({
      stored,
      nowMs: startedMs + 5_000,
      remoteProgress: { active: false, percent: 0 },
    });
    assert.equal(activeEarly?.checking, true);
    assert.equal(activeEarly?.price, 35.46);

    // Когда в матрице появилась новая дата (2026-09-09) и прошёл grace period — съём завершён
    const matrixWithNewDate = buildMatrix(RAW);
    const finished = evaluateActiveCheckStatus({
      stored,
      nowMs: startedMs + 60_000,
      remoteProgress: { active: null, percent: null },
      matrix: matrixWithNewDate,
    });
    assert.equal(finished, null);
  });

  it("сбрасывает блокировку по истечении 15-минутного таймаута", () => {
    const startedMs = 1_700_000_000_000;
    const stored = parseStoredCheckState(
      JSON.stringify({
        startedAt: new Date(startedMs).toISOString(),
        price: 35.46,
        regions: [1, 5],
        baselineDates: [],
        baselineFilledCount: 0,
      })
    );
    const expired = evaluateActiveCheckStatus({
      stored,
      nowMs: startedMs + 16 * 60 * 1000,
    });
    assert.equal(expired, null);
  });
});

/** Боевая конфигурация проекта 32866188 с дублями XML (1/5) и SERP (712161/712278). */
const PROJECT_32866188_SEARCHERS = [
  {
    key: 0,
    name: "Yandex",
    enabled: 1,
    regions: [
      {
        index: "5",
        key: 225,
        name: "Россия",
        areaName: "",
        alt: "",
        depth: 1,
        enabled: 1,
      },
      {
        index: "1",
        key: 213,
        name: "Москва",
        areaName: "Москва и Московская область",
        alt: "",
        depth: 1,
        enabled: 1,
      },
      {
        index: "712161",
        key: 213,
        name: "Москва",
        areaName: "Москва и Московская область",
        alt: "serp",
        depth: 3,
        enabled: 1,
      },
      {
        index: "712278",
        key: 225,
        name: "Россия",
        areaName: "",
        alt: "serp",
        depth: 3,
        enabled: 1,
      },
    ],
  },
  {
    key: 1,
    name: "Google",
    enabled: 1,
    regions: [
      {
        index: "7",
        key: 225,
        name: "Россия",
        areaName: "",
        alt: "",
        depth: 1,
        enabled: 1,
      },
      {
        index: "2",
        key: 213,
        name: "Москва",
        areaName: "Москва и Московская область",
        alt: "",
        depth: 1,
        enabled: 1,
      },
    ],
  },
];

describe("дубли регионов Яндекс XML (1/5) и SERP (712161/712278)", () => {
  it("mapLogicalRegionsForHistory возвращает ВСЕ включённые регионы для логического слота", () => {
    assert.deepEqual(
      mapLogicalRegionsForHistory([1], PROJECT_32866188_SEARCHERS),
      [1, 712161]
    );
    assert.deepEqual(
      mapLogicalRegionsForHistory([5], PROJECT_32866188_SEARCHERS),
      [5, 712278]
    );
    assert.deepEqual(
      mapLogicalRegionsForHistory([2], PROJECT_32866188_SEARCHERS),
      [2]
    );
    assert.deepEqual(
      mapLogicalRegionsForHistory([7], PROJECT_32866188_SEARCHERS),
      [7]
    );

    // Если старый XML-регион выключили, в историю попадают только включённые регионы слота.
    const withDisabledXml = [
      {
        key: 0,
        name: "Yandex",
        enabled: 1,
        regions: [
          { index: "1", key: 213, name: "Москва", alt: "", enabled: 0 },
          { index: "712161", key: 213, name: "Москва", alt: "serp", enabled: 1 },
        ],
      },
    ];
    assert.deepEqual(mapLogicalRegionsForHistory([1], withDisabledXml), [712161]);
    assert.deepEqual(mapLogicalRegionsToProject([1], withDisabledXml), [712161]);
  });

  it("mapLogicalRegionsToProject выбирает ровно ОДИН основной регион (предпочитая alt='serp') без двойного списания", () => {
    assert.deepEqual(
      mapLogicalRegionsToProject([1, 5], PROJECT_32866188_SEARCHERS),
      [712161, 712278]
    );
    assert.deepEqual(
      mapLogicalRegionsToProject([1, 712161], PROJECT_32866188_SEARCHERS),
      [712161]
    );
    assert.deepEqual(
      mapLogicalRegionsToProject([1, 5, 2, 7], PROJECT_32866188_SEARCHERS),
      [712161, 712278, 2, 7]
    );
  });

  it("buildMatrix склеивает историю XML (2026-09-10) и SERP (2026-11-16) в единую шкалу дат", () => {
    const matrix = buildMatrix({
      headers: {
        dates: ["2026-11-16", "2026-09-10"],
        projects: [{ id: 32866188, searchers: PROJECT_32866188_SEARCHERS }],
      },
      keywords: [
        {
          name: "гигиенический журнал",
          positionsData: {
            "2026-09-10:32866188:1": {
              position: "12",
              relevant_url: "https://wesetup.ru/journals-info/hygiene",
            },
            "2026-11-16:32866188:712161": {
              position: "1",
              relevant_url: "https://wesetup.ru/journals-info/hygiene",
            },
          },
        },
      ],
      existsDates: ["2026-09-10", "2026-11-16"],
    });

    assert.deepEqual(matrix.dates, ["2026-11-16", "2026-09-10"]);
    assert.equal(matrix.rows[0]?.latest, 1);
    assert.equal(
      matrix.rows[0]?.latestUrl,
      "https://wesetup.ru/journals-info/hygiene"
    );
    assert.equal(matrix.rows[0]?.delta, 11);
    assert.equal(matrix.rows[0]?.byDate["2026-09-10"]?.position, 12);
    assert.equal(matrix.rows[0]?.byDate["2026-11-16"]?.position, 1);
  });

  it("buildMatrix на одной дате предпочитает реальную позицию вместо '--' и SERP вместо XML независимо от порядка ключей", () => {
    // Ключ SERP стоит ПЕРЕД ключом XML с "--": старый код затирал позицию null'ом.
    const matrixSerpFirst = buildMatrix({
      headers: {
        dates: ["2026-11-16"],
        projects: [{ id: 32866188, searchers: PROJECT_32866188_SEARCHERS }],
      },
      keywords: [
        {
          name: "журнал температуры",
          positionsData: {
            "2026-11-16:32866188:712161": {
              position: "9",
              relevant_url: "https://wesetup.ru/journals-info/climate_control",
            },
            "2026-11-16:32866188:1": {
              position: "--",
              relevant_url: "",
            },
          },
        },
        {
          name: "бракеражный журнал",
          positionsData: {
            "2026-11-16:32866188:1": {
              position: "14",
              relevant_url: "https://wesetup.ru/blanki",
            },
            "2026-11-16:32866188:712161": {
              position: "20",
              relevant_url: "https://wesetup.ru/journals-info/finished_product",
            },
          },
        },
      ],
    });

    assert.equal(matrixSerpFirst.rows[0]?.byDate["2026-11-16"]?.position, 9);
    assert.equal(
      matrixSerpFirst.rows[0]?.byDate["2026-11-16"]?.url,
      "https://wesetup.ru/journals-info/climate_control"
    );
    // Когда на одной дате есть численные позиции и в XML, и в SERP — побеждает SERP (даже если число позиции больше).
    assert.equal(matrixSerpFirst.rows[1]?.byDate["2026-11-16"]?.position, 20);
    assert.equal(
      matrixSerpFirst.rows[1]?.byDate["2026-11-16"]?.url,
      "https://wesetup.ru/journals-info/finished_product"
    );

    // Обратный порядок ключей даёт точно такой же результат.
    const matrixXmlFirst = buildMatrix({
      headers: { dates: ["2026-11-16"] },
      keywords: [
        {
          name: "журнал температуры",
          positionsData: {
            "2026-11-16:32866188:1": {
              position: "--",
              relevant_url: "",
            },
            "2026-11-16:32866188:712161": {
              position: "9",
              relevant_url: "https://wesetup.ru/journals-info/climate_control",
            },
          },
        },
        {
          name: "бракеражный журнал",
          positionsData: {
            "2026-11-16:32866188:712161": {
              position: "20",
              relevant_url: "https://wesetup.ru/journals-info/finished_product",
            },
            "2026-11-16:32866188:1": {
              position: "14",
              relevant_url: "https://wesetup.ru/blanki",
            },
          },
        },
      ],
    }, { serpRegionIndexes: [712161, 712278] });

    assert.equal(matrixXmlFirst.rows[0]?.byDate["2026-11-16"]?.position, 9);
    assert.equal(matrixXmlFirst.rows[1]?.byDate["2026-11-16"]?.position, 20);
  });

  it("getPositionsHistory запрашивает оба индекса [1, 712161], а getCheckerPrice и runChecker — только один основной на слот [712161, 712278]", async () => {
    const prevEnv = {
      key: process.env.TOPVISOR_API_KEY,
      user: process.env.TOPVISOR_USER_ID,
      project: process.env.TOPVISOR_PROJECT_ID,
    };
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

    process.env.TOPVISOR_API_KEY = "test-key";
    process.env.TOPVISOR_USER_ID = "12345";
    process.env.TOPVISOR_PROJECT_ID = "32866188";
    resetTopvisorSearcherCache();

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, body });

      if (url.endsWith("get/projects_2/projects")) {
        return new Response(
          JSON.stringify({
            result: [{ id: 32866188, searchers: PROJECT_32866188_SEARCHERS }],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("get/positions_2/history")) {
        return new Response(
          JSON.stringify({
            result: {
              headers: {
                dates: ["2026-11-16", "2026-09-10"],
                projects: [{ id: 32866188, searchers: PROJECT_32866188_SEARCHERS }],
              },
              keywords: [
                {
                  name: "журналы хассп",
                  positionsData: {
                    "2026-09-10:32866188:1": {
                      position: "15",
                      relevant_url: "https://wesetup.ru/",
                    },
                    "2026-11-16:32866188:712161": {
                      position: "5",
                      relevant_url: "https://wesetup.ru/",
                    },
                  },
                },
              ],
              existsDates: ["2026-09-10", "2026-11-16"],
            },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("get/positions_2/checker/price")) {
        return new Response(
          JSON.stringify({
            result: { pricesByUsers: { "12345": { price: 35.64 } } },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("edit/positions_2/checker/go")) {
        return new Response(
          JSON.stringify({
            result: { projectsIds: [32866188] },
          }),
          { status: 200 }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    try {
      const history = await getPositionsHistory({
        regionIndex: 1,
        dateFrom: "2026-09-01",
        dateTo: "2026-11-19",
      });
      assert.deepEqual(history.dates, ["2026-11-16", "2026-09-10"]);
      assert.equal(history.rows[0]?.latest, 5);
      assert.equal(history.rows[0]?.delta, 10);

      const historyCall = calls.find((c) =>
        c.url.endsWith("get/positions_2/history")
      );
      assert.deepEqual(historyCall?.body.regions_indexes, [1, 712161]);

      await getPositionsHistory({
        regionIndex: 5,
        dateFrom: "2026-09-01",
        dateTo: "2026-11-19",
      });
      const historyCalls = calls.filter((c) =>
        c.url.endsWith("get/positions_2/history")
      );
      assert.deepEqual(historyCalls[1]?.body.regions_indexes, [5, 712278]);

      const price = await getCheckerPrice([1, 5]);
      assert.equal(price, 35.64);
      const priceCall = calls.find((c) =>
        c.url.endsWith("get/positions_2/checker/price")
      );
      assert.deepEqual(priceCall?.body.regions_indexes, [712161, 712278]);

      const queued = await runChecker([1, 5]);
      assert.equal(queued, true);
      const goCall = calls.find((c) =>
        c.url.endsWith("edit/positions_2/checker/go")
      );
      assert.deepEqual(goCall?.body.regions_indexes, [712161, 712278]);
    } finally {
      globalThis.fetch = originalFetch;
      resetTopvisorSearcherCache();
      if (prevEnv.key === undefined) delete process.env.TOPVISOR_API_KEY;
      else process.env.TOPVISOR_API_KEY = prevEnv.key;
      if (prevEnv.user === undefined) delete process.env.TOPVISOR_USER_ID;
      else process.env.TOPVISOR_USER_ID = prevEnv.user;
      if (prevEnv.project === undefined) delete process.env.TOPVISOR_PROJECT_ID;
      else process.env.TOPVISOR_PROJECT_ID = prevEnv.project;
    }
  });
});


