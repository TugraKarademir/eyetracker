// Ortak yardımcılar
const EMO = {
  mutlu:        { label: "Mutlu / ilgili", icon: "😊", color: "var(--e-mutlu)" },
  notr:         { label: "Nötr",            icon: "😐", color: "var(--e-notr)" },
  kafa_karisik: { label: "Kafası karışık",  icon: "🤔", color: "var(--e-kafa_karisik)" },
  zorlaniyor:   { label: "Zorlanıyor",      icon: "😣", color: "var(--e-zorlaniyor)" },
};

// Bakış bölgeleri (öğrenci ekranı)
const AOI = {
  materyal:  { label: "Materyal",         icon: "📺", color: "#0f9d8a" },
  konu:      { label: "Konu başlığı",     icon: "📝", color: "#6c5ce7" },
  duyuru:    { label: "Duyuru",           icon: "📢", color: "#3b82f6" },
  etkilesim: { label: "Etkileşim",        icon: "✋", color: "#e09b17" },
  sohbet:    { label: "Sohbet",           icon: "💬", color: "#d97706" },
  kamera:    { label: "Kendi kamerası",   icon: "🤳", color: "#a855f7" },
  sayfa:     { label: "Sayfanın boş yeri", icon: "📄", color: "#8a94a3" },
  disari:    { label: "Ekran dışı",       icon: "🚫", color: "#d64545" },
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
    ctx.textAlign = "center";
    ctx.fillText(pts.length ? "Veri toplanıyor…" : "Henüz veri yok", pad.l + iw / 2, pad.t + ih / 2); return;
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
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.setLineDash(s.dash || []); ctx.beginPath();
    let pen = false;                                   // değer yoksa (null) çizgi kesilir
    for (const p of pts) {
      const v = p[s.key];
      if (v == null) { pen = false; continue; }
      pen ? ctx.lineTo(X(p.t), Y(v)) : ctx.moveTo(X(p.t), Y(v));
      pen = true;
    }
    ctx.stroke(); ctx.setLineDash([]);
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

function aoiBars(el, dist, asPct, keys = Object.keys(AOI)) {
  const total = Object.values(dist || {}).reduce((a, b) => a + b, 0) || 1;
  const rows = keys.map((k) => [k, dist?.[k] || 0]).filter(([k, v]) => v > 0 || k === "materyal");
  el.innerHTML = rows.map(([k, v]) => {
    const pct = asPct ? v : Math.round((100 * v) / total);
    return `<div style="margin:7px 0">
      <div class="row" style="justify-content:space-between;font-size:13px"><span>${AOI[k].icon} ${AOI[k].label}</span><b>%${pct}</b></div>
      <div class="bar"><i style="width:${pct}%;background:${AOI[k].color}"></i></div></div>`;
  }).join("") || '<span class="muted small">Veri yok</span>';
}

// Isı haritası: heat = cols*rows değer (0-100). bg: <video> ise o anki karenin üstüne çizilir.
// Renkli katman yalnızca heat değişince yeniden üretilir (önbellek), kare çizimi ucuzdur.
const _heatCache = new WeakMap();
function heatLayer(heat, cols, rows) {
  const k = 10, off = document.createElement("canvas");
  off.width = cols * k; off.height = rows * k;
  const o = off.getContext("2d");
  heat.forEach((v, i) => {
    if (v <= 1) return;
    const x = ((i % cols) + 0.5) * k, y = (Math.floor(i / cols) + 0.5) * k;
    const g = o.createRadialGradient(x, y, 0, x, y, k * 1.8);
    g.addColorStop(0, `rgba(0,0,0,${Math.min(1, v / 100)})`); g.addColorStop(1, "rgba(0,0,0,0)");
    o.fillStyle = g; o.fillRect(x - k * 2, y - k * 2, k * 4, k * 4);
  });
  const img = o.getImageData(0, 0, off.width, off.height), d = img.data;
  const stops = [[0, [40, 90, 255]], [0.35, [0, 210, 160]], [0.6, [250, 220, 0]], [1, [240, 50, 40]]];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (a < 0.03) { d[i + 3] = 0; continue; }
    let j = 1; while (j < stops.length - 1 && a > stops[j][0]) j++;
    const [p0, c0] = stops[j - 1], [p1, c1] = stops[j], f = Math.min(1, Math.max(0, (a - p0) / (p1 - p0)));
    d[i] = c0[0] + (c1[0] - c0[0]) * f; d[i + 1] = c0[1] + (c1[1] - c0[1]) * f; d[i + 2] = c0[2] + (c1[2] - c0[2]) * f;
    d[i + 3] = Math.min(200, 60 + a * 190);
  }
  o.putImageData(img, 0, 0);
  return off;
}

function drawHeat(canvas, heat, { cols = 32, rows = 18, bg = null, empty = "" } = {}) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#0b0d10"; ctx.fillRect(0, 0, w, h);
  // 16:9 materyal alanı (kenar boşlukları hariç)
  let aw = w, ah = w * 9 / 16; if (ah > h) { ah = h; aw = h * 16 / 9; }
  const ax = (w - aw) / 2, ay = (h - ah) / 2;
  if (bg && bg.videoWidth) {
    const vr = bg.videoWidth / bg.videoHeight;
    let vw = aw, vh = aw / vr; if (vh > ah) { vh = ah; vw = ah * vr; }
    ctx.drawImage(bg, ax + (aw - vw) / 2, ay + (ah - vh) / 2, vw, vh);
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(ax, ay, aw, ah);
  } else {
    ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(ax + aw * i / 4, ay); ctx.lineTo(ax + aw * i / 4, ay + ah); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax, ay + ah * i / 4); ctx.lineTo(ax + aw, ay + ah * i / 4); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.15)"; ctx.strokeRect(ax + .5, ay + .5, aw - 1, ah - 1);
  }
  if (heat) {
    let c = _heatCache.get(canvas);
    if (!c || c.heat !== heat) { c = { heat, layer: heatLayer(heat, cols, rows) }; _heatCache.set(canvas, c); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(c.layer, ax, ay, aw, ah);
  } else if (empty) {
    ctx.fillStyle = "#8a94a3"; ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(empty, w / 2, h / 2); ctx.textAlign = "start";
  }
}

// WebRTC: aynı ağda STUN gerekmez; farklı ağlar için STUN, kurumsal ağlar için TURN eklenmeli.
const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

const BRAND =`<a class="brand" href="/"><span class="dot"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l2-5 4 10 2-5h6"/></svg></span>DersNabzı</a>`;
document.querySelectorAll("[data-brand]").forEach((e) => (e.outerHTML = BRAND));

// Kişisel nötr yüz tabanı (bakış testindeki "nötr bakış" adımında ölçülür). Kişinin dinlenik yüzünde duygu modelinin
// zaten gördüğü pay (ör. doğuştan aşağı dönük ağız köşesi -> "üzgün") duygu sayılmaz, nötre eklenir:
//   q_i = max(0, p_i - b_i)  (nötr dışı sınıflar),  q_nötr = 1 - Σ q_i.   Σ q_i ≤ Σ p_i ≤ 1 olduğundan dağılım geçerli kalır.
// Taban yoksa p aynen döner (tahmini taban uydurulmaz).
function notrTabanDuzelt(p, b, notrKey) {
  if (!b) return p;
  const q = {}; let s = 0;
  for (const k in p) if (k !== notrKey) { q[k] = Math.max(0, p[k] - (b[k] ?? 0)); s += q[k]; }
  q[notrKey] = Math.max(0, 1 - s);
  return q;
}
