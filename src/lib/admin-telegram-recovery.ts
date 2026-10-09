export type RecoverableAdminMessage = {
  id: string;
  chatId: string;
  body: string;
  status: string;
  createdAt: Date;
};

type RecoveryDeps = {
  claim: (row: RecoverableAdminMessage) => Promise<boolean>;
  send: (row: RecoverableAdminMessage, text: string) => Promise<void>;
  markSent: (row: RecoverableAdminMessage) => Promise<void>;
  markFailed: (row: RecoverableAdminMessage, uncertain: boolean) => Promise<void>;
  pause: () => Promise<void>;
  progress?: (result: RecoveryResult) => void;
};

export type RecoveryResult = { sent: number; failed: number; skipped: number; uncertain: number };

/** Replay only failed administrator deliveries; preserve the original reply anchors. */
export async function recoverAdminTelegramMessages(
  rows: RecoverableAdminMessage[],
  scope: { chatIds: string[]; since: Date },
  deps: RecoveryDeps
): Promise<RecoveryResult> {
  const result: RecoveryResult = { sent: 0, failed: 0, skipped: 0, uncertain: 0 };
  let attempted = false;
  for (const row of rows) {
    if (!scope.chatIds.includes(row.chatId) || row.createdAt < scope.since ||
        !["failed", "rate_limited"].includes(row.status) || row.body.startsWith("[attachment]")) {
      result.skipped++;
      continue;
    }
    if (!(await deps.claim(row))) { result.skipped++; continue; }
    if (attempted) await deps.pause();
    attempted = true;
    const date = row.createdAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    const restored = `🕓 ${date} МСК · доставлено после восстановления\n\n${row.body}`;
    let delivered = false;
    try {
      await deps.send(row, restored.length <= 4096 ? restored : row.body);
      delivered = true;
      await deps.markSent(row);
      result.sent++;
    } catch {
      // A confirmed send with an unrecorded DB acknowledgement must not be replayed.
      await deps.markFailed(row, delivered);
      if (delivered) result.uncertain++;
      else result.failed++;
    }
    deps.progress?.({ ...result });
  }
  return result;
}
