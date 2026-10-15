import { DEFAULT_CONTROL_PERIODICITY, LEGACY_DEFAULT_CONTROL_PERIODICITY, FALLBACK_CONTROL_PERIODICITY } from "@/lib/control-periodicity";
import type { MessageContract } from "./message-contract";

type PeriodicityKey = keyof MessageContract["journalWidgets"]["periodicity"];
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Match a default for this specific journal. A customer's custom rule stays verbatim. */
export function standardPeriodicityKey(text: string, templateCode?: string): PeriodicityKey | null {
  if (!text.trim() || !templateCode) return null;
  if (!Object.hasOwn(DEFAULT_CONTROL_PERIODICITY, templateCode)) {
    return text === FALLBACK_CONTROL_PERIODICITY ? "fallback" : null;
  }
  const defaults = [DEFAULT_CONTROL_PERIODICITY[templateCode], ...(LEGACY_DEFAULT_CONTROL_PERIODICITY[templateCode] ?? [])];
  return defaults.some(value => normalize(value) === normalize(text)) ? templateCode as PeriodicityKey : null;
}
