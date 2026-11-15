# Coverage and imagery audit

## Shared copy

The copy manifest records exact per-locale before/after values. Scope: shift schedule; employee creation/import; organisation locations, rooms and office; access and responsibilities guidance; workload/difficulty; kiosk and shared tablet; task instructions; logout/review helper text; landing metadata/structured data/FAQ/showcase; authentication metadata; public footer; hardware/pricing; general role access, notifications and time-saving features; shared cold equipment/climate/cleaning/UV guidance. The actual image/demo role captions and video context are also localized.

## Image and symbol consumers

| Surface | Finding and disposition |
|---|---|
| Shared product branding (`components/brand`, public brand and PWA marks) | Wordmark and violet notebook, no profession. Retained. |
| Organisation identity (`layout/organization-brand`) | Customer logo or initials. Retained; no customer image/data edits. |
| Shared people avatars | Initials, not cooks. Retained. |
| Login and registration industry panel | Food-production seals replaced with existing Lucide symbols for medical centres, food service, manufacturing and retail. Neutral login heading and industry guidance in ru/en/uz. No certification claims. |
| Landing staff screenshots | Old captures listed chefs/cooks under a canteen identity. Replaced at the consumer with new cache-distinct `staff-neutral` captures of current `StaffPageClient`, neutral fictional staff, desktop/mobile. |
| QR animation employee selection and hygiene rows | Cooks/sous-chef replaced by localized employee/specialist labels. Fictional organisation is `WeSetup Demo`. Three-locale browser captures exercise both employee selection and result frames. |
| Landing equipment photos (`landing/places`) | Refrigerator, lockers, UV unit, fryer, closed sign and sensor. No cook portraits. Retained: object pictures match their named scenes. Fryer is specifically a food journal example. |
| Remaining showcase screenshots | Real food-service examples, with food-specific journals. Retained and explicitly scoped in the visible showcase lead; employee slide is neutral. No invented medical screenshot. |
| Recorded presentation and QR-tour videos, subtitles and PDF presentation | Food-service examples. Preserve their actual content; visible video hint names food service. Do not replace a voiceover with conflicting subtitles. |
| Food-specific pipeline/commission/journal icons | Chef hat / utensils occur in finished-product or food-control contexts. Retained; shared staff/schedule icons use Users/Calendar. |
| Production-control hygiene posters (`poster-art/kitchen`, `ppk/posters`) | Correct/incorrect cook clothing is the subject of a food-safety poster. Retained as a domain-specific illustration, not shared product identity. |
| Public niche and journal pages | Food copy on cafe, bakery, hotel food-service and food-production pages remains accurate. Medical/other niche pages keep their own industry content. |
| Blog, published articles, customer testimonials and uploaded media | Editorial/customer content is not a generic product illustration. No fabricated replacement of customers, quotes or historical publication media. |

## Scope boundaries

No role identifiers, matching keywords, ACL/capabilities, assignment behavior, regulatory text or production customer records are changed. Food-oriented presets are explicitly described as such, including manual assignment when nothing matches. No schema, integrations or legal applicability is changed. Medical-centre wording describes supported audiences, not certification or a guarantee of regulatory compliance.
