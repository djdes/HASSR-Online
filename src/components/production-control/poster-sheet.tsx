import type { Poster } from "@/lib/ppk/posters";
import type { PpkPrintOrg } from "./ppk-print-sheet";

/** Цвета разделочного инвентаря для кружков в таблице маркировки. */
const BOARD_COLOR: Record<string, string> = {
  красный: "#d93a3a",
  жёлтый: "#f2c230",
  синий: "#3a7bd9",
  зелёный: "#3fa05a",
  коричневый: "#8a5a3a",
  белый: "#ffffff",
};

/**
 * Лист плаката A4. `print` — крупный лист для печати и просмотра; `preview` —
 * мини-лист в сетке списка: логотип, заголовок и первые пункты мелко.
 * Без хуков: страница собирает его на сервере.
 */
export function PosterSheet({
  poster,
  org,
  size = "print",
}: {
  poster: Poster;
  org: PpkPrintOrg;
  size?: "print" | "preview";
}) {
  if (size === "preview") {
    return (
      <div className="flex h-full flex-col overflow-hidden bg-white p-3 text-[#0b1024]">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt="" className="h-4 w-auto max-w-[60px] object-contain" />
        ) : (
          <div className="truncate text-[7px] font-semibold text-[#6f7282]">{org.orgName}</div>
        )}
        <div className="mt-2 text-[11px] font-bold leading-tight">{poster.title}</div>
        <ul className="mt-2 space-y-1 text-[7.5px] leading-snug text-[#3c4053]">
          {poster.items.slice(0, 4).map((item) => (
            <li key={item} className="line-clamp-2">
              {item}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <article className="mx-auto flex min-h-[1123px] w-full max-w-[794px] flex-col rounded-3xl border border-[#ececf4] bg-white p-10 text-[#0b1024] shadow-[0_20px_60px_-40px_rgba(11,16,36,0.35)] print:min-h-[277mm] print:max-w-none print:rounded-none print:border-0 print:p-12 print:shadow-none">
      <header className="flex items-center gap-4">
        {org.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={org.logoUrl} alt="" className="h-14 w-auto max-w-[180px] object-contain" />
        ) : null}
        <div className="min-w-0 text-[15px] font-semibold">{org.orgName}</div>
      </header>

      <h2 className="mt-8 text-[34px] font-bold leading-[1.15] tracking-[-0.02em]">{poster.title}</h2>

      {poster.numbered ? (
        <ol className="mt-8 space-y-4">
          {poster.items.map((item, index) => (
            <li key={item} className="flex items-start gap-4 text-[20px] leading-[1.45]">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#5566f6] text-[16px] font-semibold text-white">
                {index + 1}
              </span>
              <span className="pt-1">{item}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mt-8 space-y-4">
          {poster.items.map((item) => (
            <li key={item} className="flex items-start gap-4 text-[20px] leading-[1.45]">
              <span className="mt-[0.7em] size-2.5 shrink-0 rounded-full bg-[#5566f6]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}

      {poster.table ? (
        <table className="mt-8 w-full border-collapse text-[18px]">
          <thead>
            <tr>
              {poster.table.head.map((head) => (
                <th key={head} className="border border-[#0b1024] px-3 py-2 text-left font-semibold">
                  {head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {poster.table.rows.map(([mark, purpose, color]) => (
              <tr key={mark}>
                <td className="border border-[#0b1024] px-3 py-2 font-semibold">{mark}</td>
                <td className="border border-[#0b1024] px-3 py-2">{purpose}</td>
                <td className="border border-[#0b1024] px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block size-5 rounded-full border border-[#0b1024]"
                      style={{ background: BOARD_COLOR[color] ?? "transparent" }}
                      aria-hidden
                    />
                    {color}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="mt-auto pt-10">
        {poster.note ? <p className="text-[17px] leading-[1.5] text-[#3c4053]">{poster.note}</p> : null}
        <div className="mt-6 text-[12px] text-[#6f7282]">{org.orgName} · WeSetup</div>
      </div>
    </article>
  );
}
