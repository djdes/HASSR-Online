import { createCanvas, loadImage } from "@napi-rs/canvas";

import {
  BRAND_COLORS as C,
  BRAND_PAGE,
  BrandFlow,
  brandSeller,
  createBrandPdf,
  decoratePages,
  drawFramedQr,
  partyRows,
  sectionTitle,
  setText,
  signatureLine,
  type BrandSeller,
} from "@/lib/brand-docs/pdf-kit";

export const GOOGLE_PLAY_AUTH_PACKAGE_ID = "app.wedo4u.setuphelper";
export const GOOGLE_PLAY_AUTH_GRANTEE_RU = "Ольге Каракьяновой";
export const GOOGLE_PLAY_AUTH_GRANTEE_NOMINATIVE_RU = "Каракьянова Ольга";
export const GOOGLE_PLAY_AUTH_GRANTEE_EN = "Olga Karakyanova";
export const GOOGLE_PLAY_AUTH_SIGNER_RU = "Волков Денис Владимирович";
export const GOOGLE_PLAY_AUTH_SIGNER_SHORT_RU = "Волков Д. В.";
export const GOOGLE_PLAY_AUTH_SIGNER_POST_RU = "Генеральный директор ООО «БФС»";
export const GOOGLE_PLAY_AUTH_DATE_RU = "27 ноября 2026 г.";
export const GOOGLE_PLAY_AUTH_DATE_ISO = "2026-11-27";

export const GOOGLE_PLAY_AUTH_PAGE_PATH = "/setup-helper/google-play-authorization";
export const GOOGLE_PLAY_AUTH_PDF_PATH = "/setup-helper/google-play-authorization.pdf";
export const GOOGLE_PLAY_AUTH_SIGNATURE_IMAGE_PATH =
  "/setup-helper/google-play-authorization-signature.png";
export const GOOGLE_PLAY_AUTH_URL = `https://wesetup.ru${GOOGLE_PLAY_AUTH_PAGE_PATH}`;

/**
 * Официальный текст разрешения правообладателя ООО «БФС» для публикации
 * приложения «Сетап помощник» в Google Play.
 */
export const GOOGLE_PLAY_AUTH_STATEMENT_RU =
  "Я, Волков Денис Владимирович, действуя от имени ООО «БФС», разрешаю Ольге Каракьяновой публиковать и обновлять приложение «Сетап помощник» в Google Play под идентификатором app.wedo4u.setuphelper, распространять его бесплатно для пользователей и использовать название, значок и скриншоты в карточке магазина.";

export const GOOGLE_PLAY_AUTH_STATEMENT_EN =
  'I, Denis Vladimirovich Volkov, General Director acting on behalf of BFS LLC (OOO "BFS", INN 5018215599, KPP 501801001, OGRN 1235000105306, official website https://wesetup.ru), hereby authorize Olga Karakyanova to publish and update the "Сетап помощник" (Setup Helper) mobile application on Google Play under the package identifier app.wedo4u.setuphelper, distribute it free of charge to users, and use the application name, icon, and screenshots in the Google Play store listing.';

export const DEFAULT_BFS_SELLER: BrandSeller = brandSeller({
  nameShort: "ООО «БФС»",
  nameFull: "Общество с ограниченной ответственностью «БФС»",
  inn: "5018215599",
  kpp: "501801001",
  ogrn: "1235000105306",
  address: "141065, Московская область, г. Королёв, ул. Ленина, д. 10/6",
  phone: "+7 (495) 109-65-43",
  email: "admin@wesetup.ru",
  site: "wesetup.ru",
  head: {
    post: "Генеральный директор",
    name: "Волков Денис Владимирович",
  },
  bank: {
    name: "",
    bik: "",
    account: "",
    corrAccount: "",
  },
});

export type LegalSignImages = {
  facsimile: Buffer | null;
  stamp: Buffer | null;
};

/**
 * Официальное письмо-разрешение на фирменном бланке ООО «БФС» (A4 PDF) с
 * факсимиле руководителя, круглой печатью и QR-ссылкой на публичную страницу
 * подтверждения на домене wesetup.ru. Подходит для прикрепления в форму
 * Advance Notice / Intellectual Property в Google Play Console.
 */
