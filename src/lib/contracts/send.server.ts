import { db } from "@/lib/db";
import { isEmailDeliveryConfigured, renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";

import { defaultContractMessage, defaultContractSubject } from "./email-copy";
import { cleanRecipientList } from "./recipients";
import { renderClientContractPdf } from "./render.server";
import { ContractError, readBuyer, readParams, readSeller } from "./service.server";
import { buyerDisplayName } from "./template";

/**
 * Отправка договора письмом с PDF во вложении. Статус «отправлен» ставится
 * только если транспорт принял письмо: без SMTP (локально) письмо лишь
 * пишется в лог, и договор остаётся «выпущен» — вызывающий показывает это
 * человеку, а не делает вид, что всё ушло.
 */

export type ContractSendResult =
  | { ok: true; sentTo: string[] }
  | { ok: false; reason: "not_configured" | "transport_failed"; sentTo: string[] };

function messageHtml(message: string): string {
  return message
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 14px;color:#3c4053;line-height:1.6">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export async function sendClientContractEmail(input: {
  contractId: string;
  to: string[];
  subject?: string | null;
  message?: string | null;
  /**
   * Кто отправляет. Пока письмо уходит с общего адреса платформы; позже
   * лид переведёт отправку на личный SMTP сотрудника — параметр для этого.
   */
  senderUserId: string | null;
}): Promise<ContractSendResult> {
  const row = await db.clientContract.findUnique({ where: { id: input.contractId } });
  if (!row) throw new ContractError("contract_not_found", 404, "Договор не найден");
  if (row.status === "voided") throw new ContractError("voided", 409, "Договор аннулирован — отправить его нельзя");
  const { valid } = cleanRecipientList(input.to);
  if (!valid.length) throw new ContractError("no_recipients", 400, "Укажите хотя бы один адрес почты");

  const seller = readSeller(row.seller);
  const buyerName = buyerDisplayName(readBuyer(row.buyer), readParams(row.params));
  const date = row.issuedAt.toISOString().slice(0, 10);
  const subject = input.subject?.trim() || defaultContractSubject(row.number);
  const message = input.message?.trim() || defaultContractMessage({ buyerName, number: row.number, date, sellerEmail: seller.email });
  const file = await renderClientContractPdf(row.id);
  const html = renderEmailLayout(
    `Договор № ${row.number}`,
    `${messageHtml(message)}<p style="margin:18px 0 0;font-size:13px;color:#6f7282">Вложение: ${escapeHtml(file.fileName)}</p>`,
  );

  const delivered = await sendRawEmail(valid.join(", "), subject, html, {
    replyTo: seller.email || null,
    attachments: [{ filename: file.fileName, content: file.bytes, contentType: "application/pdf" }],
  });
  if (!delivered) {
    return { ok: false, reason: isEmailDeliveryConfigured() ? "transport_failed" : "not_configured", sentTo: valid };
  }

  const sentTo = [...new Set([...row.sentTo, ...valid])];
  await db.clientContract.update({
    where: { id: row.id },
    data: { status: "sent", sentAt: new Date(), sentTo, sentByUserId: input.senderUserId },
  });
  return { ok: true, sentTo: valid };
}
