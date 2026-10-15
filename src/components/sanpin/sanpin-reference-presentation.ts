import type { SanPinNorm } from "@/lib/sanpin-norms";
import type { Messages } from "@/i18n/messages";

export const SANPIN_REFERENCE_CATEGORIES = [
  { key: "temperature", emoji: "🌡️" }, { key: "shelf_life", emoji: "⏳" },
  { key: "incoming", emoji: "📦" }, { key: "hygiene", emoji: "🧤" },
  { key: "cleaning", emoji: "🧹" }, { key: "haccp", emoji: "🛡️" },
  { key: "calibration", emoji: "⚙️" }, { key: "pest_control", emoji: "🐛" },
  { key: "writeoff", emoji: "🗑️" }, { key: "general", emoji: "📋" },
] as const;

/** Return a presentation copy; source norms and their category/ID never change. */
export function presentSanpinNorm(norm: SanPinNorm, messages: Messages["sanpinReference"]): SanPinNorm {
  if (!Object.hasOwn(messages.norms, norm.id)) return { ...norm };
  const translated = messages.norms[norm.id as keyof typeof messages.norms];
  return { ...norm, ...translated, id: norm.id, category: norm.category };
}
