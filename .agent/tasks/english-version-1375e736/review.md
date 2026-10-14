# Fresh current-source review

Reviewed after the implementation and initial failed checks, against baseline 7be70481 and the explicit source manifest. This is a sequential fresh review by the root agent; no delegated agent was authorized.

- Proxy still performs existing root/directory/partner/staff decisions before stamping the request context. English routing uses explicit page aliases; no wildcard rewrite can expose protected routes. Caller-supplied locale headers are replaced.
- Explicit English auth aliases initially missed the `(auth)` layout. Added layout reexports so signed-in users retain their existing role-dependent redirect. Authentication code, credentials and API payload keys are unchanged.
- Root layouts persist across client navigation. Links into untranslated pages now reload the document; successful English login/registration does the same. This prevents English client context from leaking into a Russian workspace.
- The initial 320px screenshot exposed a clipped sign-in button despite a passing document-scroll-width assertion. Reduced header content at narrow widths, retained visible language/sign-in controls, allowed wrapping, and extended browser assertions to every visible control at five widths and two scroll positions.
- Product-controlled source strings are translated explicitly. User names/reviews, document contents, field identifiers, role codes, API routes and numeric pricing logic are preserved. Promotion deadline helpers keep their default Russian behavior and Moscow midnight boundary.
- English metadata and structured data use the English preview; only real translated routes get hreflang/English sitemap entries. Unknown prefixed private/API paths remain 404 in the real application.
- CAPTCHA remains server-verified v2 with independent tokens per form, failure reset and consent gating; only client labels and widget language change. Browser tests mock the third-party challenge and authentication writes, not the application's UI logic.
- The terminology scanner exception is limited to two exact Russian dictionary keys already permitted for the original links. No test-baseline changes.
- No new dependency, schema migration, cloud service, production configuration or deployment. Working tree changes outside the manifest are preserved.

Verification limitation: the isolated database address is deliberately unreachable. Real rendering exercises existing fallback tariffs and empty public reviews. Browser tests do not create accounts, send email, complete real reCAPTCHA, or validate production connectivity. Session fixtures use a test-only signing key in the isolated server.

Overall task verdict remains incomplete because translation coverage is unresolved (`coverage.md`). Do not promote a passing technical check for this slice into a PASS for the whole task.