export function renderGooglePlayAuthorizationPdf(
  images: LegalSignImages,
  sellerInput: BrandSeller = DEFAULT_BFS_SELLER,
): Buffer {
  const seller: BrandSeller = {
    ...DEFAULT_BFS_SELLER,
    ...sellerInput,
    nameShort: sellerInput.nameShort || DEFAULT_BFS_SELLER.nameShort,
    nameFull: sellerInput.nameFull || DEFAULT_BFS_SELLER.nameFull,
    inn: sellerInput.inn || DEFAULT_BFS_SELLER.inn,
    kpp: sellerInput.kpp || DEFAULT_BFS_SELLER.kpp,
    ogrn: sellerInput.ogrn || DEFAULT_BFS_SELLER.ogrn,
    address: sellerInput.address || DEFAULT_BFS_SELLER.address,
    phone: sellerInput.phone || DEFAULT_BFS_SELLER.phone,
    email: sellerInput.email || DEFAULT_BFS_SELLER.email,
    site: sellerInput.site || "wesetup.ru",
  };

  const pdf = createBrandPdf({
    title: "Разрешение правообладателя ООО «БФС» на публикацию в Google Play (app.wedo4u.setuphelper)",
    subject: "Google Play IP & Publishing Authorization — app.wedo4u.setuphelper",
    author: "ООО «БФС» (WeSetup)",
  });
  const { doc } = pdf;
  const flow = new BrandFlow(pdf);
  const x = BRAND_PAGE.side;
  const width = BRAND_PAGE.contentW;

  setText(pdf, { size: 18, weight: "semibold", color: C.ink });
  doc.text("Разрешение правообладателя на публикацию в Google Play", x, flow.y + 6.4);
  flow.gap(9.5);
  setText(pdf, { size: 9.5, color: C.muted });
  doc.text(
    "Letter of Authorization for Google Play Publication · Package ID: app.wedo4u.setuphelper",
    x,
    flow.y + 3.2,
  );
  flow.gap(5.8);

  doc.setDrawColor(...C.border2);
  doc.setLineWidth(0.2);
  doc.line(x, flow.y, x + width, flow.y);
  setText(pdf, { size: 9, color: C.ink2 });
  doc.text("г. Королёв, Московская область", x, flow.y + 5.3);
  doc.text(`Исх. № БФС-GP-2026/11 от ${GOOGLE_PLAY_AUTH_DATE_RU}`, x + width, flow.y + 5.3, {
    align: "right",
  });
  doc.line(x, flow.y + 8, x + width, flow.y + 8);
  flow.gap(12.5);

  sectionTitle(pdf, x, flow.y + 4, {
    num: "1",
    title: "Заявление правообладателя (Russian)",
  });
  flow.gap(6.8);
  flow.paragraph(`«${GOOGLE_PLAY_AUTH_STATEMENT_RU}»`, {
    size: 10,
    lh: 1.48,
    color: C.ink,
    weight: "semibold",
    justify: false,
    after: 2.2,
  });
  flow.paragraph(
    "Настоящее разрешение выдано бессрочно (до письменного отзыва правообладателем) и подтверждает полное согласие ООО «БФС» как разработчика и правообладателя сервиса WeSetup (wesetup.ru) и приложения «Сетап помощник» на размещение, обновление и бесплатное распространение указанного приложения в магазине Google Play через аккаунт разработчика Ольги Каракьяновой.",
    {
      size: 9,
      lh: 1.42,
      color: C.ink2,
      justify: false,
      after: 3.5,
    },
  );

  sectionTitle(pdf, x, flow.y + 4, {
    num: "2",
    title: "English Translation for Google Play App Review Team",
  });
  flow.gap(6.8);
  flow.paragraph(`"${GOOGLE_PLAY_AUTH_STATEMENT_EN}"`, {
    size: 9.5,
    lh: 1.45,
    color: C.ink,
    justify: false,
    after: 2,
  });
  flow.paragraph(
    "This authorization remains in full force until revoked in writing by BFS LLC. Verification of this notice is publicly published on the rightsholder's official domain at https://wesetup.ru/setup-helper/google-play-authorization and https://wesetup.ru/setup-helper/privacy.",
    {
      size: 8.5,
      lh: 1.4,
      color: C.ink2,
      justify: false,
      after: 4,
    },
  );

  sectionTitle(pdf, x, flow.y + 4, {
    num: "3",
    title: "Сведения о приложении и правообладателе / Application & Rightsholder Details",
  });
  flow.gap(6.5);
  flow.y =
    partyRows(pdf, {
      x,
      y: flow.y,
      width,
      labelWidth: 58,
      size: 8.5,
      rows: [
        { label: "Правообладатель / Rightsholder", value: `${seller.nameFull} (${seller.nameShort})`, strong: true },
        { label: "Реквизиты / Tax & Reg. IDs", value: `ИНН ${seller.inn} · КПП ${seller.kpp} · ОГРН ${seller.ogrn}` },
        { label: "Юридический адрес / Address", value: seller.address },
        { label: "Официальный сайт и контакты", value: `https://${seller.site} · ${seller.email} · ${seller.phone}` },
        { label: "Уполномоченный издатель / Publisher", value: "Каракьянова Ольга (Olga Karakyanova)", strong: true },
        { label: "Приложение / Application", value: "Сетап помощник (Setup Helper)" },
        { label: "Пакет в Google Play / Package ID", value: GOOGLE_PLAY_AUTH_PACKAGE_ID, strong: true },
        { label: "Публичная страница подтверждения", value: GOOGLE_PLAY_AUTH_URL },
      ],
    }) + 7;

  const signTop = flow.y;
  const qrSize = 28;
  const qrX = x + width - qrSize;
  drawFramedQr(pdf, GOOGLE_PLAY_AUTH_URL, { x: qrX, y: signTop, size: qrSize });
  setText(pdf, { size: 7, color: C.muted });
  doc.text("Проверка на wesetup.ru", qrX + qrSize / 2, signTop + qrSize + 3.6, { align: "center" });

  signatureLine(pdf, {
    x,
    y: signTop + 1,
    width: width - qrSize - 12,
    post: `${GOOGLE_PLAY_AUTH_SIGNER_POST_RU} (General Director, BFS LLC)`,
    name: `${GOOGLE_PLAY_AUTH_SIGNER_SHORT_RU} / D. V. Volkov`,
    facsimile: images.facsimile,
    stamp: images.stamp,
  });

  decoratePages(pdf, seller, {
    pageLabel: () => `Исх. № БФС-GP-2026/11 · ${GOOGLE_PLAY_AUTH_PACKAGE_ID}`,
  });

  return Buffer.from(doc.output("arraybuffer"));
}

