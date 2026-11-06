import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  callGglRead,
  callGglWrite,
  GglCallError,
  GglIsolationError,
  initApiAnythingHome,
  pinGglOverallCampaign,
  saveLocalSession,
  readGglWebmasterSource,
} from "@/lib/seo/gogetlinks-client.server";
import { decodeWin1251 } from "@/lib/seo/gogetlinks-codec";

test("webmaster reads only POST the observed listing/card endpoints, with scoped filters and no purchase", async () => {
  const previous = process.env.API_ANYTHING_HOME;
  process.env.API_ANYTHING_HOME = mkdtempSync(join(tmpdir(), "ggl-webmaster-read-"));
  const seen: string[] = [];
  try {
    saveLocalSession([{ name: "hash", value: "fixture", domain: "gogetlinks.net", path: "/", expires: -1, httpOnly: true, secure: true }]);
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push(String(url));
      assert.equal(init?.method, "POST");
      const body = new URLSearchParams(String(init?.body));
      if (String(url).endsWith("/reviews/table")) {
        assert.equal(body.get("action"), "request");
        assert.equal(body.get("in_comp_id"), "77");
        assert.equal(body.get("page_num"), "2");
        return Response.json({ success: true, data: "<div>Заявки</div>" });
      }
      assert.equal(String(url), "https://gogetlinks.net/viewSiteInfo");
      assert.equal(body.get("siteId"), "101");
      assert.equal(body.get("type"), "1");
      return new Response("<div>Карточка</div>", { headers: { "content-type": "text/html; charset=utf-8" } });
    };
    const opts = { fetchImpl, skipDbSync: true, allowRelogin: false };
    assert.equal(await readGglWebmasterSource({ kind: "applications", campaignId: 77, page: 2 }, opts), "<div>Заявки</div>");
    assert.equal(await readGglWebmasterSource({ kind: "site", siteId: 101 }, opts), "<div>Карточка</div>");
    await assert.rejects(() => readGglWebmasterSource({ kind: "site", siteId: -1 }, opts));
    assert.deepEqual(seen, ["https://gogetlinks.net/reviews/table", "https://gogetlinks.net/viewSiteInfo"]);
    await assert.rejects(() => readGglWebmasterSource({ kind: "site", siteId: 101 }, { ...opts, fetchImpl: async () => new Response("", { status: 429 }) }), error => error instanceof GglCallError && error.gglClass === "rate");
  } finally {
    if (previous === undefined) delete process.env.API_ANYTHING_HOME; else process.env.API_ANYTHING_HOME = previous;
  }
});

function encodeWin1251Bytes(text: string): Uint8Array<ArrayBuffer> {
  const decoder = new TextDecoder("windows-1251");
  const charToByte = new Map<string, number>();
  for (let b = 0; b <= 255; b++) {
    const ch = decoder.decode(new Uint8Array([b]));
    if (ch && ch !== "\uFFFD") {
      charToByte.set(ch, b);
    }
  }
  const bytes: number[] = [];
  for (const ch of text) {
    bytes.push(charToByte.get(ch) ?? 0x3f);
  }
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  return out;
}

