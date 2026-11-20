import { db } from "@/lib/db";
import {
  sampleExchangeLetters,
  type SampleLettersRefusal,
  type SampleLettersResult,
} from "@/lib/directory-exchange/sample-letters";
import { isEmailDeliveryConfigured, renderEmailLayout, sendRawEmail } from "@/lib/email";
import { isTechnicalEmail } from "@/lib/technical-email";

const APP_URL = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");

/**
 * Отправить ROOT на его же почту образцы писем обмена с другой компанией
 * (серия A, Р3) — тем же путём, что настоящие (`requests.server.ts`):
 * `renderEmailLayout` + `sendRawEmail`. `delivered` — принял ли письмо
 * почтовый сервер; при ненастроенной почте (dev) письмо уходит в журнал.
 */
export async function sendSampleExchangeLetters(
  userId: string,
  now: Date = new Date()
): Promise<SampleLettersResult | SampleLettersRefusal> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, contactEmail: true } });
  const to =
    [user?.contactEmail, user?.email]
      .map((value) => (value ?? "").trim())
      .find((value) => value.includes("@") && !isTechnicalEmail(value)) ?? null;
  if (!to) {
    return { ok: false, code: "no_email", error: "У вашей учётной записи нет рабочей почты — образцы некуда отправить." };
  }

  const letters: SampleLettersResult["letters"] = [];
  for (const { kind, letter } of sampleExchangeLetters(APP_URL, now)) {
    let delivered = false;
    try {
      delivered = await sendRawEmail(to, letter.subject, renderEmailLayout(letter.title, letter.body));
    } catch (error) {
      console.error("[directory-exchange] sample letter failed", { kind, error });
    }
    letters.push({ kind, delivered });
  }
  const configured = isEmailDeliveryConfigured();
  console.info("[directory-exchange] sample letters sent", { userId, configured, letters });
  return { ok: true, configured, to, letters };
}
