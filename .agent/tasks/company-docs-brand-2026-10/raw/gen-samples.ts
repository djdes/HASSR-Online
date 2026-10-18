/**
 * Примеры документов на локальной базе wesetup_company (НЕ прод): готовит
 * организацию e2e-org-loc (логотип, цвет, правки реквизитов поверх снимка
 * ЕГРЮЛ, КПП и телефон точки), затем собирает PDF журнала, ППК, приказа и
 * сводки проверяющего и рендерит первые страницы в PNG для просмотра глазами.
 *
 *   npx tsx .agent/tasks/company-docs-brand-2026-10/raw/gen-samples.ts
 *
 * Перед запуском .env worktree должен смотреть на wesetup_company.
 */
import fs from "node:fs";
import path from "node:path";

import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

import { db } from "@/lib/db";
import { generateJournalDocumentPdf } from "@/lib/document-pdf";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { toOrderOrgSnapshot } from "@/lib/document-org-block";
import { hashInspectorToken } from "@/lib/inspector-tokens";
import { renderPdfPageToPng } from "@/lib/journal-preview/render-pages";
import { ORDER_TEMPLATES } from "@/lib/orders/catalog";
import { renderOrderPdf } from "@/lib/orders/pdf";
import { setOrgLogo } from "@/lib/org-logo";
import { prepareOrgLogo } from "@/lib/org-logo-file";
import { loadPdfOrgLogo } from "@/lib/pdf-logo.server";
import { loadPpkBundle } from "@/lib/ppk/assemble.server";
import { buildHaccpPlanPdf, buildPpkProgramPdf } from "@/lib/ppk/pdf";

const ORG = "e2e-org-loc";
const OUT = path.join(process.cwd(), ".agent", "tasks", "company-docs-brand-2026-10", "raw", "samples");
const url = process.env.DATABASE_URL ?? "";
if (!url.includes("wesetup_company")) throw new Error(`Не та база: ${url}`);

