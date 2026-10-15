import type { Messages } from "@/i18n/messages";

/** These two room substitutions have the same empty ICU argument contract.
 * Canonical RU/EN/UZ parity is checked in room-fill-page-localization.test.ts.
 * Keep the literal source contract for every shared QR key and parameter.
 */
export function composeRoomQrMessages(messages: Pick<Messages, "roomFill" | "equipmentFill">): Messages["equipmentFill"] {
  return {
    ...messages.equipmentFill,
    pin: { ...messages.equipmentFill.pin, remember: messages.roomFill.pin.rememberRoom },
    errors: { ...messages.equipmentFill.errors, invalidSticker: messages.roomFill.errors.invalidCode },
  } as unknown as Messages["equipmentFill"];
}
