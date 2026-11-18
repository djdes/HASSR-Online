import assert from "node:assert/strict";
import test from "node:test";
import { parseGglCatalogPage } from "@/lib/seo/gogetlinks-catalog";

test("reads catalog prices from the selected placement cells, not the site-note link or comparison percentages", () => {
  const result = parseGglCatalogPage(`
    <table><tr id="col_row_123">
      <td data-th="Сайт"><a href="/searchSites/editDescription/siteId/123">Заметка</a>
        <span data-favorite-domain="publisher.ru"></span></td>
      <td data-th="Трафик в сутки">12&nbsp;600</td>
      <td data-th="Ссылочная мощь (TF/CF)"><span data-tooltip-body="&lt;p&gt;Trust Flow - 44, Citation Flow - 52&lt;/p&gt;">48</span></td>
      <td data-th="Траст">9</td>
      <td data-th="Индексация">95</td>
      <td data-th="Статья"><input id="h1_123" type="hidden" value="1350"><span>-48%</span></td>
      <td data-th="Заметка">—</td>
      <td data-th="Контекстная"><input id="h3_123" type="hidden" value="100"></td>
    </tr></table>`);
  assert.deepEqual(result, [{
    siteId: 123, domain: "publisher.ru", priceArticleRub: 1350, priceNoteRub: null,
    priceContextRub: 100, dailyTraffic: 12600, trust: 9, tf: 44, cf: 52,
    indexedYandex: true, indexedGoogle: true,
  }]);
  assert.deepEqual(parseGglCatalogPage("<div>Ничего не найдено</div>"), []);
});