function logoPng(): Uint8Array {
  GlobalFonts.registerFromPath(path.join(process.cwd(), "src", "lib", "pdf-fonts", "DejaVuSans-Bold.ttf"), "LogoBold");
  const canvas = createCanvas(480, 128);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 480, 128);
  ctx.fillStyle = "#c2410c";
  ctx.beginPath();
  ctx.roundRect(8, 14, 100, 100, 24);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(58, 64, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c2410c";
  ctx.beginPath();
  ctx.arc(58, 64, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1c1917";
  ctx.font = "56px LogoBold";
  ctx.fillText("Точки", 128, 84);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

async function savePdf(name: string, pdf: Uint8Array | Buffer, pages = 1) {
  fs.writeFileSync(path.join(OUT, `${name}.pdf`), pdf);
  for (let page = 1; page <= pages; page += 1) {
    const sheet = await renderPdfPageToPng(new Uint8Array(pdf), page, { width: 1400 });
    fs.writeFileSync(path.join(OUT, `${name}-p${page}.png`), sheet.png);
  }
  console.log("saved", name);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // 1. Организация: логотип файлом, фирменный цвет, ИНН + снимок ЕГРЮЛ и правки поверх.
  await setOrgLogo(ORG, { bytes: logoPng(), mime: "image/png" });
  await db.organization.update({
    where: { id: ORG },
    data: {
      inn: "7701234567",
      address: "г. Москва, ул. Пищевая, д. 12",
      phone: "+7 495 000-00-00",
      brandColor: "#c2410c",
      journalShortName: "Кафе «Точки»",
      legalProfileJson: {
        inn: "7701234567",
        type: "LEGAL",
        nameShort: "ООО «ТОЧКИ»",
        nameFull: "Общество с ограниченной ответственностью «Точки»",
        opfShort: "ООО",
        opfFull: null,
        kpp: "770101001",
        ogrn: "1027700132195",
        ogrnDate: null,
        address: "109012, г Москва, ул Ильинка, д 4",
        management: { name: "Петров Пётр Петрович", post: "Генеральный директор" },
        okvedMain: null,
        okvedsExtra: [],
        status: "ACTIVE",
        registrationDate: null,
        liquidationDate: null,
        employeeCount: null,
        capital: null,
        branchCount: null,
        finance: null,
        founders: [],
        phones: [],
        emails: [],
        fetchedAt: "2026-10-17T00:00:00.000Z",
      },
      legalProfileUpdatedAt: new Date(),
      // Правки поверх снимка: руководитель сменился, юрадрес переехал.
      directorName: "Иванова Анна Сергеевна",
      directorPost: "Генеральный директор",
      legalAddress: "123100, г Москва, Пресненская наб, д 12, оф 301",
      legalFullName: null,
      kpp: null,
      ogrn: null,
    },
  });
  const building = await db.building.findFirst({ where: { organizationId: ORG, address: "ул. Ленина, 10" } });
  if (building) {
    await db.building.update({
      where: { id: building.id },
      data: { name: "Точка на Ленина", kpp: "770102002", phone: "+7 900 111-22-33" },
    });
  }

  const block = await loadDocumentOrgBlock(ORG, { buildingId: building?.id ?? null });
  fs.writeFileSync(path.join(OUT, "block.json"), JSON.stringify(block, null, 2));

  // 2. PDF журнала: документ точки (если есть) или любой.
  const document =
    (building &&
      (await db.journalDocument.findFirst({
        where: { organizationId: ORG, buildingId: building.id, template: { code: "cold_equipment_control" } },
        select: { id: true },
      }))) ||
    (await db.journalDocument.findFirst({ where: { organizationId: ORG }, select: { id: true }, orderBy: { createdAt: "asc" } }));
  if (document && building) {
    await db.journalDocument.update({ where: { id: document.id }, data: { buildingId: building.id } });
  }
  if (document) {
    const journal = await generateJournalDocumentPdf({ documentId: document.id, organizationId: ORG });
    await savePdf("journal", journal.buffer);
  }

  // 3. ППК: программа и план ХАССП.
  const bundle = await loadPpkBundle(ORG);
  await savePdf("ppk-program", buildPpkProgramPdf(bundle));
  await savePdf("haccp-plan", buildHaccpPlanPdf(bundle));

  // 4. Приказ (бланк из каталога) с логотипом и цветом.
  const orgBlock = await loadDocumentOrgBlock(ORG);
  if (!orgBlock) throw new Error("нет организации");
  const order = renderOrderPdf({
    template: ORDER_TEMPLATES.find((t) => t.code === "haccp-responsible") ?? ORDER_TEMPLATES[0],
    org: toOrderOrgSnapshot(orgBlock),
    values: {},
    number: "12-ОД",
    issuedAt: new Date("2026-10-17T12:00:00Z"),
    logo: await loadPdfOrgLogo(ORG, orgBlock.brand.logoUrl),
    brandColor: orgBlock.brand.color,
  });
  await savePdf("order", order.buffer);

  // 5. Сводка проверяющего: временный токен (только локальная база).
  const raw = "company-docs-sample-token-000000000001";
  await db.inspectorToken.deleteMany({ where: { tokenHash: hashInspectorToken(raw) } });
  const now = new Date();
  await db.inspectorToken.create({
    data: {
      organizationId: ORG,
      tokenHash: hashInspectorToken(raw),
      label: "Образец сводки (company-docs)",
      periodFrom: new Date(now.getTime() - 30 * 86_400_000),
      periodTo: now,
      expiresAt: new Date(now.getTime() + 86_400_000),
    },
  });
  const { GET } = await import("@/app/api/inspector/[token]/pdf/route");
  const response = await GET(new Request(`http://localhost:3041/api/inspector/${raw}/pdf?p=month`), {
    params: Promise.resolve({ token: raw }),
  });
  if (!response.ok) throw new Error(`сводка: HTTP ${response.status} ${await response.text()}`);
  await savePdf("inspector-summary", new Uint8Array(await response.arrayBuffer()));
  console.log("inspector token", raw);

  // 6. SVG-логотип через тот же путь, что загрузка в кабинете (очистка →
  //    файл в БД → растр на сервере), затем снова PNG для плакатов.
  if (document) {
    const svg = prepareOrgLogo(
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="96" viewBox="0 0 360 96"><rect x="4" y="8" width="80" height="80" rx="20" fill="#c2410c"/><circle cx="44" cy="48" r="20" fill="#fff"/><text x="100" y="64" font-family="sans-serif" font-size="44" font-weight="700" fill="#1c1917">Точки SVG</text></svg>',
      ),
      "image/svg+xml",
    );
    if (!svg.ok) throw new Error(svg.error);
    await setOrgLogo(ORG, { bytes: svg.bytes, mime: svg.mime });
    const journalSvg = await generateJournalDocumentPdf({ documentId: document.id, organizationId: ORG });
    await savePdf("journal-svg", journalSvg.buffer);
    await setOrgLogo(ORG, { bytes: logoPng(), mime: "image/png" });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