test("callGglRead: <64KB windows-1251 pages with passive layout reCAPTCHA succeed without corrupting Cyrillic", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "ggl-client-test-"));
  const prevHome = process.env.API_ANYTHING_HOME;
  process.env.API_ANYTHING_HOME = tempHome;

  try {
    // Seed a poisoned tier > 1 in state.json to verify sanitizeGglTierState clears it
    initApiAnythingHome();
    writeFileSync(
      join(tempHome, "state.json"),
      JSON.stringify({ tier: { "gogetlinks/listActiveCampaigns": 2 } }),
      "utf8",
    );
    saveLocalSession([
      {
        name: "PHPSESSID",
        value: "test-sess-123",
        domain: "gogetlinks.net",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
      },
      {
        name: "hash",
        value: "test-hash-123",
        domain: "gogetlinks.net",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
      },
    ]);

    const activeCampaignsHtml = `<!doctype html>
<html>
<head>
  <meta charset="windows-1251">
  <script src="https://www.google.com/recaptcha/api.js?onload=recapthcaOnload&render=explicit" async defer></script>
</head>
<body>
  <div class="g-recaptcha" data-sitekey="abc"></div>
  <table class="finance__table"><tbody><tr><td id="balance">8 936,06</td></tr></tbody></table>
  <div id="table-content">
    <table>
      <tbody>
        <tr id="comp_row_0">
          <td class="table-checkbox"><input class="check-box-comp-id" type="checkbox" value="884931"></td>
          <td data-th="Кампания">
            <div class="table__td">
              <a href="/campaign/index/id/884931">WeSetup электронные журналы ХАССП</a>
              <div><a class="text-primary-100" href="https://wesetup.ru">wesetup.ru</a></div>
            </div>
          </td>
          <td data-th="Видимость"><a href="#">Доступна</a></td>
          <td data-th="Контроль качества"><a href="#">Автозамена</a></td>
          <td data-th="Потрачено (за месяц/всего)"><a href="#">0 Р</a></td>
          <td data-th="Ссылки"><a href="#">0</a></td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;

    const emptyPaidHtml = `<!doctype html>
<html>
<head>
  <meta charset="windows-1251">
  <script src="https://www.google.com/recaptcha/api.js?onload=recapthcaOnload&render=explicit"></script>
</head>
<body>
  <div class="g-recaptcha"></div>
  <table class="finance__table"><tbody><tr><td>8 936,06</td></tr></tbody></table>
  <div id="table_content">
    <table><tbody><tr><td colspan="10" class="text-center">Ссылок по этой кампании пока нет</td></tr></tbody></table>
  </div>
</body>
</html>`;

    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/campaigns")) {
        const bytes = encodeWin1251Bytes(activeCampaignsHtml);
        assert.ok(bytes.length < 64_000);
        assert.match(decodeWin1251(bytes), /электронные журналы ХАССП/);
        return new Response(bytes, {
          status: 200,
          headers: { "content-type": "text/html; charset=windows-1251" },
        });
      }
      if (url.includes("/reviews/paid/in_comp_id/884931")) {
        return new Response(encodeWin1251Bytes(emptyPaidHtml), {
          status: 200,
          headers: { "content-type": "text/html; charset=windows-1251" },
        });
      }
      if (url.includes("/reviews/propocal")) {
        // GoGetLinks redirects empty review tabs to /reviews/request (unaccepted spam offers)
        return new Response("", {
          status: 302,
          headers: { location: "https://gogetlinks.net/reviews/request" },
        });
      }
      throw new Error(`Unexpected URL in mockFetch: ${url}`);
    };

    const campaigns = await callGglRead<Array<Record<string, string>>>(
      "listActiveCampaigns",
      undefined,
      { fetchImpl: mockFetch, skipDbSync: true, allowRelogin: false },
    );
    assert.equal(campaigns.length, 1);
    assert.equal(campaigns[0].campaignId, "884931");
    assert.equal(campaigns[0].name, "WeSetup электронные журналы ХАССП");
    assert.equal(campaigns[0].domain, "wesetup.ru");

    const paidRows = await callGglRead<unknown[]>(
      "listCampaignPaidLinks",
      { campaignId: "884931" },
      { fetchImpl: mockFetch, skipDbSync: true, allowRelogin: false },
    );
    assert.deepEqual(paidRows, []);

    const inProgressRows = await callGglRead<unknown[]>(
      "listReviewsByTab",
      { tab: "in_progress" },
      { fetchImpl: mockFetch, skipDbSync: true, allowRelogin: false },
    );
    assert.deepEqual(inProgressRows, []);
  } finally {
    if (prevHome === undefined) delete process.env.API_ANYTHING_HOME;
    else process.env.API_ANYTHING_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test("callGglRead: genuine reCAPTCHA interstitial page is still rejected as blocked", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "ggl-client-block-"));
  const prevHome = process.env.API_ANYTHING_HOME;
  process.env.API_ANYTHING_HOME = tempHome;

  try {
    saveLocalSession([
      {
        name: "PHPSESSID",
        value: "test-sess-block",
        domain: "gogetlinks.net",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
      },
      {
        name: "hash",
        value: "test-hash-block",
        domain: "gogetlinks.net",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
      },
    ]);

    const realChallengeHtml = `<!doctype html>
<html>
<head><title>Prove your humanity</title></head>
<body>
  <h1>Prove your humanity</h1>
  <div class="g-recaptcha" data-sitekey="real-wall"></div>
</body>
</html>`;

    await assert.rejects(
      () =>
        callGglRead("listMessageThreads", undefined, {
          fetchImpl: async () =>
            new Response(realChallengeHtml, {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
          skipDbSync: true,
          allowRelogin: false,
        }),
      (err: unknown) => err instanceof GglCallError && err.gglClass === "blocked",
    );
  } finally {
    if (prevHome === undefined) delete process.env.API_ANYTHING_HOME;
    else process.env.API_ANYTHING_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});

test("callGglWrite + pinGglOverallCampaign: executes 5-step modal creation without set_prices_to_all and enforces wesetup.ru isolation", async () => {
  const tempHome = mkdtempSync(join(tmpdir(), "ggl-client-write-"));
  const prevHome = process.env.API_ANYTHING_HOME;
  process.env.API_ANYTHING_HOME = tempHome;

  try {
    saveLocalSession([
      {
        name: "PHPSESSID",
        value: "test-sess-write",
        domain: "gogetlinks.net",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
      },
      {
        name: "hash",
        value: "test-hash-cookie",
        domain: "gogetlinks.net",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: true,
        secure: true,
      },
    ]);

    const calledUrls: string[] = [];
    let savedBody = "";

    const mockFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calledUrls.push(url);
      if (url === "https://gogetlinks.net/campaign") {
        const html = `<form><input type="hidden" name="token" value="deadbeef1234"><script>var stopWords = ["казино"];</script><input name="link[1]" value="240"></form>`;
        return new Response(html, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      if (url === "https://gogetlinks.net/campaign/checkUrl") {
        return new Response(JSON.stringify({ error: "" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/unchors/change/token/deadbeef1234/type/save")) {
        return new Response(JSON.stringify({ error: "", count: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/campaign/exist/type/find_exists")) {
        return new Response(JSON.stringify({ exist: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url === "https://gogetlinks.net/campaign/save") {
        savedBody = String(init?.body ?? "");
        return new Response(
          JSON.stringify({ error: "", params: { redirect_url: "/searchSites" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url === "https://gogetlinks.net/campaigns/setOverallCampaignId") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`Unexpected write URL: ${url}`);
    };

    const mockPrisma = {
      gglAccount: { findFirst: async () => null, update: async () => ({}) },
      gglCampaign: {
        findFirst: async ({ where }: { where: { OR?: Array<{ gglCampaignId?: number }> } }) => {
          const isWs = where.OR?.some((c) => c.gglCampaignId === 884931);
          const isLegacy = where.OR?.some((c) => c.gglCampaignId === 4101);
          if (isWs) return { isWesetup: true };
          if (isLegacy) return { isWesetup: false };
          return null;
        },
      },
    };

    // Rejects non-wesetup domain before touching network
    await assert.rejects(
      () =>
        callGglWrite({
          opName: "createOrUpdateCampaign",
          args: { name: "Чужой сайт", siteUrl: "https://yesbeat.ru" },
          idempotencyKey: "bad-domain-1",
          prismaClient: mockPrisma,
          fetchImpl: mockFetch,
        }),
      GglIsolationError,
    );
    assert.equal(calledUrls.length, 0);

    // Executes 5-step modal creation for wesetup.ru without set_prices_to_all
    const created = await callGglWrite({
      opName: "createOrUpdateCampaign",
      args: {
        name: "WeSetup электронные журналы ХАССП казино",
        siteUrl: "https://wesetup.ru",
      },
      idempotencyKey: "create-ws-modal-1",
      prismaClient: mockPrisma,
      fetchImpl: mockFetch,
    });
    assert.equal(created.status, "applied");
    assert.equal(calledUrls.length, 5);
    const savedParams = new URLSearchParams(savedBody);
    assert.equal(savedParams.get("token"), "deadbeef1234");
    assert.equal(savedParams.get("url_mask"), "wesetup.ru");
    assert.equal(savedParams.get("comp_name"), "WeSetup электронные журналы ХАССП");
    assert.equal(savedParams.has("set_prices_to_all"), false);

    // Rejects pinning legacy campaign #4101
    await assert.rejects(
      () =>
        pinGglOverallCampaign(4101, {
          prismaClient: mockPrisma,
          fetchImpl: mockFetch,
          idempotencyKey: "pin-legacy-4101",
        }),
      GglIsolationError,
    );

    // Pins wesetup.ru campaign #884931
    await pinGglOverallCampaign(884931, {
      prismaClient: mockPrisma,
      fetchImpl: mockFetch,
      idempotencyKey: "pin-ws-884931",
    });
    assert.ok(calledUrls.includes("https://gogetlinks.net/campaigns/setOverallCampaignId"));
  } finally {
    if (prevHome === undefined) delete process.env.API_ANYTHING_HOME;
    else process.env.API_ANYTHING_HOME = prevHome;
    rmSync(tempHome, { recursive: true, force: true });
  }
});
