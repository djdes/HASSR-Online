import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isGglSlotReadyForApproval, readDonorSiteFit } from "./gogetlinks-site-fit";
import { assessDonorPublications, assessGglDonorSite, collectDonorLinks } from "./gogetlinks-site-fit.server";

const publisher = new URL("https://publisher.example/");
const targetUrl = "/sanpin-2-3-2-4-4282-26";
const keyword = "санпин для общепита";
const relevant = [
  { title: "Как открыть кафе и рассчитать себестоимость меню", url: new URL("/business/cafe", publisher).href },
  { title: "Изменения СанПиН для ресторанов и столовых", url: new URL("/business/sanpin", publisher).href },
];

test("the SEO page provides donor-review translations in all supported locales", () => {
  const page = readFileSync("src/app/root/seo/links/page.tsx", "utf8");
  assert.match(page, /<DomainMessagesBoundary namespaces=\{\["rootGglDonorReview"\]\}>\s*<SeoLinksClient/);
  for (const locale of ["ru", "en", "uz"]) {
    const messages = JSON.parse(readFileSync(`src/i18n/messages/${locale}.json`, "utf8"));
    assert.ok(messages.rootGglDonorReview.pending);
  }
});

test("only a pending slot with complete, current donor evidence enters the approval queue", () => {
  const pending = {
    status: "pending_approval",
    targetUrl,
    anchor: "wesetup.ru",
    donorSiteId: 123,
    donorMetricsJson: {},
  };
  const fit = assessDonorPublications(relevant, targetUrl, keyword);
  assert.ok(fit);
  assert.equal(isGglSlotReadyForApproval(pending), false);
  assert.equal(isGglSlotReadyForApproval({ ...pending, donorMetricsJson: { siteFit: fit } }), true);
  assert.equal(isGglSlotReadyForApproval({
    ...pending, donorMetricsJson: { siteFit: { ...fit, checkedAt: 0 } },
  }), false);
  assert.equal(isGglSlotReadyForApproval({
    ...pending, status: "preparing", donorMetricsJson: { siteFit: fit },
  }), false);
});

test("editorial evidence outranks a coincidental topic mention and binds to the landing page", () => {
  const generalNews = [
    { title: "Ресторан звезды снова в центре внимания", url: new URL("/celebrity", publisher).href },
    { title: "Специалисты пояснили, как открыть бизнес", url: new URL("/business", publisher).href },
    { title: "Роспотребнадзор проверил пляжи области", url: new URL("/beaches", publisher).href },
  ];
  assert.equal(assessDonorPublications([...generalNews, relevant[0]], targetUrl, keyword), null);
  const fit = assessDonorPublications([...generalNews, ...relevant], targetUrl, keyword);
  assert.ok(fit);
  assert.equal(fit.level, "topic");
  assert.equal(assessDonorPublications(relevant, targetUrl, "температура хранения")?.level, "audience");
  assert.deepEqual(fit.publications, [relevant[1], relevant[0]]);
  assert.deepEqual(readDonorSiteFit({ siteFit: fit }, targetUrl), fit);
  assert.equal(readDonorSiteFit({ siteFit: fit }, "/zhurnal-haccp"), null);
  assert.equal(readDonorSiteFit({ siteFit: { ...fit, checkedAt: 0 } }, targetUrl), null);
});

test("site sampling extracts scoped editorial links and ignores markup, navigation duplicates and external links", async () => {
  const links = collectDonorLinks(`
    <a href="/business">Бизнес</a>
    <a href="https://www.publisher.example/business/cafe#title"><h2>${relevant[0].title}</h2></a>
    <a href="/business/cafe">Подробнее</a>
    <a href="https://elsewhere.example/article">${relevant[1].title}</a>
    <!-- <a href="/hidden">Hidden link</a> -->
    <script>const template = '<a href="/hidden">Hidden link</a>';</script>
  `, publisher, publisher.hostname);
  assert.deepEqual(links.map(({ title }) => title), ["Бизнес", relevant[0].title]);
  assert.equal(assessDonorPublications([relevant[0], { ...relevant[0], url: `${relevant[0].url}?utm_source=home` }], targetUrl, keyword), null);
  assert.equal(await assessGglDonorSite("127.0.0.1", targetUrl, keyword), null);
  assert.equal(await assessGglDonorSite("localhost", targetUrl, keyword), null);
});
