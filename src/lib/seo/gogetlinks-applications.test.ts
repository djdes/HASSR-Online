import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import { parseGglApplicationsPage, parseGglSiteCard, safeGglSourceUrl, type GglApplicationsView } from "./gogetlinks-applications";
import { buildGglWebmastersPrompt, collectGglApplications, encodeGglWebmastersJob, parseGglWebmastersAnalysis } from "./gogetlinks-applications.server";

test("large all-site jobs fit the real queue limit without losing Unicode data", () => {
  const short = "type: wesetup_ggl_webmasters\nfixture";
  assert.equal(encodeGglWebmastersJob(short), short);
  const prompt = `${short}\n${"Полные сведения о площадке, цена, тематика. ".repeat(3000)}`;
  const packed = encodeGglWebmastersJob(prompt);
  assert.ok(prompt.length > 50_000);
  assert.ok(packed.length < 49_000);
  assert.ok(packed.startsWith("type: wesetup_ggl_webmasters\nencoding: gzip-base64-v1\n\n"));
  assert.equal(gunzipSync(Buffer.from(packed.split("\n\n")[1], "base64")).toString("utf8"), prompt);
});

test("queue encoding rejects oversized, wrong-type and noncompressible jobs instead of truncating", () => {
  assert.throws(() => encodeGglWebmastersJob("type: other\n"), /тип/);
  assert.throws(() => encodeGglWebmastersJob(`type: wesetup_ggl_webmasters\n${"a".repeat(190_000)}`), /размер/);
  assert.throws(() => encodeGglWebmastersJob(`type: wesetup_ggl_webmasters\n${randomBytes(60000).toString("base64")}`), /не помещаются/);
});

function page(num = 1, siteId = 101, total = 1, lastPage = num) {
  return `<script>ReviewsRequestData.pageNum = ${num}; ReviewsRequestData.countAll = ${total};</script>
  <table><tr class="view-request-data-row">
  <td><input name="paper[]" data-comp-id="77" data-price="1101"></td>
  <td data-th="Сайт"><span class="js-card-site-info" data-id="${siteId}"><a href="https://food.example/">food.example</a></span></td>
  <td data-th="Трафик в сутки">1&nbsp;200</td><td data-th="Ссылочная мощь TF/CF"><span data-tooltip-body="&lt;p&gt;Trust Flow - 43, Citation Flow - 56&lt;/p&gt;">49</span></td>
  <td data-th="ИКС">—</td><td data-th="Траст">9</td><td data-th="Тип обзора">Статья</td><td data-th="Цена">1101 Р -76400%</td>
  </tr></table><div class="pagination"><a onclick="loadTable(${lastPage})">Last</a></div>`;
}

test("incoming applications use source price, distinct TF/CF and unknown metrics", () => {
  const parsed = parseGglApplicationsPage(page(), 77);
  assert.equal(parsed.applications.length, 1);
  const row = parsed.applications[0];
  assert.equal(row.priceRub, 1101);
  assert.equal(row.dailyTraffic, 1200);
  assert.equal(row.tf, 43);
  assert.equal(row.cf, 56);
  assert.equal(row.iks, null);
  assert.equal(row.domain, "food.example");
  assert.equal(row.campaignId, 77);
});

test("application parser rejects paid tables, foreign campaigns and missing data", () => {
  assert.throws(() => parseGglApplicationsPage("<table>Paid reviews</table>", 77));
  assert.throws(() => parseGglApplicationsPage(page(), 88));
  assert.throws(() => parseGglApplicationsPage(page().replace("view-request-data-row", "paid-data-row"), 77));
  assert.throws(() => parseGglApplicationsPage(page().replace("https://food.example/", "javascript:alert(1)"), 77));
  assert.equal(safeGglSourceUrl("https://user:password@food.example"), null);
});

