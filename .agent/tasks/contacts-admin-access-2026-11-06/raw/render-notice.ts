/** Renders the platform-access notice e-mail to HTML for a visual check. */
import { writeFileSync } from "node:fs";
import { renderEmailLayout } from "../../../../src/lib/email";
import { PLATFORM_SECTION_KEYS } from "../../../../src/lib/platform-access";
import { buildPlatformAccessNotice } from "../../../../src/lib/platform-access-notice";

const notice = buildPlatformAccessNotice({
  name: "Алексей",
  sections: PLATFORM_SECTION_KEYS,
  firstGrant: true,
  grantedBy: "Администратор",
  loginEmail: "alexey@wesetup.ru",
  appUrl: "https://wesetup.ru",
});
writeFileSync(process.argv[2], renderEmailLayout(notice.title, notice.html));
writeFileSync(process.argv[3], notice.telegram);
console.log(notice.subject);
