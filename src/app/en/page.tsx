// An explicit route keeps locale headers intact across reverse proxies.
// Reuse the same landing implementation so prices and features cannot diverge.
export { default, generateMetadata } from "../page";
export const dynamic = "force-dynamic";
export const revalidate = 0;
