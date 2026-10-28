// Превью приветственного письма (ru/en) для глаз и скриншота.
import { writeFileSync } from "node:fs";
import { renderWelcomeEmail } from "@/lib/email";

const dir = ".agent/tasks/rest-menu-welcome-email-2026-10-28/raw";
async function main() {
for (const locale of ["ru", "en", "uz"] as const) {
  const { subject, html } = await renderWelcomeEmail({ name: "Анна", organizationName: "ООО «Ромашка»", locale });
  writeFileSync(`${dir}/welcome-${locale}.html`, html);
  console.log(locale, subject);
}
}
void main();
