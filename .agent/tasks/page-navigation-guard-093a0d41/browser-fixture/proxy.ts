// Use the actual repository proxy, including its authentication/access checks.
export { proxy } from "../../../../src/proxy";
export const config = { matcher: ["/((?!_next/|favicon\\.ico$).*)"] };
