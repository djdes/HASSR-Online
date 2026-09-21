/**
 * Стартовый набор доступов к журналам у нового сотрудника.
 *
 * ПОЧЕМУ отдельный модуль: сотрудник заводится двумя путями — руководитель
 * через «Сотрудники» (`createStaffMember`) и сам по QR-приглашению
 * (`POST /api/join/[token]`). Правило должно быть одно, иначе получается
 * то, что и получилось: по QR человек регистрировался с
 * `journalAccessMigrated = true` и пустым `UserJournalAccess` — а это в
 * `hasJournalAccess` значит «доступа нет ни к одному журналу». Человек
 * видел пустой список там, где приглашение обещало «сразу получит доступ».
 *
 * Правило: строгий режим включаем ТОЛЬКО когда у должности реально
 * настроены журналы. Не настроены — оставляем `journalAccessMigrated`
 * выключенным, и сотрудник работает в прежнем режиме (журналы видны),
 * ровно как у созданного руководителем вручную.
 */

export type JournalAccessBootstrap = {
  /** Ставить ли `User.journalAccessMigrated` (строгий режим ACL). */
  journalAccessMigrated: boolean;
  /** Коды журналов, которые нужно записать в `UserJournalAccess`. */
  grantedTemplateCodes: string[];
};

/**
 * @param positionTemplateCodes коды журналов из `JobPositionJournalAccess`
 *                              выбранной должности
 */
export function resolveJournalAccessBootstrap(
  positionTemplateCodes: readonly string[]
): JournalAccessBootstrap {
  const grantedTemplateCodes = Array.from(
    new Set(
      positionTemplateCodes
        .map((code) => (typeof code === "string" ? code.trim() : ""))
        .filter((code) => code !== "")
    )
  );
  return {
    journalAccessMigrated: grantedTemplateCodes.length > 0,
    grantedTemplateCodes,
  };
}
