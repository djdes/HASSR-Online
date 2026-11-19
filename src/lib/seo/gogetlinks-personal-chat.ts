import { parse } from "node-html-parser";

export function gglPersonalThreadKey(campaignId: number, siteId: number): string {
  return `personal:${campaignId}:${siteId}`;
}

export function parseGglPersonalThreadKey(key: string) {
  const match = /^personal:([1-9]\d*):([1-9]\d*)$/.exec(key);
  if (!match) return null;
  const campaignId = Number(match[1]);
  const siteId = Number(match[2]);
  return Number.isSafeInteger(campaignId) && Number.isSafeInteger(siteId) ? { campaignId, siteId } : null;
}

export function parseGglPersonalHistory(html: string, threadKey: string) {
  const document = parse(html);
  const history = document.querySelector("#message_print_list");
  if (!history && !document.querySelector("#pm_content #post_form")) return null;
  const messages = (history?.querySelectorAll(".private-message__item") ?? []).flatMap(item => {
    const text = item.querySelector(".message_text[data-id]");
    const id = text?.getAttribute("data-id");
    const sender = item.querySelector(".private-message__name")?.text.trim();
    const date = item.querySelector(".private-message__date")?.text.trim();
    if (!text || !id || !sender || !date) return [];
    const timestamp = date.replace(/^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}:\d{2})$/, "$3-$2-$1T$4:00+03:00");
    const body = parse(text.innerHTML.replace(/<br\s*\/?>/gi, "\n")).text.trim();
    return body ? [{
      id: `${threadKey}:${id}`, sender, date: timestamp, text: body,
      direction: /^оптимизатор(?:\s|$)/i.test(sender) ? "outbound" : "inbound",
    }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
  const script = document.querySelectorAll("script").find(node => node.rawText.includes("PrivateMessagePersonalData.unreadMessageIds"));
  const unread = script?.rawText.match(/PrivateMessagePersonalData\.unreadMessageIds\s*=\s*\[([^\]]*)\]/)?.[1];
  return { messages, unreadCount: unread?.match(/\d+/g)?.length ?? 0 };
}
