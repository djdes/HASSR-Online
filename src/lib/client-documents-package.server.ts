import { db } from "@/lib/db";
import { readLegalImage, readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { BRAND_CONTENT_TOP, BRAND_PAGE, brandSeller, createBrandPdf, decoratePages, partyRows, sectionTitle, signatureLine } from "@/lib/brand-docs/pdf-kit";
import { renderClientContractPdf } from "@/lib/contracts/render.server";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { renderEmailLayout } from "@/lib/email";
import { invoiceFilename } from "@/lib/invoices/build";
import { renderInvoice } from "@/lib/invoices/service";
import { sendStaffEmail, type StaffEmailResult } from "@/lib/platform-mail.server";

import { messageHtml } from "./client-documents";
import { defaultPackageMessage, defaultPackageSubject, packageAttachmentList, type PackageDocKind } from "./client-documents-package";

/**
 * Пакет документов клиенту одним письмом (15.11.2026): по запросу клиента —
 * договор, счёт и карточка реквизитов ООО «БФС» в одном письме с личной
 * почты сотрудника (`sendStaffEmail`, как КП и счёт). Документы — те же
 * PDF, что у отдельных кнопок карточки; `plain` — без факсимиле и печати.
 */

export const CLIENT_PACKAGE_AUDIT = "client_documents_package.send";

export type PackageCandidates = {
  contract: { id: string; number: string; date: string } | null;
  invoice: { id: number; amountRub: number } | null;
};

/** Что можно положить в пакет: последний действующий договор и неотменённый счёт. */
export async function loadPackageCandidates(organizationId: string): Promise<PackageCandidates> {
  const [contract, invoice] = await Promise.all([
    db.clientContract.findFirst({ where: { organizationId, status: { not: "voided" } }, orderBy: { createdAt: "desc" }, select: { id: true, number: true, issuedAt: true } }),
    db.paymentOrder.findFirst({ where: { organizationId, paymentMethod: "invoice", status: { not: "cancelled" } }, orderBy: { createdAt: "desc" }, select: { id: true, amountRub: true } }),
  ]);
  return {
    contract: contract ? { id: contract.id, number: contract.number, date: contract.issuedAt.toISOString().slice(0, 10) } : null,
    invoice: invoice ? { id: invoice.id, amountRub: Number(invoice.amountRub) } : null,
  };
}

/** «Волков Денис Владимирович» → «Волков Д. В.». */
function initials(fullName: string): string {
  const [last, first, middle] = fullName.trim().split(/\s+/);
  if (!last) return "";
  return [last, first ? `${first[0]}.` : "", middle ? `${middle[0]}.` : ""].filter(Boolean).join(" ");
}

/** Карточка реквизитов ООО «БФС» — фирменный бланк на одну страницу. */
export async function renderRequisitesCardPdf(options: { plain?: boolean } = {}): Promise<Buffer> {
  const requisites = await readPlatformRequisites();
  const seller = brandSeller({ ...requisites, site: "wesetup.ru" });
  const pdf = createBrandPdf({ title: `Карточка организации ${seller.nameShort}`, author: seller.nameShort });
  let y = BRAND_CONTENT_TOP + 4;
  y += sectionTitle(pdf, BRAND_PAGE.side, y + 4, { title: "Карточка организации", hint: seller.nameShort }) + 4;
  const rows = [
    { label: "Полное наименование", value: seller.nameFull, strong: true },
    { label: "Сокращённое наименование", value: seller.nameShort },
    { label: "ИНН / КПП", value: [seller.inn, seller.kpp].filter(Boolean).join(" / ") },
    { label: "ОГРН", value: seller.ogrn },
    { label: "Юридический адрес", value: seller.address },
    { label: "Банк", value: seller.bank.name },
    { label: "БИК", value: seller.bank.bik },
    { label: "Расчётный счёт", value: seller.bank.account },
    { label: "Корр. счёт", value: seller.bank.corrAccount },
    { label: "Руководитель", value: [seller.head.post, seller.head.name].filter(Boolean).join(" — ") },
    { label: "Телефон", value: seller.phone },
    { label: "Эл. почта", value: seller.email },
    { label: "Сайт", value: seller.site },
    { label: "Налогообложение", value: "Упрощённая система налогообложения, без НДС" },
  ].filter((row) => row.value);
  y = partyRows(pdf, { y, rows, labelWidth: 58, size: 10 }) + 12;
  const [facsimile, stamp] = options.plain
    ? [null, null]
    : await Promise.all([readLegalImage("facsimile", requisites), readLegalImage("stamp", requisites)]);
  signatureLine(pdf, {
    x: BRAND_PAGE.side,
    y,
    width: 110,
    post: `${seller.head.post || "Руководитель"} ${seller.nameShort}`,
    name: initials(seller.head.name),
    facsimile,
    stamp,
  });
  decoratePages(pdf, seller);
  return Buffer.from(pdf.doc.output("arraybuffer"));
}

type PackageFile = { filename: string; content: Buffer };

export type PackageSendResult =
  | { ok: false; status: number; error: string }
  | { ok: true; result: StaffEmailResult; files: string[]; contractId: string | null; invoiceId: number | null };

export async function sendClientDocumentsPackage(args: {
  organizationId: string;
  docs: PackageDocKind[];
  to: string[];
  subject: string | null;
  message: string | null;
  plain: boolean;
  senderUserId: string;
}): Promise<PackageSendResult> {
  const docs = [...new Set(args.docs)];
  if (!docs.length) return { ok: false, status: 400, error: "Выберите хотя бы один документ" };
  const [candidates, block] = await Promise.all([loadPackageCandidates(args.organizationId), loadDocumentOrgBlock(args.organizationId)]);
  const files: PackageFile[] = [];
  if (docs.includes("contract")) {
    if (!candidates.contract) return { ok: false, status: 409, error: "Договор ещё не выпущен — выпустите его в блоке «Договор»" };
    const file = await renderClientContractPdf(candidates.contract.id, { plain: args.plain });
    files.push({ filename: file.fileName, content: file.bytes });
  }
  if (docs.includes("invoice")) {
    if (!candidates.invoice) return { ok: false, status: 409, error: "Счёта нет — выставьте его в блоке «Счёт на оплату»" };
    const rendered = await renderInvoice(candidates.invoice.id, { plain: args.plain });
    if (!rendered) return { ok: false, status: 404, error: "Счёт не найден" };
    files.push({ filename: invoiceFilename(String(candidates.invoice.id)).utf8, content: rendered.pdf });
  }
  if (docs.includes("requisites")) {
    files.push({ filename: "Карточка организации ООО БФС.pdf", content: await renderRequisitesCardPdf({ plain: args.plain }) });
  }
  const companyName = block?.org.shortName ?? "";
  const subject = args.subject?.trim() || defaultPackageSubject(companyName);
  const message = args.message?.trim() || defaultPackageMessage({ companyName, docs, contract: candidates.contract, invoice: candidates.invoice });
  const html = renderEmailLayout(subject, `${messageHtml(message)}${packageAttachmentList(files.map((file) => file.filename))}`);
  const result = await sendStaffEmail({
    senderUserId: args.senderUserId,
    to: args.to,
    subject,
    html,
    attachments: files.map((file) => ({ filename: file.filename, content: file.content, contentType: "application/pdf" })),
  });
  const contractId = docs.includes("contract") ? (candidates.contract?.id ?? null) : null;
  if (result.ok && contractId) {
    const row = await db.clientContract.findUnique({ where: { id: contractId }, select: { sentTo: true } });
    await db.clientContract.update({
      where: { id: contractId },
      data: { status: "sent", sentAt: new Date(), sentTo: [...new Set([...(row?.sentTo ?? []), ...args.to])], sentByUserId: args.senderUserId },
    });
  }
  return { ok: true, result, files: files.map((file) => file.filename), contractId, invoiceId: docs.includes("invoice") ? (candidates.invoice?.id ?? null) : null };
}