/**
 * Скомпонованная карточка с подписью руководителя и печатью ООО «БФС» для
 * показа на веб-страницах. Рисуется на непрозрачном фоне с защитной диагональной
 * микросеткой «Google Play · app.wedo4u.setuphelper», чтобы исходные файлы
 * подписи и печати никогда не отдавались в чистом виде отдельно от документа.
 */
export async function renderGooglePlaySignatureCardPng(
  images: LegalSignImages,
): Promise<Buffer> {
  const width = 920;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Светлый непрозрачный лист документа
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  // Тонкая рамка карточки
  ctx.strokeStyle = "#e6e8f2";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // Защитная диагональная микросетка по всему полю (включая область печати и подписи)
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.19);
  ctx.font = "500 12px sans-serif";
  ctx.fillStyle = "rgba(56, 72, 199, 0.065)";
  const watermark = "ООО «БФС» · ТОЛЬКО ДЛЯ GOOGLE PLAY · app.wedo4u.setuphelper · Ольга Каракьянова   ";
  for (let row = -260; row <= 260; row += 34) {
    ctx.fillText(watermark.repeat(4), -720, row);
  }
  ctx.restore();

  // Левая колонка: должность, реквизиты и дата
  ctx.fillStyle = "#6f7282";
  ctx.font = "600 13px sans-serif";
  ctx.fillText("ПОДПИСЬ И ПЕЧАТЬ ПРАВООБЛАДАТЕЛЯ · RIGHTSHOLDER SIGNATURE & SEAL", 32, 38);

  ctx.fillStyle = "#0b1024";
  ctx.font = "700 20px sans-serif";
  ctx.fillText("Генеральный директор ООО «БФС»", 32, 76);

  ctx.fillStyle = "#3c4053";
  ctx.font = "400 15px sans-serif";
  ctx.fillText("Волков Денис Владимирович (Denis Vladimirovich Volkov)", 32, 102);
  ctx.fillStyle = "#6f7282";
  ctx.font = "400 14px sans-serif";
  ctx.fillText("ИНН 5018215599 · КПП 501801001 · ОГРН 1235000105306", 32, 126);

  // Линия подписи
  const lineX = 32;
  const lineY = 228;
  const lineW = 300;
  ctx.strokeStyle = "#9b9fb3";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(lineX, lineY);
  ctx.lineTo(lineX + lineW, lineY);
  ctx.stroke();

  ctx.fillStyle = "#0b1024";
  ctx.font = "600 18px sans-serif";
  ctx.fillText("/ Волков Д. В. /", lineX + lineW + 16, lineY - 2);

  ctx.fillStyle = "#6f7282";
  ctx.font = "400 13px sans-serif";
  ctx.fillText(`Дата: ${GOOGLE_PLAY_AUTH_DATE_RU} · Пакет: ${GOOGLE_PLAY_AUTH_PACKAGE_ID}`, lineX, 266);

  // Печать (справа/по центру линии) и факсимиле поверх края печати — как на бумажном бланке
  if (images.stamp) {
    try {
      const stampImg = await loadImage(images.stamp);
      const box = 210;
      const scale = Math.min(box / stampImg.width, box / stampImg.height);
      const w = stampImg.width * scale;
      const h = stampImg.height * scale;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.drawImage(stampImg, 560 + (box - w) / 2, 46 + (box - h) / 2, w, h);
      ctx.restore();
    } catch {
      drawFallbackStamp(ctx, 665, 152, 92);
    }
  } else {
    drawFallbackStamp(ctx, 665, 152, 92);
  }

  if (images.facsimile) {
    try {
      const sigImg = await loadImage(images.facsimile);
      const maxW = 240;
      const maxH = 115;
      const scale = Math.min(maxW / sigImg.width, maxH / sigImg.height);
      const w = sigImg.width * scale;
      const h = sigImg.height * scale;
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.drawImage(sigImg, lineX + 38, lineY - h + 18, w, h);
      ctx.restore();
    } catch {
      drawFallbackSignature(ctx, lineX + 46, lineY - 12);
    }
  } else {
    drawFallbackSignature(ctx, lineX + 46, lineY - 12);
  }

  // Тонкий защитный штамп назначения поверх оттиска (не мешает чтению, но исключает вырезку)
  ctx.save();
  ctx.fillStyle = "rgba(56, 72, 199, 0.12)";
  ctx.font = "600 11px sans-serif";
  ctx.fillText("wesetup.ru · Google Play: app.wedo4u.setuphelper", 545, 278);
  ctx.restore();

  return canvas.toBuffer("image/png");
}

