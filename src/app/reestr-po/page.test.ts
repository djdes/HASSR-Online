import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { GET as getRegistryDocPdf } from "@/app/reestr-po/[doc]/route";
import { isAllowedByRobots, isPublicCacheablePage } from "@/lib/robots-txt";
import {
  renderFunctionalCharacteristicsPdf,
  renderInstallationGuidePdf,
  renderLifecycleAndSupportPdf,
  renderUserManualPdf,
  SOFTWARE_REGISTRY_CLASSES,
  SOFTWARE_REGISTRY_DOCS,
  SOFTWARE_REGISTRY_PAGE_PATH,
} from "@/lib/software-registry-docs";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

test("SOFTWARE_REGISTRY_DOCS defines all 4 mandatory PDF documents for Mintsifry registry", () => {
  assert.equal(SOFTWARE_REGISTRY_DOCS.length, 4);
  const paths = SOFTWARE_REGISTRY_DOCS.map((d) => d.pdfPath);
  assert.deepEqual(paths, [
    "/reestr-po/functional-characteristics.pdf",
    "/reestr-po/installation-guide.pdf",
    "/reestr-po/user-manual.pdf",
    "/reestr-po/lifecycle-and-support.pdf",
  ]);
  assert.equal(SOFTWARE_REGISTRY_CLASSES[0].code, "05.05");
});

test("all 4 registry PDF generators produce valid multi-section PDFs on BFS letterhead", () => {
  const emptySign = { facsimile: null, stamp: null };
  const functional = renderFunctionalCharacteristicsPdf(emptySign);
  const installation = renderInstallationGuidePdf(emptySign);
  const manual = renderUserManualPdf(emptySign);
  const lifecycle = renderLifecycleAndSupportPdf(emptySign);

  for (const [name, pdf] of [
    ["functional-characteristics.pdf", functional],
    ["installation-guide.pdf", installation],
    ["user-manual.pdf", manual],
    ["lifecycle-and-support.pdf", lifecycle],
  ] as const) {
    assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-", `${name}: valid PDF header`);
    assert.ok(pdf.length > 15_000, `${name}: expected rich PDF (>15KB), got ${pdf.length}`);
  }
});

test("GET /reestr-po/[doc] serves 200 application/pdf for all 4 documents and 404 for unknown slug", async () => {
  for (const doc of SOFTWARE_REGISTRY_DOCS) {
    const slug = doc.pdfPath.replace("/reestr-po/", "");
    const res = await getRegistryDocPdf(new Request(`https://wesetup.ru${doc.pdfPath}`), {
      params: Promise.resolve({ doc: slug }),
    });
    assert.equal(res.status, 200, slug);
    assert.equal(res.headers.get("Content-Type"), "application/pdf");
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  }
  const notFound = await getRegistryDocPdf(new Request("https://wesetup.ru/reestr-po/unknown.pdf"), {
    params: Promise.resolve({ doc: "unknown.pdf" }),
  });
  assert.equal(notFound.status, 404);
});

test("/reestr-po page includes rightsholder details, exclusive rights, pricing, Russian OS stack, and direct PDF links", () => {
  const page = read("src/app/reestr-po/page.tsx");
  assert.match(page, /ИНН 5018215599/);
  assert.match(page, /КПП 501801001/);
  assert.match(page, /ОГРН 1235000105306/);
  assert.match(page, /Волков Денис Владимирович/);
  assert.match(page, /ст\. 1229, 1259, 1261 и 1295 Гражданского кодекса Российской/);
  assert.match(page, /62\.01\.29\.000/);
  assert.match(page, /63\.11\.13\.000/);
  assert.match(page, /РЕД ОС/);
  assert.match(page, /Astra Linux/);
  assert.match(page, /Альт Сервер/);
  assert.match(page, /PostgreSQL 15\+/);
  assert.match(page, /\/api\/external\/healthz/);
  assert.match(page, /SOFTWARE_REGISTRY_DOCS\.map/);
});

test("/reestr-po and its 4 PDF documents are crawlable and wired into footer, oferta, about, security, and sitemap", () => {
  assert.equal(isAllowedByRobots(SOFTWARE_REGISTRY_PAGE_PATH), true);
  assert.equal(isPublicCacheablePage(SOFTWARE_REGISTRY_PAGE_PATH), true);
  for (const doc of SOFTWARE_REGISTRY_DOCS) {
    assert.equal(isAllowedByRobots(doc.pdfPath), true, `${doc.pdfPath} allowed by robots.txt`);
  }

  assert.match(read("src/components/public/public-chrome.tsx"), /href: "\/reestr-po", label: t\("softwareRegistry"\)/);
  assert.match(read("src/app/oferta/page.tsx"), /2\.6\. Исключительное право на программный комплекс WeSetup/);
  assert.match(read("src/app/oferta/page.tsx"), /href="\/reestr-po"/);
  assert.match(read("src/app/oferta/page.tsx"), /14\s+\(четырнадцать\) календарных дней/);
  assert.match(read("src/app/oferta/page.tsx"), /«Стандарт», «Премиум», «ВИП»/);
  assert.match(read("src/app/about/page.tsx"), /href="\/reestr-po"/);
  assert.match(read("src/app/security/page.tsx"), /href: "\/reestr-po"/);
  assert.match(read("src/app/sitemap.ts"), /\$\{SITE\}\/reestr-po`/);

  // Public API page must not advertise sanction-blocked foreign AI services
  assert.doesNotMatch(read("src/app/developers/page.tsx"), /ChatGPT|Claude|claude\.ai/i);
});
