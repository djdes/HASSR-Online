/** Server-rendered QR pages cannot mount React; keep this action independent. */
export function renderMaxQrAction() {
  return `<a data-max-connect href="/max/connect" title="Мои журналы в MAX" aria-label="Подключить MAX" style="display:flex;align-items:center;justify-content:center;flex-shrink:0;width:40px;height:40px;border-radius:14px;background:rgba(255,255,255,.12);color:white;text-decoration:none"><svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect width="32" height="32" rx="10" fill="#5566f6"/><path d="M23.6 9.3a10 10 0 0 0-14.3-.7c-4.5 4.2-4.2 11.3-.2 15.2l.7-4a8.4 8.4 0 0 0 13.8-10.5ZM20.8 19a5.6 5.6 0 0 1-7.6.8l-1.7 1.1.4-3c-1.3-2.3-.9-5 1-6.7a5.6 5.6 0 0 1 7.9 7.8Z" fill="white"/></svg></a>`;
}
export const MAX_QR_ACTION_SCRIPT=`document.querySelectorAll('[data-max-connect]').forEach(function(a){a.href='/max/connect?next='+encodeURIComponent(location.pathname+location.search);});`;
