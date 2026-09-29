import { buildProposalContent, type ProposalContent } from "./content";
import { loadProposalContext } from "./context.server";
import { renderProposalEmailHtml } from "./email";
import { renderProposalPdfDocument } from "./pdf";
import { proposalPdfUrl, proposalWebUrl } from "./token";
import type { ProposalEmailOptions, ProposalVars, RenderedProposalEmail } from "./types";

/**
 * Коммерческое предложение (КП): PDF на одном листе A4, письмо и
 * веб-версия по подписанной ссылке. Интерфейс — по спеке proposal-kp
 * (им пользуется рассылка), сигнатуры не менять.
 *
 * Цена, акция, реквизиты и отправитель по умолчанию читаются из базы на
 * момент отрисовки (`context.server.ts`), тексты — `content.ts`.
 * Логи — `[kp] …` на каждой отрисовке.
 */

export type { ProposalPromo, ProposalSender, ProposalVars } from "./types";
export { PROPOSAL_SPHERES } from "./spheres";
/** Веб-версия КП: `<база>/kp/<подписанный токен>` (реализация — `token.ts`, без базы). */
export { proposalWebUrl };

async function contentFor(vars: ProposalVars): Promise<ProposalContent> {
  const context = await loadProposalContext();
  return buildProposalContent(vars, context);
}

export async function renderProposalPdf(vars: ProposalVars): Promise<Buffer> {
  const started = Date.now();
  const content = await contentFor(vars);
  const render = renderProposalPdfDocument(content);
  console.info(
    `[kp] pdf rendered sphere=${content.sphere} promo=${content.offer.promoCode ?? "-"} cta=${content.offer.ctaKind} scale=${render.scale} bytes=${render.buffer.length} ms=${Date.now() - started}`,
  );
  return render.buffer;
}

/** Ссылка — наша веб-версия КП (к ней есть PDF по тому же токену). */
function isProposalWebUrl(url: string): boolean {
  try {
    return /^\/kp\/[^/]+$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export async function renderProposalEmail(
  vars: ProposalVars,
  opts: ProposalEmailOptions = {},
): Promise<RenderedProposalEmail> {
  const started = Date.now();
  const content = await contentFor(vars);
  const web = opts.webUrl === undefined ? proposalWebUrl(vars) : opts.webUrl;
  const rendered = renderProposalEmailHtml(content, {
    web: web ?? null,
    pdf: web && isProposalWebUrl(web) ? proposalPdfUrl(web) : null,
    unsubscribe: opts.unsubscribeUrl ?? null,
    trackUrl: opts.trackUrl,
  });
  console.info(
    `[kp] email rendered sphere=${content.sphere} promo=${content.offer.promoCode ?? "-"} cta=${content.offer.ctaKind} html=${Buffer.byteLength(rendered.html, "utf8")}B tracked=${opts.trackUrl ? "yes" : "no"} unsubscribe=${opts.unsubscribeUrl ? "yes" : "no"} ms=${Date.now() - started}`,
  );
  return rendered;
}

