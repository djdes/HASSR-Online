/**
 * Организация в документах раздела «Производственный контроль»: печатные
 * листы, плакаты, PDF Программы ПК и Плана ХАССП. Всё берётся из общего
 * блока сведений для документов (`document-org-block.ts`); прежние плоские
 * поля (`orgName`, `orgInn`, `orgAddress`, `snapshot`) оставлены для листов,
 * которые их уже читают. Чистый модуль — без БД (загрузка —
 * `loadPpkPrintOrg` в `ppk-print-sheet.tsx`).
 */

import {
  documentOrgRequisitesLine,
  toOrderOrgSnapshot,
  type DocumentOrgBlock,
} from "@/lib/document-org-block";
import type { OrderOrgSnapshot } from "@/lib/orders/render";

/** Организация для шапки печатного листа: логотип, реквизиты, фирменный цвет. */
export type PpkPrintOrg = {
  logoUrl: string | null;
  orgName: string;
  orgInn: string | null;
  orgAddress: string | null;
  /** Полный снимок реквизитов (директор нужен для строки «Утверждаю»). */
  snapshot: OrderOrgSnapshot | null;
  /** Блок сведений для документов: реквизиты, правки поверх ЕГРЮЛ, брендинг. */
  block: DocumentOrgBlock;
};

export function ppkPrintOrgFromBlock(block: DocumentOrgBlock): PpkPrintOrg {
  const snapshot = toOrderOrgSnapshot(block);
  return {
    logoUrl: block.brand.logoUrl,
    orgName: block.org.fullName,
    orgInn: block.org.inn,
    orgAddress: block.org.legalAddress,
    snapshot,
    block,
  };
}

/** Реквизиты строкой под названием в шапке листа: «ИНН … · КПП … · ОГРН … · адрес». */
export function ppkRequisitesLine(org: PpkPrintOrg): string {
  return documentOrgRequisitesLine(org.block);
}

/**
 * «1. Общие сведения» Программы производственного контроля — одна таблица на
 * странице и в PDF. Незаполненное — прочерком: программа — документ, где
 * пропуск должен быть виден.
 */
export function ppkGeneralInfoRows(
  org: PpkPrintOrg,
  leader: { name: string; title?: string | null } | null | undefined,
): [string, string][] {
  const { org: o } = org.block;
  const individual = o.ogrnLabel === "ОГРНИП";
  const rows: [string, string | null][] = [
    ["Полное наименование", o.fullName],
    ["Краткое наименование", o.shortName],
    ["ИНН", o.inn],
    ...(individual ? [] : ([["КПП", o.kpp]] as [string, string | null][])),
    [o.ogrnLabel, o.ogrn],
    ["Юридический адрес", o.legalAddress],
    ...(o.address && o.address !== o.legalAddress ? ([["Фактический адрес", o.address]] as [string, string | null][]) : []),
    ["Руководитель", o.directorName ? `${o.directorPost || "Руководитель"}, ${o.directorName}` : null],
    ["Ответственный за производственный контроль", leader ? `${leader.name}${leader.title ? `, ${leader.title}` : ""}` : null],
  ];
  return rows.map(([label, value]) => [label, value || "—"]);
}
