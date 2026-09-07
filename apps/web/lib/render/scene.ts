import type { SceneSpec, Layer } from "@/lib/schemas/scene";

/**
 * Sahne tarifini izlenebilir HTML'e çevirir.
 *
 * Burada model yok: aynı spec her zaman aynı çıktıyı verir. Render'ın
 * deterministik olması, QA'nın anlamlı olmasının önkoşulu — kontrol
 * edilen şey ile yayınlanan şey aynı olmalı.
 *
 * Çıktı tek dosya: dış CSS, dış font, dış görsel, ağ isteği yok. Böylece
 * indirilen dosya internetsiz de açılıyor ve panelde iframe içinde
 * sandbox'lı çalışabiliyor.
 */

export interface StyleContract {
  accent?: string;
  min_body_px?: number;
  min_code_px?: number;
  glow_opacity?: number;
  grain?: number;
}

export interface SceneInput {
  motionIndex: number;
  title: string;
  spec: SceneSpec;
}

/** Sahne tuvali. Yüzde koordinatlar buna göre piksele çevriliyor. */
const STAGE_W = 1920;
const STAGE_H = 1080;

/**
 * Tipografi ölçeği tokenlarla sabit. Model piksel seçemiyor; seçebilseydi
 * görsel sözleşmenin okunabilirlik tabanı ilk ihlal edilen şey olurdu.
 */
const SIZE_PX: Record<Layer["size"], number> = {
  hero: 108, headline: 72, body: 40, label: 30, caption: 26, code: 32,
};
const SIZE_WEIGHT: Record<Layer["size"], number> = {
  hero: 700, headline: 650, body: 450, label: 550, caption: 400, code: 450,
};

export function sceneDurationMs(spec: SceneSpec): number {
  return Math.max(400, Math.round(spec.duration_ms));
}

/* ------------------------------------------------------------------ film */

/**
 * Tüm sahneleri tek bir zaman ekseninde birleştirir ve oynatıcıyla
 * birlikte tam bir HTML belgesi döndürür.
 */
