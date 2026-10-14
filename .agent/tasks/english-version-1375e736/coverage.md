# Translation coverage

Current implementation is a partial delivery of task 1375e736, not completion of the whole English-site request. No answer to the public-site versus authenticated-workspace scope question has arrived.

| Area | English coverage |
| --- | --- |
| Main landing | `/en`, including hero, signup, prices, equipment calculator, FAQ, six QR animation chapters, footer, cookie notice, support UI and accessibility labels |
| Login | `/en/login`: password, Telegram second factor, passkey feedback, reset and email-link request UI |
| Registration | `/en/register`: email, preselected journal and sector labels, CAPTCHA, consent and API error feedback |
| Locale infrastructure | Server/client locale, RU/EN switch, registered links, full document navigation across language boundaries, trusted proxy context |
| SEO | English HTML, metadata, self canonical, reciprocal hreflang, home sitemap entry and English social preview |
| Shared controls | Explicit English rendering when mounted inside an English page; Russian remains the default elsewhere |
| Customer content | Names, records, reviews and uploads remain in their original language |
| Other public pages | Not translated: feature pages, journal information/details, niche/SEO pages, blog/articles, glossary, comparisons, city pages and standalone calculators |
| Legal and follow-up auth pages | Original Russian documents and email templates; password-reset completion, phone/mini login and email-link callback pages have not been translated |
| Authenticated product | Dashboard, journals, settings, personnel, reports, organization data, generated production documents, Telegram/Mini App and administration have not been translated |

Only the three verified routes receive `/en` counterparts. Links to untranslated pages retain their real Russian destinations and reload the document to reset HTML lang and client locale. Successful English registration/login also reloads the destination, preserving the existing authentication result and URL. Signed-in visitors use the same auth-layout redirect as the Russian routes.

URLs determine the rendered language. The switch preserves query/hash and stores the preference cookie; it does not force a redirect away from an explicitly requested Russian URL. No language or currency is changed in tenant records. Prices remain in RUB and promotions retain Moscow-time boundaries. Live tariffs are read from the existing source, with the same fallback behavior.

Publication: not pushed or deployed. The ProjectsFlow task stays in progress. AC3 cannot pass until the remaining translation scope is confirmed and implemented.
