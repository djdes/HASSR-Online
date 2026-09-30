import assert from "node:assert/strict";
import { test } from "node:test";

import {
  announcementCookieString,
  isAnnouncementDismissed,
  parseAnnouncementCookie,
} from "./billing-announcement-cookie";

test("анонс: закрыт сегодня — кука с сегодняшним днём; вчерашняя и мусор не считаются", () => {
  assert.equal(isAnnouncementDismissed("2026-10-03", "2026-10-03"), true);
  assert.equal(isAnnouncementDismissed("2026-10-02", "2026-10-03"), false);
  assert.equal(isAnnouncementDismissed(undefined, "2026-10-03"), false);
  assert.equal(parseAnnouncementCookie("<script>"), null);
  assert.match(announcementCookieString("2026-10-03"), /^wesetup-billing-ann=2026-10-03; Path=\/; Max-Age=\d+; SameSite=Lax$/);
});
