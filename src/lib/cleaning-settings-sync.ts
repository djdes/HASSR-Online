export type CleaningSettingsSnapshot = {
  title: string;
  cleaningRole: string;
  cleaningUserId: string;
  controlRole: string;
  controlUserId: string;
};

export function shouldSyncCleaningSettings(
  previousDocumentId: string,
  nextDocumentId: string,
  previous: CleaningSettingsSnapshot,
  next: CleaningSettingsSnapshot,
): boolean {
  return previousDocumentId !== nextDocumentId ||
    previous.title !== next.title ||
    previous.cleaningRole !== next.cleaningRole ||
    previous.cleaningUserId !== next.cleaningUserId ||
    previous.controlRole !== next.controlRole ||
    previous.controlUserId !== next.controlUserId;
}
