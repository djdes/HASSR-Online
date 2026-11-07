/**
 * План публикации вертикальных роликов «Журналы, которые заполняются сами»:
 *
 *   npx tsx scripts/landing-video/clips-plan.ts --start 2026-11-09 --time 12:00 --md docs/clips-publication-plan.md --ics <файл.ics>
 *
 * По ролику в 2–3 дня (пн, ср, пт), VK Клипы и Telegram-канал (MAX — тем же
 * текстом, что Telegram). Тексты и ссылки с метками — из `autofillClipCaption`
 * и `autofillClipUrl` (src/lib/autofill-offer.ts), те же, что
 * `npm run video:render:clips` кладёт рядом с роликами. Календарь .ics —
 * напоминания владельцу в день публикации.
 */
import { writeFileSync } from "node:fs";

import {
  AUTOFILL_CLIP,
  AUTOFILL_CLIP_PLATFORM_LABEL,
  AUTOFILL_CLIP_SCENES,
  autofillClipBasename,
  autofillClipCaption,
  autofillClipUrl,
  autofillScene,
} from "@/lib/autofill-offer";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Пн, ср, пт, пн, ср — по ролику в 2–3 дня. */
const OFFSETS_DAYS = [0, 2, 4, 7, 9];
const DAY_MS = 86_400_000;
const MSK_OFFSET_HOURS = 3;

function publicationTimes(startDay: string, time: string): Date[] {
  const [hours, minutes] = time.split(":").map(Number);
  const base = Date.parse(`${startDay}T00:00:00Z`);
  if (!Number.isFinite(base) || !Number.isFinite(hours) || !Number.isFinite(minutes)) throw new Error("--start ГГГГ-ММ-ДД и --time ЧЧ:ММ");
  if (new Date(base).getUTCDay() !== 1) throw new Error("--start — понедельник");
  return OFFSETS_DAYS.map((offset) => new Date(base + offset * DAY_MS + ((hours - MSK_OFFSET_HOURS) * 60 + minutes) * 60_000));
}

const dayLabel = (date: Date) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", weekday: "short", day: "numeric", month: "long" }).format(date);

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545: строки длиннее 75 байт переносятся, продолжение — с пробела. */
function fold(line: string): string {
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (Buffer.byteLength(current + char, "utf8") > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
    }
    current += char;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function main() {
  const start = option("start") ?? "2026-11-09";
  const time = option("time") ?? "12:00";
  const times = publicationTimes(start, time);
  const rows = AUTOFILL_CLIP_SCENES.map((sceneId, index) => ({ sceneId, at: times[index], basename: autofillClipBasename(sceneId), scene: autofillScene(sceneId) }));

  const md: string[] = [
    "# План публикации роликов «Журналы, которые заполняются сами»",
    "",
    `Составлен 07.11.2026. Пять вертикальных роликов по ${AUTOFILL_CLIP.durationSeconds} секунд (1080×1920, без звука) — архив`,
    "`wesetup-clips-2026-11.zip`: ролик `.mp4`, обложка `.jpg` и тексты к публикации для каждой площадки.",
    "",
    "## Где и когда",
    "",
    `- **${AUTOFILL_CLIP_PLATFORM_LABEL.vk}** и **${AUTOFILL_CLIP_PLATFORM_LABEL.telegram}** WeSetup — один и тот же ролик в один день.`,
    `  ${AUTOFILL_CLIP_PLATFORM_LABEL.max} — по желанию, текстом для Telegram (ссылка с меткой \`utm_source=max\` — в файле \`-max.txt\`).`,
    `- По ролику в 2–3 дня: понедельник, среда, пятница, в ${time} по Москве. Время одно и то же — так проще сравнить ролики`,
    "  между собой; если по статистике аудитория активнее в другое время, сдвиньте все публикации.",
    "- Звука нет: при публикации можно добавить фоновую музыку из библиотеки площадки.",
    "",
    "| Дата | Ролик | Файл |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${dayLabel(row.at)}, ${time} | ${row.scene.chapter ?? row.scene.title}: ${row.scene.title} | \`${row.basename}.mp4\` |`),
    "",
    "## Как поставить заранее",
    "",
    "- **Telegram:** в канале прикрепите ролик, вставьте текст и удерживайте кнопку отправки → «Отправить позже» → дата и время.",
    "- **VK:** если площадка даёт отложить публикацию — выберите дату и время при публикации; если нет — публикуйте в день",
    "  по плану: напоминания — в файле календаря `clips-publication-plan.ics` (импортируйте в Google, Яндекс или iPhone-календарь).",
    "",
    "## Как понять, что работает",
    "",
    "- Ссылка в каждом тексте ведёт на wesetup.ru/avtozapolnenie с метками: площадка (`utm_source=vk` или `telegram`),",
    "  ролик (`utm_medium=clip`, `utm_campaign=autofill-<сцена>`). Регистрации по ним видны в ROOT → «Воронка» в строках",
    "  «ВКонтакте» и «Telegram» и в понедельничной сводке в Telegram.",
    "- На площадках смотрите просмотры и досмотры: какой ролик держит внимание до конца.",
    "- Через две недели повторите лучший ролик с другим первым кадром или текстом; новые ролики собираются командой",
    "  `npm run video:render:clips` (см. `scripts/landing-video/render-clips.ts`).",
    "",
    "## Тексты к публикации",
    "",
  ];
  for (const row of rows) {
    md.push(`### ${dayLabel(row.at)} — ${row.scene.title}`, "", `Файл: \`${row.basename}.mp4\`, обложка \`${row.basename}.jpg\`.`, "");
    for (const platform of ["vk", "telegram"] as const) {
      md.push(`**${AUTOFILL_CLIP_PLATFORM_LABEL[platform]}** (\`${row.basename}-${platform}.txt\`):`, "", "```text", autofillClipCaption(row.sceneId, platform), "```", "");
    }
  }

  const now = new Date();
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WeSetup//Clips plan//RU",
    "CALSCALE:GREGORIAN",
    ...rows.flatMap((row) => [
      "BEGIN:VEVENT",
      `UID:wesetup-clip-${row.sceneId}-${start}@wesetup.ru`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART:${icsDate(row.at)}`,
      `DTEND:${icsDate(new Date(row.at.getTime() + 15 * 60_000))}`,
      fold(`SUMMARY:${icsText(`Опубликовать ролик: ${row.scene.title}`)}`),
      fold(
        `DESCRIPTION:${icsText(
          `VK Клипы и Telegram-канал. Файл ${row.basename}.mp4, тексты — ${row.basename}-vk.txt и ${row.basename}-telegram.txt. Ссылка VK: ${autofillClipUrl(row.sceneId, "vk")}`,
        )}`,
      ),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      fold(`DESCRIPTION:${icsText(`Ролик: ${row.scene.title}`)}`),
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  const mdPath = option("md");
  const icsPath = option("ics");
  if (mdPath) writeFileSync(mdPath, `${md.join("\n").trimEnd()}\n`);
  if (icsPath) writeFileSync(icsPath, ics);
  if (!mdPath && !icsPath) console.log(md.join("\n"));
  console.log(`План: ${rows.map((row) => `${row.at.toISOString()} ${row.sceneId}`).join("; ")}`);
}

main();
