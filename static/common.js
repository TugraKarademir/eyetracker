// Ortak yardımcılar
const EMO = {
  mutlu:        { label: "Mutlu / ilgili", icon: "😊", color: "var(--e-mutlu)" },
  notr:         { label: "Nötr",            icon: "😐", color: "var(--e-notr)" },
  kafa_karisik: { label: "Kafası karışık",  icon: "🤔", color: "var(--e-kafa_karisik)" },
  zorlaniyor:   { label: "Zorlanıyor",      icon: "😣", color: "var(--e-zorlaniyor)" },
};

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "İstek başarısız");
  return j;
}

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function toast(text, ms = 4000) {
  let w = $(".toast-wrap");
  if (!w) { w = document.createElement("div"); w.className = "toast-wrap"; document.body.append(w); }
  const t = document.createElement("div"); t.className = "toast"; t.textContent = text; w.append(t);
  setTimeout(() => t.remove(), ms);
}

function floatEmoji(e) {
  const d = document.createElement("div");
  d.className = "float-emoji"; d.textContent = e;
  d.style.left = 40 + Math.random() * (innerWidth - 120) + "px";
  d.style.top = innerHeight - 90 + "px";
  document.body.append(d); setTimeout(() => d.remove(), 2700);
}

const fmtTime = (t) => new Date(t * 1000).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
const levelColor = (v) => v == null ? "var(--muted)" : v >= 70 ? "var(--good)" : v >= 45 ? "var(--warn)" : "var(--bad)";

// Hafif zaman serisi çizici (canvas). series: [{key,color,label}]
function drawLineChart(canvas, points, series) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const cv = (v) => v.startsWith("var(") ? css.getPropertyValue(v.slice(4, -1)).trim() : v;
  const pad = { l: 34, r: 10, t: 10, b: 22 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = cv("var(--muted)"); ctx.strokeStyle = cv("var(--border)"); ctx.lineWidth = 1;
  for (const v of [0, 25, 50, 75, 100]) {
    const y = pad.t + ih - (v / 100) * ih;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.fillText(v, 6, y + 4);
  }
  const pts = points.filter((p) => p.attention != null);
  if (pts.length < 2) {
    ctx.fillText("Veri toplanıyor…", pad.l + 8, pad.t + ih / 2); return;
  }
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0);
  const X = (t) => pad.l + ((t - t0) / span) * iw, Y = (v) => pad.t + ih - (v / 100) * ih;
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const t = t0 + (span * i) / ticks, x = X(t);
    const s = span < 600 ? new Date(t * 1000).toLocaleTimeString("tr-TR") : fmtTime(t);
    const tw = ctx.measureText(s).width;
    ctx.fillText(s, Math.min(Math.max(x - tw / 2, pad.l), w - pad.r - tw), h - 6);
  }
  for (const s of series) {
    const col = cv(s.color);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p[s.key])) : ctx.moveTo(X(p.t), Y(p[s.key]))));
    ctx.stroke();
    if (s.fill) {
      ctx.lineTo(X(t1), Y(0)); ctx.lineTo(X(t0), Y(0)); ctx.closePath();
      ctx.globalAlpha = .1; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
    }
  }
}

function emotionBars(el, dist, asPct) {
  const total = Object.values(dist || {}).reduce((a, b) => a + b, 0) || 1;
  el.innerHTML = Object.keys(EMO).map((k) => {
    const v = dist?.[k] || 0, pct = asPct ? v : Math.round((100 * v) / total);
    return `<div style="margin:8px 0">
      <div class="row" style="justify-content:space-between;font-size:14px"><span>${EMO[k].icon} ${EMO[k].label}</span><b>%${pct}</b></div>
      <div class="bar"><i style="width:${pct}%;background:${EMO[k].color}"></i></div></div>`;
  }).join("");
}

// WebRTC: aynı ağda STUN gerekmez; farklı ağlar için STUN, kurumsal ağlar için TURN eklenmeli.
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const BRAND =`<a class="brand" href="/"><span class="dot"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span>DersNabzı</a>`;
document.querySelectorAll("[data-brand]").forEach((e) => (e.outerHTML = BRAND));
