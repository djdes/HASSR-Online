/**
 * Motion of the server-rendered QR pages (the journal form opened by a QR code,
 * `journal-fill-html.ts`) — the same language as the site (`src/app/motion.css`, spec
 * site-motion-2026-11-22): a button squeezes under the finger and springs back, the ring of a
 * field blooms, the label of a field moves up without a jerk. The page is standalone HTML with
 * none of the site's styles, so the springs are declared here; their values equal `--spring` /
 * `--spring-soft` of `globals.css` (a test checks it). A browser without `linear()` (Safari
 * before 17.2) gets a plain ease-out, as on the site.
 */

/** Spring with a barely visible overshoot (~1.5 %). */
export const SPRING_EASING =
  "linear(0, 0.0515, 0.1701, 0.3158, 0.463, 0.5973, 0.7116, 0.8037, 0.8746, 0.9267, 0.9632, 0.9875, 1.0024, 1.0107, 1.0144, 1.0151, 1.0141, 1.0122, 1.01, 1.0078, 1.0058, 1.0041, 1.0028, 1.0018, 1)";

/** Spring without an overshoot. */
export const SPRING_SOFT_EASING =
  "linear(0, 0.0682, 0.2133, 0.3771, 0.5297, 0.6586, 0.7607, 0.8377, 0.8937, 0.933, 0.9596, 0.977, 0.988, 0.9946, 0.9984, 1.0004, 1.0013, 1.0015, 1.0015, 1.0013, 1)";

export const QR_MOTION_CSS = `
:root{--spring:cubic-bezier(.22,1,.36,1);--spring-soft:cubic-bezier(.25,1,.5,1)}
@supports (transition-timing-function:linear(0,1)){:root{--spring:${SPRING_EASING};--spring-soft:${SPRING_SOFT_EASING}}}
a,button,label,select,.in,.chip,.segb{-webkit-tap-highlight-color:transparent}
.btn,.item,.stp,.chip,.segb,.lnk,.who a,.who.emp,.sheet .sh-x,.check,.tabs a,.qp-link{transition:scale .5s var(--spring),background-color .18s ease,border-color .18s ease,color .18s ease,box-shadow .3s ease,opacity .18s ease}
.btn:active:not(:disabled),.chip:active,.segb:active,.who a:active,.tabs a:active{scale:.97}
.item:active,.who.emp:active,.check:active{scale:.985}
.stp:active,.sheet .sh-x:active{scale:.92}
.in,.qp-pin{caret-color:var(--brand-accent,#5566f6);transition:border-color .18s ease,background-color .18s ease,box-shadow .24s ease-out}
.in:focus,.qp-pin:focus{transition:border-color .18s ease,background-color .18s ease,box-shadow .42s var(--spring)}
.fl>label,.fl .box>label{transition:top .32s var(--spring-soft),font-size .32s var(--spring-soft),letter-spacing .32s var(--spring-soft),color .18s ease}
@media (prefers-reduced-motion:reduce){
.btn,.item,.stp,.chip,.segb,.lnk,.who a,.who.emp,.sheet .sh-x,.check,.tabs a,.qp-link,.in,.qp-pin,.fl>label,.fl .box>label{transition:none}
.btn:active:not(:disabled),.chip:active,.segb:active,.who a:active,.tabs a:active,.item:active,.who.emp:active,.check:active,.stp:active,.sheet .sh-x:active{scale:none}
}`;
