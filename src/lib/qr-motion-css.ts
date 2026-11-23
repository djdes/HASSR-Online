/**
 * Motion of the server-rendered QR pages (the journal form opened by a QR code,
 * `journal-fill-html.ts`) — the same language as the site (`src/app/motion.css`, spec
 * site-motion-2026-11-22): a button squeezes under the finger and springs back, the ring of a
 * field blooms, the label of a field moves up without a jerk. Round 3 (2026-11-23): a field takes
 * a short breath when it is taken and its label takes the accent; the «who fills in» sheet has
 * the handle that folds into a down arrow under the finger (the pull itself is in the page's
 * script, `journal-fill-html.ts`). The page is standalone HTML with
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
.in,.qp-pin{caret-color:var(--brand-accent,#5566f6);transition:scale .5s var(--spring),border-color .18s ease,background-color .18s ease,box-shadow .24s ease-out}
.in:focus,.qp-pin:focus{animation:qr-field-in .44s var(--spring-soft);transition:scale .5s var(--spring),border-color .18s ease,background-color .18s ease,box-shadow .42s var(--spring)}
@keyframes qr-field-in{40%{scale:1.012}}
.in::placeholder{transition:opacity .2s ease,translate .36s var(--spring-soft)}
.in:focus::placeholder{opacity:.55;translate:6px 0}
@media (pointer:coarse){.in:active,.qp-pin:active{scale:.985}}
.fl>label,.fl .box>label{transition:top .32s var(--spring-soft),font-size .32s var(--spring-soft),letter-spacing .32s var(--spring-soft),color .18s ease}
.fl .in:focus~label{color:var(--brand-accent,#5566f6)}
.sheet .sh{position:relative;transition:translate .42s var(--spring)}
.sh-g{position:absolute;top:0;left:50%;width:112px;height:24px;margin-left:-56px;touch-action:none;cursor:grab}
.sh-g::before,.sh-g::after{content:"";position:absolute;top:7px;width:22.5px;height:5px;border-radius:999px;background:#c3c6d6;transition:rotate .5s var(--spring),translate .5s var(--spring),background-color .18s ease}
.sh-g::before{right:calc(50% - 2.5px);transform-origin:calc(100% - 2.5px) 50%}
.sh-g::after{left:calc(50% - 2.5px);transform-origin:2.5px 50%}
.sh-g:active::before,.sh-g.on::before,.sh-g:active::after,.sh-g.on::after{background:#8d91a8;translate:0 3px;transition-duration:.28s,.28s,.12s}
.sh-g:active::before,.sh-g.on::before{rotate:22deg}
.sh-g:active::after,.sh-g.on::after{rotate:-22deg}
.sh-g.armed::before,.sh-g.armed::after{background:var(--brand-accent,#5566f6)}
@media (prefers-reduced-motion:reduce){
.btn,.item,.stp,.chip,.segb,.lnk,.who a,.who.emp,.sheet .sh-x,.check,.tabs a,.qp-link,.in,.qp-pin,.fl>label,.fl .box>label,.sheet .sh,.sh-g::before,.sh-g::after,.in::placeholder{transition:none}
.btn:active:not(:disabled),.chip:active,.segb:active,.who a:active,.tabs a:active,.item:active,.who.emp:active,.check:active,.stp:active,.sheet .sh-x:active,.in:active,.qp-pin:active{scale:none}
.in:focus,.qp-pin:focus{animation:none}
.in:focus::placeholder{translate:none}
}`;