function drawFallbackStamp(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.08);
  ctx.strokeStyle = "rgba(37, 78, 184, 0.82)";
  ctx.fillStyle = "rgba(37, 78, 184, 0.85)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();

  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, r - 8, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, r - 30, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.font = "600 10px sans-serif";
  ctx.fillText("МОСКОВСКАЯ ОБЛ. · Г. КОРОЛЁВ", 0, -r + 21);
  ctx.fillText("ИНН 5018215599 · ОГРН 1235000105306", 0, r - 14);

  ctx.font = "700 11px sans-serif";
  ctx.fillText("ОБЩЕСТВО С ОГРАНИЧЕННОЙ", 0, -22);
  ctx.fillText("ОТВЕТСТВЕННОСТЬЮ", 0, -8);
  ctx.font = "700 22px sans-serif";
  ctx.fillText("«БФС»", 0, 18);
  ctx.font = "600 10px sans-serif";
  ctx.fillText("ДЛЯ ДОКУМЕНТОВ", 0, 36);
  ctx.restore();
}

function drawFallbackSignature(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
) {
  ctx.save();
  ctx.strokeStyle = "rgba(22, 52, 156, 0.88)";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, y - 8);
  ctx.bezierCurveTo(x + 18, y - 54, x + 46, y - 52, x + 34, y - 6);
  ctx.bezierCurveTo(x + 26, y + 18, x + 64, y - 38, x + 86, y - 24);
  ctx.bezierCurveTo(x + 102, y - 14, x + 98, y + 4, x + 122, y - 18);
  ctx.bezierCurveTo(x + 146, y - 38, x + 168, y - 10, x + 206, y - 22);
  ctx.stroke();
  ctx.restore();
}