test("site cards preserve groups, unknown fields and safe examples without executable markup", () => {
  const card = parseGglSiteCard(`<div class="site-info"><div class="site-info__header"><div>Сайт: food.example</div></div>
    <div class="site-info__cell"><div class="site-info__title">Характеристики</div>
    <div class="site-info__item"><div>Тематика</div><div>Бизнес / Общепит</div></div>
    <div class="site-info__item"><div>Новая метрика</div><div>Не скрываем</div></div></div>
    <a href="https://food.example/sample" onclick="buy()">Пример 1</a><a href="javascript:buy()">Пример 2</a></div>`, 101);
  assert.equal(card.domain, "food.example");
  assert.deepEqual(card.fields.map(f => f.label), ["Тематика", "Новая метрика"]);
  assert.deepEqual(card.examples, ["https://food.example/sample"]);
  assert.throws(() => parseGglSiteCard("<form><input name='password'></form>", 101));
});

test("collector reads every page and validates stable unique coverage", async () => {
  const requested: number[] = [];
  const snapshot = await collectGglApplications(77, async input => {
    assert.equal(input.kind, "applications");
    if (input.kind !== "applications") throw new Error("unexpected detail read");
    requested.push(input.page);
    return page(input.page, 100 + input.page, 3, 3);
  });
  assert.deepEqual(requested, [1, 2, 3]);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.applications.length, 3);
  const duplicate = await collectGglApplications(77, async input => page(input.kind === "applications" ? input.page : 1, 101, 2, 2));
  assert.equal(duplicate.complete, false);
  assert.match(duplicate.warning!, /изменился/);
  await assert.rejects(() => collectGglApplications(77, async () => page(1, 101, 2, 2)), /проигнорировал/);
});

test("collector accepts an observed empty list and marks changing counts incomplete", async () => {
  const empty = await collectGglApplications(77, async () => "<script>ReviewsRequestData.pageNum=1;ReviewsRequestData.countAll=0;</script>");
  assert.equal(empty.complete, true);
  assert.deepEqual(empty.applications, []);
  const changing = await collectGglApplications(77, async input => {
    const n = input.kind === "applications" ? input.page : 1;
    return page(n, n, n === 1 ? 2 : 3, 2);
  });
  assert.equal(changing.complete, false);
});

function view(): GglApplicationsView {
  return { campaignId: 77, campaignName: "WeSetup", snapshotId: "a".repeat(64),
    snapshot: { version: 1, campaignId: 77, fetchedAt: new Date().toISOString(), sourceTotal: 2, complete: true, warning: null,
      applications: [parseGglApplicationsPage(page(1, 101), 77).applications[0], parseGglApplicationsPage(page(1, 102), 77).applications[0]] },
    cards: [101, 102].map(siteId => ({ siteId, card: null, error: "Card unavailable", attemptedAt: new Date().toISOString() })), analysis: null };
}

test("dispatcher prompt covers every applicant with missing-data and no-spending instructions", () => {
  const input = view();
  const prompt = buildGglWebmastersPrompt(input);
  assert.match(prompt, /type: wesetup_ggl_webmasters/);
  assert.match(prompt, /Баланс GoGetLinks тратить запрещено/);
  const dataset = JSON.parse(prompt.split("\n\n").at(-1)!);
  assert.deepEqual(dataset.applicants.map((x: unknown[]) => x[0]), [101, 102]);
  assert.equal(dataset.applicants[0].at(-1), "Card unavailable");
  input.snapshot.complete = false;
  assert.throws(() => buildGglWebmastersPrompt(input), /полный список/);
  input.snapshot.complete = true; input.cards.pop();
  assert.throws(() => buildGglWebmastersPrompt(input), /всех площадок/);
});

test("dispatcher results reject partial coverage, unknown IDs and duplicate recommendations", () => {
  const input = view();
  const report = { summary: "Сравнение", consideredSiteIds: [101, 102], limitations: ["Нет карточек"], recommendations: [{ siteId: 101, verdict: "consider", reason: "Нужно уточнить тематику" }] };
  assert.equal(parseGglWebmastersAnalysis(JSON.stringify(report), input).recommendations[0].siteId, 101);
  assert.throws(() => parseGglWebmastersAnalysis(JSON.stringify({ ...report, consideredSiteIds: [101] }), input));
  assert.throws(() => parseGglWebmastersAnalysis(JSON.stringify({ ...report, consideredSiteIds: [101, 999] }), input));
  assert.throws(() => parseGglWebmastersAnalysis(JSON.stringify({ ...report, recommendations: [...report.recommendations, ...report.recommendations] }), input));
  assert.throws(() => parseGglWebmastersAnalysis("Buy site 999 now", input));
});