export function renderFilm({
  title, scenes, style,
}: {
  title: string;
  scenes: SceneInput[];
  style: StyleContract | null;
}): string {
  const accent = safeColor(style?.accent) ?? "#7dd3fc";
  const minBody = clamp(Number(style?.min_body_px ?? 28), 20, 60);

  let cursor = 0;
  const placed = scenes.map((s) => {
    const dur = sceneDurationMs(s.spec);
    const at = cursor;
    cursor += dur;
    return { ...s, startMs: at, endMs: at + dur, durationMs: dur };
  });
  const totalMs = Math.max(cursor, 1);

  const body = placed
    .map(
      (s) => `<section class="scene bg-${s.spec.background}" data-start="${s.startMs}" data-end="${s.endMs}">
${s.spec.layers.map((l) => layerHtml(l, minBody)).join("\n")}
${s.spec.narration ? `<div class="narration"><span>${esc(s.spec.narration)}</span></div>` : ""}
</section>`
    )
    .join("\n");

  const chapters = placed
    .map(
      (s) =>
        `<button class="chapter" data-seek="${s.startMs}" title="${esc(s.title)}"><b>${
          s.motionIndex + 1
        }</b><span>${esc(trim(s.title, 42))}</span><i>${fmt(s.durationMs)}</i></button>`
    )
    .join("");

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${css(accent, Number(style?.glow_opacity ?? 0.18), Number(style?.grain ?? 0.04))}</style>
</head>
<body>
<div class="wrap">
  <div class="viewport" id="viewport">
    <div class="stage" id="stage">
${body}
    </div>
  </div>

  <div class="controls">
    <button id="play" class="play" aria-label="Oynat">▶</button>
    <span class="time" id="clock">0:00</span>
    <input id="scrub" class="scrub" type="range" min="0" max="${totalMs}" value="0" step="10" aria-label="Zaman çubuğu">
    <span class="time muted">${fmt(totalMs)}</span>
    ${placed.some((s) => s.spec.narration)
      ? `<button id="cc" class="cc" aria-pressed="true" title="Altyazıyı aç/kapat">CC</button>`
      : ""}
  </div>

  <div class="chapters">${chapters}</div>
</div>

<script>
${playerJs()}
</script>
</body>
</html>`;
}

/* --------------------------------------------------------------- katman */

function layerHtml(l: Layer, minBodyPx: number): string {
  // Okunabilirlik tabanı burada zorlanıyor: sözleşmenin altına düşen
  // gövde yazısı büyütülüyor. Sahne tarifinin bunu bozma yetkisi yok.
  const px = l.size === "body" ? Math.max(SIZE_PX.body, minBodyPx) : SIZE_PX[l.size];

  const style = [
    `left:${pct(l.x)}%`,
    `top:${pct(l.y)}%`,
    `width:${pct(l.w)}%`,
    // Yükseklik yalnız panelde anlamlı: ayraç ve metin yüksekliğini
    // CSS'ten alıyor, satır içi bir değer onu ezip çizgiyi yok ederdi.
    l.h != null && l.kind === "panel" ? `height:${pct(l.h)}%` : "",
    `text-align:${l.align}`,
    `font-size:${px}px`,
    `font-weight:${SIZE_WEIGHT[l.size]}`,
  ].filter(Boolean).join(";");

  const data = [
    `data-in-effect="${l.enter.effect}"`,
    `data-in-at="${Math.max(0, Math.round(l.enter.at_ms))}"`,
    `data-in-ms="${Math.round(l.enter.ms)}"`,
    l.exit ? `data-out-effect="${l.exit.effect}"` : "",
    l.exit ? `data-out-at="${Math.round(l.exit.at_ms)}"` : "",
    l.exit ? `data-out-ms="${Math.round(l.exit.ms)}"` : "",
    l.kind === "bar" || l.kind === "stat" ? `data-value="${Number(l.value ?? 0)}"` : "",
  ].filter(Boolean).join(" ");

  const cls = `layer k-${l.kind} e-${l.emphasis} s-${l.size}`;

  switch (l.kind) {
    case "panel":
      return `<div class="${cls}" style="${style}" ${data}></div>`;
    case "rule":
      return `<div class="${cls}" style="${style}" ${data}><span class="rule-fill"></span></div>`;
    case "bar":
      return `<div class="${cls}" style="${style}" ${data}>
  <span class="bar-label">${esc(l.text ?? "")}</span>
  <span class="bar-track"><span class="bar-fill"></span></span>
  <span class="bar-val tnum" data-unit="${esc(l.unit ?? "")}">0</span>
</div>`;
    case "stat":
      return `<div class="${cls}" style="${style}" ${data}>
  <span class="stat-row"><span class="stat-num tnum">0</span><span class="stat-unit">${esc(l.unit ?? "")}</span></span>
  ${l.text ? `<span class="stat-cap">${esc(l.text)}</span>` : ""}
</div>`;
    case "chip":
      return `<div class="${cls}" style="${style}" ${data}><span>${esc(l.text ?? "")}</span></div>`;
    default:
      return `<div class="${cls}" style="${style}" ${data}>${esc(l.text ?? "")}</div>`;
  }
}

/* ------------------------------------------------------------------- css */

function css(accent: string, glow: number, grain: number): string {
  const g = clamp(glow, 0, 0.4);
  const n = clamp(grain, 0, 0.06);
  return `
:root{--accent:${accent};--ink:#07090d;--paper:#0d1117;--text:#e8edf5;--muted:#8b97a8;--line:#1e2937}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--ink);color:var(--text);font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.tnum{font-variant-numeric:tabular-nums}
.wrap{max-width:1280px;margin:0 auto;padding:24px 20px 40px}
.viewport{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:12px;border:1px solid var(--line);background:var(--paper)}
.stage{position:absolute;top:0;left:0;width:${STAGE_W}px;height:${STAGE_H}px;transform-origin:top left}

.scene{position:absolute;inset:0;display:none}
.scene.on{display:block}
.bg-deep{background:radial-gradient(120% 90% at 50% 0%,#101826 0%,#07090d 70%)}
.bg-panel{background:linear-gradient(180deg,#0f1622 0%,#0a0e15 100%)}
.bg-spot{background:radial-gradient(45% 45% at 30% 35%,color-mix(in srgb,var(--accent) ${Math.round(g * 100)}%,transparent) 0%,#07090d 70%)}
.bg-grid{background:#080b11}
.bg-grid::before{content:"";position:absolute;inset:0;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:80px 80px;opacity:.5}
${n > 0 ? `.scene::after{content:"";position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 100% at 50% 45%,transparent 55%,rgba(0,0,0,${(n * 12).toFixed(2)}) 100%)}` : ""}

.layer{position:absolute;opacity:0;line-height:1.24;letter-spacing:-.01em;white-space:pre-wrap;color:var(--text)}
.e-accent{color:var(--accent)}
.e-muted{color:var(--muted)}
.s-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:0}
.s-label{text-transform:uppercase;letter-spacing:.14em}

.k-panel{background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:20px}
.k-rule{height:4px;display:flex}
.rule-fill{display:block;height:100%;width:100%;background:var(--accent);border-radius:2px;transform-origin:left center}
.k-chip{display:flex;align-items:center}
.k-chip>span{display:inline-block;border:2px solid var(--accent);color:var(--accent);border-radius:999px;padding:.28em 1em;font-size:.72em;letter-spacing:.06em}

.k-bar{display:flex;flex-direction:column;gap:14px}
.bar-label{font-size:.72em;color:var(--muted)}
.bar-track{display:block;height:22px;border-radius:11px;background:rgba(255,255,255,.07);overflow:hidden}
.bar-fill{display:block;height:100%;width:0%;border-radius:11px;background:linear-gradient(90deg,var(--accent),color-mix(in srgb,var(--accent) 45%,#fff))}
.bar-val{font-size:.8em;color:var(--accent)}

.k-stat{display:flex;flex-direction:column}
.stat-row{display:flex;align-items:baseline;gap:.12em}
.stat-num{font-size:1em;font-weight:700;line-height:1}
.stat-unit{font-size:.42em;color:var(--muted)}
.stat-cap{font-size:.3em;color:var(--muted);margin-top:.9em;letter-spacing:.04em}

/* Seslendirme metni altyazı olarak duruyor: ses yok, söylenen şey
   okunabilir olmalı. Sahnenin kendi katmanlarıyla yarışmasın diye
   alt şeride sabitlendi ve tipografisi bilinçli olarak sakin. */
.narration{position:absolute;left:8%;right:8%;bottom:52px;text-align:center;z-index:5}
.narration span{display:inline-block;background:rgba(4,6,10,.72);border:1px solid var(--line);border-radius:10px;padding:14px 26px;font-size:34px;line-height:1.35;color:var(--text)}
.no-cc .narration{display:none}

.controls{display:flex;align-items:center;gap:14px;margin-top:16px}
.play{width:44px;height:44px;flex:none;border-radius:999px;border:1px solid var(--line);background:#121a26;color:var(--text);font-size:15px;cursor:pointer}
.play:hover{background:#18222f}
.time{font-variant-numeric:tabular-nums;font-size:13px;color:var(--text)}
.time.muted{color:var(--muted)}
.scrub{flex:1;accent-color:var(--accent);height:4px;cursor:pointer}
.cc{flex:none;border:1px solid var(--accent);background:transparent;color:var(--accent);border-radius:6px;padding:4px 9px;font-size:12px;font-weight:600;letter-spacing:.06em;cursor:pointer}
.cc[aria-pressed="false"]{border-color:var(--line);color:var(--muted)}
.chapters{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.chapter{display:flex;align-items:center;gap:10px;border:1px solid var(--line);background:#0f1622;color:var(--muted);border-radius:8px;padding:7px 11px;font-size:12px;cursor:pointer;max-width:100%}
.chapter:hover{color:var(--text);border-color:#2b3a4d}
.chapter b{color:var(--accent);font-variant-numeric:tabular-nums}
.chapter span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chapter i{font-style:normal;font-variant-numeric:tabular-nums;opacity:.7}
.chapter.on{color:var(--text);border-color:var(--accent)}
@media (prefers-reduced-motion:reduce){.layer{transition:none}}
`;
}

/* -------------------------------------------------------------- oynatıcı */

/**
 * Tek saat, her karede konum hesabı. CSS animation yerine bunu seçtik
 * çünkü sürüklenebilir bir zaman çubuğu istiyoruz: CSS animasyonlarını
 * geri sarmak, duraklatmak ve senkron tutmak bundan daha çok kod.
 */
function playerJs(): string {
  return `
(function(){
  var stage=document.getElementById('stage'),vp=document.getElementById('viewport');
  var scenes=[].slice.call(document.querySelectorAll('.scene'));
  var scrub=document.getElementById('scrub'),playBtn=document.getElementById('play'),clock=document.getElementById('clock');
  var chapters=[].slice.call(document.querySelectorAll('.chapter'));
  var total=Number(scrub.max)||1, t=0, playing=false, last=0;

  function fit(){var s=vp.clientWidth/${STAGE_W};stage.style.transform='scale('+s+')';}
  addEventListener('resize',fit);fit();

  function ease(p){return p<.5?2*p*p:1-Math.pow(-2*p+2,2)/2;}
  function clamp01(v){return v<0?0:v>1?1:v;}

  function applyIn(el,p){
    var e=el.getAttribute('data-in-effect');var k=ease(p);
    el.style.opacity=String(p<=0?0:clamp01(p*1.35));
    var tr='';
    if(e==='rise')tr='translateY('+((1-k)*46)+'px)';
    else if(e==='slide-left')tr='translateX('+((1-k)*-70)+'px)';
    else if(e==='slide-right')tr='translateX('+((1-k)*70)+'px)';
    else if(e==='scale')tr='scale('+(0.9+0.1*k)+')';
    el.style.transform=tr;
    el.style.clipPath = e==='wipe' ? 'inset(0 '+((1-k)*100)+'% 0 0)' : '';
  }
  function applyOut(el,p){
    var e=el.getAttribute('data-out-effect');var k=ease(p);
    el.style.opacity=String(1-k);
    el.style.transform = e==='sink' ? 'translateY('+(k*30)+'px)' : e==='scale' ? 'scale('+(1-0.06*k)+')' : '';
  }

  function paintLayer(el,localMs){
    var inAt=+el.getAttribute('data-in-at'),inMs=+el.getAttribute('data-in-ms')||1;
    var outAt=el.hasAttribute('data-out-at')?+el.getAttribute('data-out-at'):null;
    var outMs=+el.getAttribute('data-out-ms')||1;

    if(localMs<inAt){el.style.opacity='0';return;}
    if(outAt!==null&&localMs>=outAt){
      if(localMs>=outAt+outMs){el.style.opacity='0';return;}
      applyOut(el,(localMs-outAt)/outMs);
    }else{
      applyIn(el,clamp01((localMs-inAt)/inMs));
    }

    // Sayı ve doluluk girişle birlikte ilerliyor: rakam yerine oturana
    // kadar hareket ediyor, sonra sabit kalıyor.
    var v=el.getAttribute('data-value');
    if(v!==null){
      var prog=clamp01((localMs-inAt)/(inMs+600));
      var cur=Number(v)*ease(prog);
      var fill=el.querySelector('.bar-fill');
      if(fill)fill.style.width=Math.max(0,Math.min(100,cur))+'%';
      var val=el.querySelector('.bar-val');
      if(val)val.textContent=Math.round(cur)+(val.getAttribute('data-unit')||'');
      var num=el.querySelector('.stat-num');
      if(num)num.textContent=(Math.abs(Number(v))<10?cur.toFixed(1):Math.round(cur).toLocaleString('tr-TR'));
    }
  }

  function paint(){
    var active=null;
    for(var i=0;i<scenes.length;i++){
      var s=scenes[i],a=+s.dataset.start,b=+s.dataset.end;
      var on=(t>=a&&t<b)||(i===scenes.length-1&&t>=b);
      s.classList.toggle('on',on);
      if(on){active=i;var layers=s.querySelectorAll('.layer');
        for(var j=0;j<layers.length;j++)paintLayer(layers[j],t-a);}
    }
    for(var c=0;c<chapters.length;c++)chapters[c].classList.toggle('on',c===active);
    scrub.value=String(t);
    clock.textContent=fmt(t);
  }

  function fmt(ms){var s=Math.floor(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');}

  function frame(now){
    if(!playing)return;
    if(!last)last=now;
    t+=now-last;last=now;
    if(t>=total){t=total;playing=false;playBtn.textContent='↻';}
    paint();
    if(playing)requestAnimationFrame(frame);
  }

  function play(){
    if(t>=total)t=0;
    playing=true;last=0;playBtn.textContent='❚❚';requestAnimationFrame(frame);
  }
  function pause(){playing=false;playBtn.textContent='▶';}

  playBtn.addEventListener('click',function(){playing?pause():play();});

  var cc=document.getElementById('cc');
  if(cc)cc.addEventListener('click',function(){
    var on=cc.getAttribute('aria-pressed')!=='true';
    cc.setAttribute('aria-pressed',on?'true':'false');
    stage.classList.toggle('no-cc',!on);
  });

  scrub.addEventListener('input',function(){pause();t=Number(scrub.value);paint();});
  chapters.forEach(function(c){c.addEventListener('click',function(){t=Number(c.dataset.seek);paint();play();});});
  addEventListener('keydown',function(e){
    if(e.code==='Space'){e.preventDefault();playing?pause():play();}
    if(e.code==='ArrowRight'){pause();t=Math.min(total,t+1000);paint();}
    if(e.code==='ArrowLeft'){pause();t=Math.max(0,t-1000);paint();}
  });

  paint();
})();
`;
}

/* --------------------------------------------------------------- yardımcı */

/**
 * Metin her zaman kaçışlanıyor. Sahne tarifinin içeriği modelden geliyor;
 * kaçışlamayı unutmak, üretilen HTML'e script sokabilecek tek yol olurdu.
 */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Yalnız hex renk kabul ediliyor; CSS'e serbest metin geçirilmiyor. */
function safeColor(v: unknown): string | null {
  return typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

function pct(v: number): string {
  return clamp(v, 0, 100).toFixed(2);
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

function trim(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
