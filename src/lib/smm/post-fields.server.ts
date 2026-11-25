import type { MaxPostDraft } from "@/lib/max/channel-post";

import type { PostReport } from "./quality";
import { newShortCode } from "./service.server";

/** Поля поста из черновика редактора — общие для создания и правки. */
export function postFields(draft: MaxPostDraft, report: PostReport, existingShortCode?: string | null) {
  const buttonUrl = draft.buttonUrl?.trim() || null;
  return {
    text: draft.text,
    images: draft.images,
    buttonText: draft.buttonText?.trim() || null,
    buttonUrl,
    campaign: draft.campaign?.trim() || null,
    rubric: draft.rubric?.trim() || null,
    silent: draft.silent,
    pin: draft.pin,
    disablePreview: draft.disablePreview,
    protect: draft.protect,
    deleteAt: draft.deleteAt ? new Date(draft.deleteAt) : null,
    qualityScore: report.score,
    qualityVerdict: report.verdict,
    // A16: у кнопки — короткая ссылка со счётчиком переходов.
    shortCode: buttonUrl ? (existingShortCode ?? newShortCode()) : (existingShortCode ?? null),
  };
}
