/**
 * Электронная отметка под листами документа.
 *
 * Это НЕ печать организации и не её имитация: прямоугольный штамп в
 * стиле визуализации электронной подписи (как на выписках из госсистем)
 * с реквизитами и контрольным кодом версии содержимого, а рядом круглая
 * отметка системы «WeSetup · электронный журнал ХАССП».
 */
export type ElectronicMarkProps = {
  orgName: string;
  inn: string | null;
  journal: string;
  period: string;
  generatedAt: string;
  responsible: string | null;
  controlCode: string;
};

export function ElectronicMark(props: ElectronicMarkProps) {
  const rows: Array<[string, string]> = [
    ["Организация", props.orgName],
    ...(props.inn ? ([["ИНН", props.inn]] as Array<[string, string]>) : []),
    ["Журнал", props.journal],
    ["Период", props.period],
    ["Сформирован", props.generatedAt],
    ["Ответственный", props.responsible ?? "не назначен"],
  ];
  return (
    <figure
      className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-center sm:gap-6"
      aria-label="Электронная отметка документа"
      data-electronic-mark
    >
      <div className="w-full max-w-[440px] rounded-[3px] border-[1.5px] border-[#1f3a8a] bg-white p-[3px] text-[#1f3a8a] shadow-[0_10px_24px_-20px_rgba(31,58,138,0.6)]">
        <div className="rounded-[2px] border border-[#1f3a8a]/70 px-4 py-3">
          <div className="border-b border-[#1f3a8a]/40 pb-2 text-center text-[11.5px] font-semibold tracking-[0.06em]">
            ДОКУМЕНТ СФОРМИРОВАН В ЭЛЕКТРОННОМ ВИДЕ
          </div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px] leading-snug">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-[#1f3a8a]/75">{k}</dt>
                <dd className="min-w-0 break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-[#1f3a8a]/40 pt-2 text-[12px]">
            <span className="text-[#1f3a8a]/75">Контрольный код</span>
            <span className="font-mono text-[14px] font-semibold tracking-[0.08em] tabular-nums" data-control-code>
              {props.controlCode}
            </span>
          </div>
        </div>
      </div>
      <SystemSeal />
    </figure>
  );
}

function SystemSeal() {
  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <svg viewBox="0 0 120 120" className="size-[112px] text-[#1f3a8a] opacity-90" role="img" aria-label="Отметка системы WeSetup">
        <defs>
          <path id="wsi-seal-ring" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <circle cx="60" cy="60" r="57" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="0.7" />
        <circle cx="60" cy="60" r="33" fill="none" stroke="currentColor" strokeWidth="0.7" />
        <text fontSize="8.6" letterSpacing="1.2" fill="currentColor" fontFamily="Georgia, 'Times New Roman', serif">
          <textPath href="#wsi-seal-ring" startOffset="0">
            WESETUP · ЭЛЕКТРОННЫЙ ЖУРНАЛ ХАССП ·
          </textPath>
        </text>
        <text x="60" y="57" textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor" fontFamily="Georgia, 'Times New Roman', serif">
          ЭЛЕКТР.
        </text>
        <text x="60" y="70" textAnchor="middle" fontSize="9" fill="currentColor" fontFamily="Georgia, 'Times New Roman', serif">
          ЖУРНАЛ
        </text>
      </svg>
      <figcaption className="max-w-[150px] text-center text-[10.5px] leading-tight text-[#8a8f9c]">
        Отметка системы, не печать организации
      </figcaption>
    </div>
  );
}
