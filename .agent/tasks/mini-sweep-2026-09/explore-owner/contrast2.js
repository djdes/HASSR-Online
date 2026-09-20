(() => {
  function nums(c){ return (String(c).match(/[0-9.]+/g)||[]).map(Number); }
  function srgb(v){ v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }
  function rl(c){ const m=nums(c); if(m.length<3) return null; return 0.2126*srgb(m[0])+0.7152*srgb(m[1])+0.0722*srgb(m[2]); }
  function alpha(c){ const m=nums(c); return m.length>=4?m[3]:1; }
  function bgOf(el){ let e=el; while(e && e!==document.documentElement){ const c=getComputedStyle(e).backgroundColor; if(alpha(c)>0.5) return c; e=e.parentElement; } return 'rgb(255,255,255)'; }
  const out=[];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length) continue;
    const t = String(el.innerText||'').trim();
    if (t.length < 3) continue;
    const r = el.getBoundingClientRect();
    if (r.width<10||r.height<8||r.top>window.innerHeight||r.bottom<0) continue;
    const cs = getComputedStyle(el);
    const f = rl(cs.color), b = rl(bgOf(el));
    if (f===null||b===null) continue;
    const ratio = (Math.max(f,b)+0.05)/(Math.min(f,b)+0.05);
    if (ratio < 3.2) out.push(ratio.toFixed(2) + '  fg=' + cs.color + ' bg=' + bgOf(el) + ' fs=' + cs.fontSize + '  "' + t.slice(0,42) + '"');
  }
  return out.slice(0,20);
})()
