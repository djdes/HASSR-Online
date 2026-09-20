import { redirectToSitePage } from "../_lib/site-redirect";

export const dynamic = "force-dynamic";

/** Сотрудники ведутся в кабинете — там же роли, доступы и приглашения. */
export default async function MiniStaffRedirectPage() {
  await redirectToSitePage("/mini/staff", "/settings/users");
}
