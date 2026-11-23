// Yönetim ekranı (araştırmacı paneli). Tek sayfa, adres karmasıyla gezinme.
// Kural: tahmini/eksik veri ölçülmüş gibi gösterilmez. Her ölçünün yanında n; değer yoksa "veri yok" (asla 0).
// Görünüm eklemek için: bir view fonksiyonu yaz, ROUTES tablosuna ekle (Task 8: ogrenci, karsilastirma, katilimcilar).
"use strict";

// ---------------------------------------------------------------- durum, anahtar
const APP = $("#app");
const KEY_K = "dn_admin_key", GIZLE_K = "dn_admin_gizle";
const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch {} },
};
let KEY = ss.get(KEY_K);
let GIZLE = ss.get(GIZLE_K) === "1";
const CTX = { code: null };       // üst çubuktaki CSV / ders seçici için geçerli ders
let navSeq = 0, onResize = null;

class Yetkisiz extends Error {}

function askKey(msg = "") {
  KEY = null; ss.set(KEY_K, null);
  document.body.classList.add("anahtarsiz");
  APP.innerHTML = `<div class="center-wrap" style="min-height:60vh"><form class="card form-card" id="keyForm">
      <h2>Yönetim ekranı</h2>
      <p class="muted small">Yönetici anahtarı sunucu ilk çalıştığında konsolda gösterilir ve <code>data/yonetici_anahtari.txt</code> dosyasındadır.
        Bu sayfa yalnız sunucunun çalıştığı bilgisayardan açılır. Anahtar yalnız bu sekmede tutulur.</p>
      <label for="keyIn">Yönetici anahtarı</label>
      <input id="keyIn" type="password" autocomplete="off" required>
      <div class="error" id="keyErr">${esc(msg)}</div>
      <button class="btn primary" style="width:100%;margin-top:8px">Aç</button></form></div>`;
  $("#keyIn").focus();
  $("#keyForm").onsubmit = async (e) => {
    e.preventDefault();
    KEY = $("#keyIn").value.trim();
    if (!KEY) return;
    try { await aapi("kalite_esik"); }
    catch (err) { if (!(err instanceof Yetkisiz)) $("#keyErr").textContent = err.message; return; }
    ss.set(KEY_K, KEY);
    document.body.classList.remove("anahtarsiz");
    dersSeciciYukle();
    route();
  };
}

// ---------------------------------------------------------------- API
async function aapiResp(path) {
  let r;
  try { r = await fetch("/api/admin/" + path, { headers: { "X-Admin-Key": KEY || "" }, cache: "no-store" }); }
  catch { throw new Error("Sunucuya ulaşılamadı."); }
  if (r.status === 403) { askKey("Anahtar geçersiz ya da bu bilgisayardan açılmıyor."); throw new Yetkisiz(); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `İstek başarısız (${r.status})`); }
  return r;
}
const aapi = async (path) => (await aapiResp(path)).json();
const enc = encodeURIComponent;
const gorselUrl = (code, id) => `/api/material/image?code=${enc(code)}&id=${enc(id)}&admin=${enc(KEY || "")}`;

async function csvIndir(tur, code) {
  const r = await aapiResp(`csv?tur=${tur}${code ? "&code=" + enc(code) : ""}`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await r.blob());
  a.download = `dersnabzi_${tur}${code ? "_" + code : ""}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------------------------------------------------------------- biçim yardımcıları
const KIND = { insan: { label: "İnsan", color: "#2f6fdb" }, yz: { label: "YZ", color: "#e8790c" }, diger: { label: "Diğer", color: "#8a94a3" } };
const kindOf = (k) => KIND[k] || KIND.diger;
const kindChip = (k) => `<span class="kind" style="--c:${kindOf(k).color}">${esc(KIND[k] ? KIND[k].label : k || "Diğer")}</span>`;
const YOK = '<span class="yok">veri yok</span>';
const nTag = (n, birim = "") => `<span class="n">n=${n ?? 0}${birim ? " " + birim : ""}</span>`;
const val = (v, f = (x) => x) => (v == null ? YOK : f(v));
const ol = (v, n, f, birim) => `${val(v, f)}${nTag(n, birim)}`;          // ölçü + n
const pctF = (v) => "%" + v;
const fix1 = (v) => (Math.round(v * 10) / 10).toLocaleString("tr-TR");
const tarih = (t) => (t == null ? "—" : new Date(t * 1000).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" }));
const mmss = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const emoS = (e) => (e == null ? YOK : EMO[e] ? `${EMO[e].icon} ${EMO[e].label}` : esc(e));
const ortalama = (a) => { a = a.filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
function baskin(list) {
  const c = {}; for (const e of list) if (e != null) c[e] = (c[e] || 0) + 1;
  const k = Object.keys(c); return k.length ? k.reduce((a, b) => (c[b] > c[a] ? b : a)) : null;
}
function cssVar(v) {
  if (!v.startsWith("var(")) return v;
  return getComputedStyle(document.documentElement).getPropertyValue(v.slice(4, -1)).trim() || "#888";
}

// "Adları gizle": ad yerine katılımcı kodu; kodsuz öğrenciler ders içinde sid sırasına göre kodsuz-1, kodsuz-2 …
function adlar(ogrenciler) {
  const kodsuz = ogrenciler.filter((s) => !s.participant_code).map((s) => s.sid).sort();
  const m = new Map();
  for (const s of ogrenciler) {
    const etiket = s.participant_code || `kodsuz-${kodsuz.indexOf(s.sid) + 1}`;
    m.set(s.sid, GIZLE ? etiket : s.name || etiket);
  }
  return (sid) => m.get(sid) ?? (GIZLE ? "kodsuz-?" : sid);
}

// ---------------------------------------------------------------- tuval yardımcıları
function tuval(canvas) {
  const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return null;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

// 18×32 ızgara (0–1, yonetim._isi biçimi) → düz 0–100 dizi; hiç nokta yoksa null (boş ızgara "veri yok"tur, sıfır ısı değil)
function duzIsi(isi) {
  if (!isi) return null;
  const flat = isi.flat();
  return flat.some((v) => v > 0) ? flat.map((v) => v * 100) : null;
}
// örnek satırlarının mat_pts noktalarından ızgara (yonetim._isi ile aynı kural)
function isiIzgara(rows) {
  const g = new Array(18 * 32).fill(0);
  let top = 0;
  for (const r of rows) for (const p of r.pts || []) {
    const u = +p[0], v = +p[1];
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    const y = Math.min(Math.max(Math.floor(v * 18), 0), 17), x = Math.min(Math.max(Math.floor(u * 32), 0), 31);
    g[y * 32 + x]++; top++;
  }
  const m = Math.max(...g);
  return { grid: m ? g.map((c) => (100 * c) / m) : null, nokta: top };
}

const _katman = new WeakMap();
function sisKatmani(grid) {
  const k = 10, off = document.createElement("canvas");
  off.width = 32 * k; off.height = 18 * k;
  const o = off.getContext("2d");
  o.fillStyle = "rgba(8,10,14,.92)"; o.fillRect(0, 0, off.width, off.height);
  o.globalCompositeOperation = "destination-out";
  grid.forEach((v, i) => {
    if (v <= 1) return;
    const x = ((i % 32) + 0.5) * k, y = (Math.floor(i / 32) + 0.5) * k;
    const g = o.createRadialGradient(x, y, 0, x, y, k * 2.2);
    g.addColorStop(0, `rgba(0,0,0,${Math.min(1, 0.25 + v / 100)})`); g.addColorStop(1, "rgba(0,0,0,0)");
    o.fillStyle = g; o.fillRect(x - k * 3, y - k * 3, k * 6, k * 6);
  });
  return off;
}
// Materyal görseli + ısı / sis. Noktalar (u,v) görselin içerik dikdörtgenine eşlenir; görsel yoksa boş 16:9 tuval.
function cizMateryal(canvas, { grid = null, img = null, mod = "isi", kucuk = false } = {}) {
  const T = tuval(canvas); if (!T) return;
  const { ctx, w, h } = T;
  ctx.fillStyle = "#0b0d10"; ctx.fillRect(0, 0, w, h);
  const oran = img ? img.naturalWidth / img.naturalHeight : 16 / 9;
  let aw = w, ah = w / oran; if (ah > h) { ah = h; aw = h * oran; }
  const ax = (w - aw) / 2, ay = (h - ah) / 2;
  const fs = kucuk ? 10 : 13;
  ctx.font = `${fs}px system-ui, sans-serif`; ctx.textAlign = "center";
  if (img) ctx.drawImage(img, ax, ay, aw, ah);
  else {
    ctx.strokeStyle = "rgba(255,255,255,.07)"; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(ax + (aw * i) / 4, ay); ctx.lineTo(ax + (aw * i) / 4, ay + ah); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ax, ay + (ah * i) / 4); ctx.lineTo(ax + aw, ay + (ah * i) / 4); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.strokeRect(ax + 0.5, ay + 0.5, aw - 1, ah - 1);
    ctx.fillStyle = "#8a94a3"; ctx.fillText("görsel yok", w / 2, ay + ah - (kucuk ? 6 : 14));
  }
  if (grid) {
    let c = _katman.get(grid);
    if (!c) { c = { isi: heatLayer(grid, 32, 18), sis: null }; _katman.set(grid, c); }
    if (mod === "sis" && !c.sis) c.sis = sisKatmani(grid);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.drawImage(mod === "sis" ? c.sis : c.isi, ax, ay, aw, ah);
  } else {
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(ax, ay + ah / 2 - fs, aw, fs * 2);
    ctx.fillStyle = "#e8ebf0"; ctx.fillText("bakış verisi yok", w / 2, ay + ah / 2 + fs / 3);
  }
  ctx.textAlign = "start";
}

const _gorsel = new Map();
function gorselYukle(code, m) {
  if (!m.hasImage) return Promise.resolve(null);
  const k = code + "/" + m.id;
  if (!_gorsel.has(k)) _gorsel.set(k, new Promise((ok) => {
    const im = new Image();
    im.onload = () => ok(im); im.onerror = () => { _gorsel.delete(k); ok(null); };
    im.src = gorselUrl(code, m.id);
  }));
  return _gorsel.get(k);
}

// Zaman çizelgesi: materyal şeritleri (arka plan), dikkat/enerji çizgileri, duygu şeridi, olay işaretleri.
const OLAY = {
  alert: { label: "Uyarı", color: "#d64545", sekil: "ucgen" },
  hand: { label: "El kaldırma", color: "#e09b17", sekil: "daire" },
  chat: { label: "Sohbet", color: "#3b82f6", sekil: "kare" },
};
function olayGorunur(o) { return OLAY[o.kind] && !(o.kind === "hand" && o.data && o.data.up === false); }

function cizZaman(canvas, d) {
  const T = tuval(canvas); if (!T) return;
  const { ctx, w, h } = T;
  const pad = { l: 36, r: 12, t: 26, b: 44 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const t0 = d.ders.created;
  const son = d.zaman.length ? d.zaman[d.zaman.length - 1].t + 10 : null;
  const t1 = Math.max(d.ders.ended ?? son ?? t0 + 60, ...d.spans.map((s) => s.t_end ?? 0), t0 + 10);
  const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * iw, Y = (v) => pad.t + ih - (v / 100) * ih;
  const mats = new Map(d.materyaller.map((m) => [m.id, m]));
  ctx.font = "11px system-ui, sans-serif";
  // materyal şeritleri
  for (const s of d.spans) {
    const m = mats.get(s.material_id), x0 = X(s.t_start), x1 = X(s.t_end ?? t1);
    ctx.globalAlpha = 0.14; ctx.fillStyle = kindOf(m?.kind).color; ctx.fillRect(x0, pad.t, x1 - x0, ih); ctx.globalAlpha = 1;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, pad.t, x1 - x0, ih); ctx.clip();
    ctx.fillStyle = kindOf(m?.kind).color; ctx.fillText(m ? m.name : "?", x0 + 4, pad.t + 12); ctx.restore();
  }
  // ızgara
  ctx.strokeStyle = cssVar("var(--border)"); ctx.fillStyle = cssVar("var(--muted)"); ctx.lineWidth = 1;
  for (const v of [0, 25, 50, 75, 100]) {
    const y = Y(v); ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); ctx.fillText(v, 8, y + 4);
  }
  for (let i = 0; i <= 5; i++) {
    const t = t0 + ((t1 - t0) * i) / 5, s = mmss(t - t0), tw = ctx.measureText(s).width;
    ctx.fillText(s, Math.min(Math.max(X(t) - tw / 2, pad.l), w - pad.r - tw), h - 6);
  }
  // çizgiler (kutu ortası; değer yoksa ya da kutu atlanmışsa çizgi kesilir)
  for (const [key, col] of [["dikkat", "var(--c-att)"], ["enerji", "var(--c-en)"]]) {
    ctx.strokeStyle = cssVar(col); ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.beginPath();
    let onceki = null;
    for (const z of d.zaman) {
      const v = z[key];
      if (v == null) { onceki = null; continue; }
      const x = X(z.t + 5), y = Y(v);
      onceki != null && z.t - onceki <= 10 ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      onceki = z.t;
    }
    ctx.stroke();
  }
  // duygu şeridi
  const ey = pad.t + ih + 6, eh = 12;
  for (const z of d.zaman) {
    const top = Object.values(z.duygular).reduce((a, b) => a + b, 0);
    if (!top) continue;
    let y = ey; const x0 = X(z.t), x1 = X(z.t + 10);
    for (const k of Object.keys(EMO).concat(Object.keys(z.duygular).filter((k) => !EMO[k]))) {
      const c = z.duygular[k]; if (!c) continue;
      const hh = (eh * c) / top;
      ctx.fillStyle = EMO[k] ? cssVar(EMO[k].color) : "#999"; ctx.fillRect(x0, y, Math.max(1, x1 - x0), hh); y += hh;
    }
  }
  // olaylar: konu/bitiş dikey çizgi, diğerleri işaret
  for (const o of d.olaylar) {
    const x = X(o.t);
    if (o.kind === "topic" || o.kind === "end") {
      ctx.strokeStyle = cssVar("var(--muted)"); ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ih); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    if (!olayGorunur(o)) continue;
    isaret(ctx, OLAY[o.kind], x, 12);
  }
  canvas._tl = { t0, t1, X, pad, iw, d };
}
function isaret(ctx, s, x, y) {
  ctx.fillStyle = s.color; ctx.beginPath();
  if (s.sekil === "ucgen") { ctx.moveTo(x - 5, y - 5); ctx.lineTo(x + 5, y - 5); ctx.lineTo(x, y + 4); }
  else if (s.sekil === "kare") ctx.rect(x - 4, y - 4, 8, 8);
  else ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

let _tip = null;
function ipucu(html, ev) {
  if (!_tip) { _tip = document.createElement("div"); _tip.className = "tip"; document.body.append(_tip); }
  if (!html) { _tip.style.display = "none"; return; }
  _tip.innerHTML = html; _tip.style.display = "block";
  const r = _tip.getBoundingClientRect();
  _tip.style.left = Math.min(ev.clientX + 12, innerWidth - r.width - 8) + "px";
  _tip.style.top = ev.clientY + 14 + "px";
}
function zamanIpucu(canvas, adOf) {
  canvas.onmouseleave = () => ipucu(null);
  canvas.onmousemove = (ev) => {
    const tl = canvas._tl; if (!tl) return;
    const x = ev.offsetX; if (x < tl.pad.l || x > tl.pad.l + tl.iw) return ipucu(null);
    const t = tl.t0 + ((x - tl.pad.l) / tl.iw) * (tl.t1 - tl.t0);
    const z = tl.d.zaman.find((q) => t >= q.t && t < q.t + 10);
    const sp = tl.d.spans.find((s) => t >= s.t_start && t < (s.t_end ?? tl.t1));
    const m = sp && tl.d.materyaller.find((q) => q.id === sp.material_id);
    const yakin = tl.d.olaylar.filter((o) => olayGorunur(o) && Math.abs(tl.X(o.t) - x) < 6);
    let s = `<b>${mmss(t - tl.t0)}</b> · ${m ? esc(kindOf(m.kind).label + ": " + m.name) : "materyal seçili değil"}<br>`;
    s += z ? `dikkat ${val(z.dikkat, fix1)} · enerji ${val(z.enerji, fix1)} · n=${z.n} örnek (10 sn)` : "bu aralıkta örnek yok";
    for (const o of yakin) s += `<br>${OLAY[o.kind].label}${o.sid ? " · " + esc(adOf(o.sid)) : ""}${o.data?.text ? ": " + esc(String(o.data.text).slice(0, 60)) : ""}`;
    ipucu(s, ev);
  };
}

// ---------------------------------------------------------------- ham örnekler (CSV) ve fiksasyon
function csvAyristir(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); rows.push(row); row = []; f = "";
    } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const _ham = new Map();
// /api/admin/csv?tur=ham → [{sid, t, mid, att, en, emo, face, cal, coarse, share, pts, gaze}] (yalnız okunur, önbellekli)
function hamOrnekler(code) {
  if (!_ham.has(code)) {
    const p = aapiResp(`csv?tur=ham&code=${enc(code)}`).then((r) => r.text()).then((txt) => {
      const satir = csvAyristir(txt.replace(/^﻿/, ""));
      const bas = satir.shift() || [], ix = Object.fromEntries(bas.map((k, i) => [k, i]));
      const ham = (s) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s);
      const sayi = (s) => (s === "" || s == null ? null : +s);
      const js = (s) => { if (!s) return null; try { return JSON.parse(s); } catch { return null; } };
      return satir.filter((r) => r.length >= bas.length).map((r) => ({
        sid: ham(r[ix.ogrenci]), t: +r[ix.t], mid: sayi(r[ix.material_id]), att: sayi(r[ix.attention]),
        en: sayi(r[ix.energy]), emo: r[ix.emotion] || null, face: sayi(r[ix.face]), cal: sayi(r[ix.gaze_cal]) === 1,
        coarse: sayi(r[ix.coarse]) === 1, share: js(r[ix.share]), pts: js(r[ix.mat_pts]), gaze: js(r[ix.gaze]) }));
    });
    p.catch(() => _ham.delete(code));
    _ham.set(code, p);
  }
  return _ham.get(code);
}
// yonetim._ozet ile aynı tanım: yalnız kalibreli ve dolu share'li örnekler; share'de materyal yoksa 0
function bakmaPct(rows) {
  const b = [];
  for (const r of rows) if (r.cal && r.share && typeof r.share === "object" && Object.keys(r.share).length) b.push(r.share.materyal || 0);
  return { v: b.length ? Math.round((100 * b.reduce((x, y) => x + y, 0)) / b.length) : null, n: b.length };
}

const _ogr = new Map();
const ogrenciVeri = (code, sid) => {
  const k = code + "/" + sid;
  if (!_ogr.has(k)) { const p = aapi(`ogrenci?code=${enc(code)}&sid=${enc(sid)}`); p.catch(() => _ogr.delete(k)); _ogr.set(k, p); }
  return _ogr.get(k);
};
const _fiks = new Map();
// Fiksasyonlar (GL.ivt, I-VT 30°/s, 80–400 ms) tam ekran bakış örneklerinden; piksel = pencere oranı × kurulumdaki pencere boyutu.
// Derece dönüşümü tahmindir (GL.DEG_PER_PX). Pencere boyutu kaydı olmayan öğrenci hesaba girmez (pencereYok).
// Dönen: { list: [{sid, mid, start(ms), dur}], ogrenci: Set(hesaplanan sid), pencereYok: [sid] }
function fiksasyonlar(code) {
  if (_fiks.has(code)) return _fiks.get(code);
  const p = (async () => {
    const rows = await hamOrnekler(code);
    const bySid = new Map();
    for (const r of rows) if (r.cal && Array.isArray(r.gaze) && r.gaze.length) (bySid.get(r.sid) || bySid.set(r.sid, []).get(r.sid)).push(r);
    const out = { list: [], ogrenci: new Set(), pencereYok: [] };
    for (const [sid, rs] of bySid) {
      const kur = ((await ogrenciVeri(code, sid)).kurulumlar || [])
        .map((k) => ({ t: k.t, m: /^(\d+)x(\d+)$/.exec(k.setup?.pencere || "") })).filter((k) => k.m);
      if (!kur.length) { out.pencereYok.push(sid); continue; }
      const boyut = (t) => { let s = kur[0]; for (const k of kur) if (k.t <= t) s = k; return [+s.m[1], +s.m[2]]; };
      rs.sort((a, b) => a.t - b.t);
      let seg = [], onceki = null, wh = null;
      const bitir = () => {
        if (seg.length >= 3) for (const f of GL.ivt(seg).fixations) {
          const i = seg.findIndex((q) => q[0] >= f.start);
          out.list.push({ sid, mid: seg[i < 0 ? seg.length - 1 : i][3], start: f.start, dur: f.dur });
        }
        seg = [];
      };
      for (const r of rs) {
        const b = boyut(r.t);
        if (!wh || b[0] !== wh[0] || b[1] !== wh[1]) { bitir(); wh = b; onceki = null; }
        for (const g of r.gaze) {
          const tm = r.t * 1000 + g[0];
          if (onceki != null && (tm - onceki > 250 || tm < onceki)) bitir();
          seg.push([tm, g[1] * wh[0], g[2] * wh[1], r.mid]); onceki = tm;
        }
      }
      bitir();
      out.ogrenci.add(sid);
    }
    return out;
  })();
  p.catch(() => _fiks.delete(code));
  _fiks.set(code, p);
  return p;
}
function fiksOzet(list) {
  return { n: list.length, ort: list.length ? Math.round(list.reduce((a, f) => a + f.dur, 0) / list.length) : null,
           ogr: new Set(list.map((f) => f.sid)).size };
}

// ---------------------------------------------------------------- görünüm 1: dersler
const FILTRE = { ara: "", bas: "", bit: "", tur: "" };
async function viewDersler(_p, live) {
  const q = new URLSearchParams();
  if (FILTRE.ara) q.set("ara", FILTRE.ara);
  if (FILTRE.bas) q.set("bas", new Date(FILTRE.bas + "T00:00:00").getTime() / 1000);
  if (FILTRE.bit) q.set("bit", new Date(FILTRE.bit + "T23:59:59").getTime() / 1000);
  const liste = await aapi("dersler?" + q);
  if (!live()) return;
  const turOk = (d) => !FILTRE.tur || (FILTRE.tur === "insan" ? d.n_insan > 0 : FILTRE.tur === "yz" ? d.n_yz > 0 : d.n_insan > 0 && d.n_yz > 0);
  const goster = liste.filter(turOk);
  APP.innerHTML = `
    <div class="head"><h1>Dersler</h1><div class="muted small">Kalıcı kayda yazılmış dersler (demo öğrenciler hariç). Satıra tıklayınca ders açılır.</div></div>
    <form class="card filters" id="filt">
      <div class="grow"><label for="fAra">Ad / konu / kod</label><input id="fAra" value="${esc(FILTRE.ara)}" placeholder="ara…"></div>
      <div><label for="fBas">Başlangıç tarihi</label><input id="fBas" type="date" value="${esc(FILTRE.bas)}"></div>
      <div><label for="fBit">Bitiş tarihi</label><input id="fBit" type="date" value="${esc(FILTRE.bit)}"></div>
      <div><label for="fTur">Materyal türü</label><select id="fTur">
        <option value="">Hepsi</option><option value="insan">İnsan materyali olan</option>
        <option value="yz">YZ materyali olan</option><option value="ikisi">İkisi de olan</option></select></div>
      <div class="row"><button class="btn primary">Uygula</button><button class="btn" type="button" id="fSifir">Temizle</button></div>
    </form>
    <div class="card"><div class="tbl"><table>
      <tr><th>Tarih</th><th>Ders</th><th>Konu</th><th>Süre</th><th>Öğrenci</th><th>Materyal</th><th>Ort. dikkat</th><th>Kalibreli örnek</th></tr>
      ${goster.map((d) => `<tr class="click" data-code="${esc(d.code)}">
        <td class="num">${tarih(d.created)}</td>
        <td><b>${esc(d.name || "—")}</b> <span class="muted small">${esc(d.code)}</span>${d.bitmedi ? ' <span class="pill" title="Bitiş kaydı yok; süre son örneğe göre">bitmedi</span>' : ""}</td>
        <td>${esc(d.topic || "—")}</td>
        <td class="num">${val(d.sure_dk, (v) => fix1(v) + " dk")}</td>
        <td class="num">${d.n_ogrenci}</td>
        <td class="num">${d.n_materyal} <span class="muted small">(<span style="color:${KIND.insan.color}">İnsan ${d.n_insan}</span> / <span style="color:${KIND.yz.color}">YZ ${d.n_yz}</span>)</span></td>
        <td class="num" style="color:${levelColor(d.ort_dikkat)}">${ol(d.ort_dikkat, d.n_ogrenci, fix1, "öğr.")}</td>
        <td class="num" title="Bakışı iyi kalibreli 2 sn örneklerinin tüm örneklere oranı">${ol(d.kalibreli_pct, d.n_ogrenci, pctF, "öğr.")}</td></tr>`).join("")}
    </table></div>
    ${goster.length ? "" : `<div class="muted" style="padding:14px 4px">${liste.length ? "Filtreye uyan ders yok." : "Kayıtlı ders yok."}</div>`}
    <div class="note">Ort. dikkat: tüm öğrencilerin 2 sn örneklerinin ortalaması. Kalibreli örnek: bakışı iyi kalibreli örneklerin yüzdesi (kaba/kalibresiz örnekler bakış ölçülerine girmez).</div></div>`;
  $("#fTur").value = FILTRE.tur;
  $("#filt").onsubmit = (e) => {
    e.preventDefault();
    Object.assign(FILTRE, { ara: $("#fAra").value.trim(), bas: $("#fBas").value, bit: $("#fBit").value, tur: $("#fTur").value });
    route();
  };
  $("#fSifir").onclick = () => { Object.assign(FILTRE, { ara: "", bas: "", bit: "", tur: "" }); route(); };
  APP.querySelectorAll("tr[data-code]").forEach((tr) => (tr.onclick = () => (location.hash = "#ders/" + enc(tr.dataset.code))));
}

// ---------------------------------------------------------------- görünüm 2: ders
let _esik = null;
async function viewDers([code], live) {
  const [d, esik] = await Promise.all([aapi(`ders?code=${enc(code)}`), _esik || aapi("kalite_esik")]);
  _esik = esik;
  if (!live()) return;
  const L = d.ders, ad = adlar(d.ogrenciler);
  const t1 = L.ended ?? (d.zaman.length ? d.zaman[d.zaman.length - 1].t + 10 : null);
  const el = {}, sohbet = {};
  for (const o of d.olaylar) {
    if (!o.sid) continue;
    if (o.kind === "hand" && o.data?.up) el[o.sid] = (el[o.sid] || 0) + 1;
    if (o.kind === "chat") sohbet[o.sid] = (sohbet[o.sid] || 0) + 1;
  }
  const i = esik.iyi, o = esik.orta;
  APP.innerHTML = `
    <div class="head"><div class="muted small"><a href="#dersler">Dersler</a> / ${esc(L.code)}</div>
      <h1>${esc(L.name || L.code)}</h1>
      <div class="muted small">${tarih(L.created)} · süre ${t1 != null ? mmss(t1 - L.created) + " (dk:sn)" : "veri yok"}${L.ended == null ? ' · <span class="pill">bitmedi (süre son örneğe göre)</span>' : ""}
        · Konu: ${esc(L.topic || "—")} · ${d.ogrenciler.length} öğrenci · ${d.materyaller.length} materyal</div></div>
    <div class="card">
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;margin-bottom:8px">
        <h3 style="margin:0">Zaman çizelgesi — sınıf ortalaması (10 sn kutular)</h3>
        <div class="legend"><span style="--c:var(--c-att)">Dikkat</span><span style="--c:var(--c-en)">Enerji</span>
          ${Object.entries(KIND).map(([, k]) => `<span style="--c:${k.color}">${k.label} materyali</span>`).join("")}
          ${Object.values(OLAY).map((s) => `<span style="--c:${s.color}">${s.label}</span>`).join("")}</div></div>
      <canvas id="tl"></canvas>
      <div class="legend" style="margin-top:6px">Duygu şeridi: ${Object.values(EMO).map((e) => `<span style="--c:${e.color}">${e.label}</span>`).join("")}</div>
      ${d.zaman.length ? "" : '<div class="note">Bu derste örnek yok: çizgiler veri yok.</div>'}
    </div>
    <div class="card"><h3>Materyaller</h3><div class="tbl"><table>
      <tr><th>Tür</th><th>Materyal</th><th>Ekranda</th><th title="Kalibreli öğrencilerin bakışının materyal bölgesindeki payı">Materyale bakma</th><th>Ort. dikkat</th><th>Baskın duygu</th>
        <th title="I-VT (GL.ivt), tam ekran bakıştan; derece dönüşümü tahmin">Fiksasyon (tahmin)</th><th>Isı haritası</th></tr>
      ${d.materyaller.map((m) => `<tr class="click" data-mat="${m.id}">
        <td>${kindChip(m.kind)}</td><td><a href="#materyal/${enc(L.code)}/${m.id}">${esc(m.name)}</a></td>
        <td class="num">${m.sure_sn ? mmss(m.sure_sn) : '<span class="yok">gösterilmedi</span>'}</td>
        <td class="num">${ol(m.bakma_pct, m.n_kalibreli, pctF, "kalibreli öğr.")}</td>
        <td class="num" style="color:${levelColor(m.ort_dikkat)}">${ol(m.ort_dikkat, m.n_ornek, fix1, "örnek")}</td>
        <td>${emoS(m.baskin_duygu)}</td>
        <td class="num" data-fiks="${m.id}"><span class="muted small">hesaplanıyor…</span></td>
        <td><canvas class="mini" data-isi="${m.id}"></canvas></td></tr>`).join("")}
    </table></div>
    ${d.materyaller.length ? "" : '<div class="muted" style="padding:10px 4px">Bu derste materyal tanımlanmamış.</div>'}
    <div class="note">Materyale bakma ve ısı haritası yalnız iyi kalibreli öğrencilerden (n = kalibreli öğrenci). Fiksasyon: sayı · ortalama süre,
      tam ekran bakış örneklerinden I-VT (30°/s, 80–400 ms); piksel→derece dönüşümü tahmindir, konum materyal üzerine eşlenmez.</div></div>
    <div class="card"><h3>Öğrenciler</h3><div class="tbl"><table>
      <tr><th>Öğrenci</th><th>Kod</th><th>Kalite</th><th>Son kal. hatası</th><th>Kamerada</th><th>Kalibreli</th><th>Örnekleme</th>
        <th>Ort. dikkat</th><th>Baskın duygu</th><th>Materyale bakma</th><th>✋</th><th>Sohbet</th></tr>
      ${d.ogrenciler.map((s) => { const k = s.kalite; return `<tr class="click" data-sid="${esc(s.sid)}">
        <td><b>${esc(ad(s.sid))}</b></td><td>${s.participant_code ? esc(s.participant_code) : '<span class="muted small">kodsuz</span>'}</td>
        <td>${kaliteRozet(k.not)}</td>
        <td class="num">${val(k.kal_hata, (v) => Math.round(v) + " px")}</td>
        <td class="num">${ol(k.kamerada_pct, s.n_ornek, pctF, "örnek")}</td>
        <td class="num">${ol(k.kalibreli_pct, s.n_ornek, pctF, "örnek")}</td>
        <td class="num">${val(k.hz, (v) => fix1(v) + " Hz")}</td>
        <td class="num" style="color:${levelColor(s.ort_dikkat)}">${ol(s.ort_dikkat, s.n_ornek, fix1, "örnek")}</td>
        <td>${emoS(s.baskin_duygu)}</td>
        <td class="num" data-bakma="${esc(s.sid)}"><span class="muted small">hesaplanıyor…</span></td>
        <td class="num">${el[s.sid] || 0}</td><td class="num">${sohbet[s.sid] || 0}</td></tr>`; }).join("")}
    </table></div>
    ${d.ogrenciler.length ? "" : '<div class="muted" style="padding:10px 4px">Bu derse kayıtlı (demo olmayan) öğrenci yok.</div>'}
    <div class="note">Kalite notu (yalnız filtre ve uyarı içindir, veri silmez): <b>iyi</b> = kamerada ≥%${i.kamerada}, kalibreli ≥%${i.kalibreli},
      örnekleme ≥${i.hz} Hz ve son kalibrasyon hatası ≤${i.hata} px (hata kaydı yoksa bu koşula bakılmaz); <b>orta</b> = kamerada ≥%${o.kamerada}, kalibreli ≥%${o.kalibreli};
      geri kalanı <b>düşük</b>. Örnekleme: kalibreli 2 sn örneklerdeki tam ekran bakış noktası / saniye.</div></div>`;

  const tl = $("#tl");
  const ciz = () => {
    cizZaman(tl, d);
    d.materyaller.forEach((m) => gorselYukle(L.code, m).then((img) => {
      const c = APP.querySelector(`canvas[data-isi="${m.id}"]`);
      if (c && live()) cizMateryal(c, { grid: duzIsi(m.isi), img, kucuk: true });
    }));
  };
  ciz(); onResize = ciz;
  zamanIpucu(tl, ad);
  APP.querySelectorAll("tr[data-mat]").forEach((tr) => (tr.onclick = (e) => { if (e.target.tagName !== "A") location.hash = `#materyal/${enc(L.code)}/${tr.dataset.mat}`; }));
  APP.querySelectorAll("tr[data-sid]").forEach((tr) => (tr.onclick = () => (location.hash = `#ogrenci/${enc(L.code)}/${enc(tr.dataset.sid)}`)));

  // ham örneklerden ek ölçüler (öğrenci materyale bakma %, materyal fiksasyonları): sayfa açıldıktan sonra
  const hata = (sel) => APP.querySelectorAll(sel).forEach((c) => (c.innerHTML = '<span class="yok">hesaplanamadı</span>'));
  hamOrnekler(L.code).then((rows) => {
    if (!live()) return;
    for (const s of d.ogrenciler) {
      const c = APP.querySelector(`td[data-bakma="${CSS.escape(s.sid)}"]`), b = bakmaPct(rows.filter((r) => r.sid === s.sid));
      if (c) c.innerHTML = ol(b.v, b.n, pctF, "örnek");
    }
  }).catch((e) => { if (!(e instanceof Yetkisiz)) hata("td[data-bakma]"); });
  fiksasyonlar(L.code).then((F) => {
    if (!live()) return;
    for (const m of d.materyaller) {
      const c = APP.querySelector(`td[data-fiks="${m.id}"]`), z = fiksOzet(F.list.filter((f) => f.mid === m.id));
      if (c) c.innerHTML = z.n ? `${z.n} · ${z.ort} ms${nTag(z.ogr, "öğr.")}` : `${YOK}${nTag(0, "öğr.")}`;
    }
  }).catch((e) => { if (!(e instanceof Yetkisiz)) hata("td[data-fiks]"); });
}
function kaliteRozet(n) {
  const c = { iyi: "var(--good)", orta: "var(--warn)", "düşük": "var(--bad)" }[n];
  return c ? `<span class="pill" style="color:${c}">${esc(n)}</span>` : YOK;
}

// ---------------------------------------------------------------- görünüm 3: materyal
const MAT_SEC = { key: "", sid: "", mod: "isi" };
async function viewMateryal([code, idS], live) {
  const id = +idS;
  const d = await aapi(`ders?code=${enc(code)}`);
  if (!live()) return;
  const m = d.materyaller.find((x) => x.id === id);
  if (!m) { APP.innerHTML = `<div class="card">Materyal bulunamadı. <a href="#ders/${enc(code)}">Derse dön</a></div>`; return; }
  const L = d.ders, ad = adlar(d.ogrenciler);
  APP.innerHTML = `
    <div class="head"><div class="muted small"><a href="#dersler">Dersler</a> / <a href="#ders/${enc(L.code)}">${esc(L.name || L.code)}</a> / materyal</div>
      <h1>${kindChip(m.kind)} ${esc(m.name)}</h1></div>
    <div class="mat-grid">
      <div class="card">
        <div class="opts">
          <label>Öğrenci <select id="mSid"><option value="">Tüm öğrenciler</option></select></label>
          <span><label><input type="radio" name="veri" value="tum" checked> Tüm bakış noktaları</label>
            <label title="Materyal üzerindeki noktalar zaman damgasız saklanıyor; fiksasyonlar materyal üzerinde konumlanamaz. Fiksasyon sayısı yanda (tam ekran)."
              style="opacity:.55"><input type="radio" name="veri" value="fiks" disabled> Fiksasyonlar (konum verisi yok)</label></span>
          <span><label><input type="radio" name="mod" value="isi"> Isı haritası</label><label><input type="radio" name="mod" value="sis"> Sis</label></span>
        </div>
        <canvas id="big" class="big"></canvas>
        <div class="range" id="aralik"><span>Başlangıç</span><input type="range" id="rBas"><span id="rBasT" class="num">—</span>
          <span>Bitiş</span><input type="range" id="rBit"><span id="rBitT" class="num">—</span></div>
        <div class="note" id="mNot"></div>
      </div>
      <div class="card"><h3>Özet (seçime göre)</h3><dl class="ozet" id="ozet"><dt>Yükleniyor…</dt><dd></dd></dl></div>
    </div>`;
  if (MAT_SEC.key !== code + "/" + id) Object.assign(MAT_SEC, { key: code + "/" + id, sid: "" });
  APP.querySelector(`input[name=mod][value=${MAT_SEC.mod}]`).checked = true;
  const big = $("#big");
  cizMateryal(big, { img: null });
  const [img, rows, F] = await Promise.all([gorselYukle(code, m), hamOrnekler(code),
    fiksasyonlar(code).catch((e) => { if (e instanceof Yetkisiz) throw e; return null; })]);
  if (!live()) return;
  const mr = rows.filter((r) => r.mid === id);
  const sids = [...new Set(mr.map((r) => r.sid))];
  const kalSid = new Set(mr.filter((r) => r.cal).map((r) => r.sid));
  $("#mSid").innerHTML += sids.map((s) => `<option value="${esc(s)}">${esc(ad(s))}${kalSid.has(s) ? "" : " (kalibre değil — bakış verisi yok)"}</option>`).join("");
  if (sids.includes(MAT_SEC.sid)) $("#mSid").value = MAT_SEC.sid; else MAT_SEC.sid = "";
  const ts = mr.map((r) => r.t), tMin = ts.length ? Math.min(...ts) : 0, tMax = ts.length ? Math.max(...ts) : 0;
  const rb = $("#rBas"), re = $("#rBit");
  for (const r of [rb, re]) { r.min = tMin; r.max = tMax; r.step = 2; r.disabled = !ts.length; }
  rb.value = tMin; re.value = tMax;
  const rel = (t) => mmss(t - L.created);

  const guncelle = () => {
    let a = +rb.value, b = +re.value; if (a > b) [a, b] = [b, a];
    $("#rBasT").textContent = ts.length ? rel(a) : "—"; $("#rBitT").textContent = ts.length ? rel(b) : "—";
    const secili = mr.filter((r) => r.t >= a && r.t <= b && (!MAT_SEC.sid || r.sid === MAT_SEC.sid));
    const kal = secili.filter((r) => r.cal), dis = secili.filter((r) => !r.cal);
    const I = isiIzgara(kal), bk = bakmaPct(secili);
    cizMateryal(big, { grid: I.grid, img, mod: MAT_SEC.mod });
    const ogrS = new Set(secili.map((r) => r.sid)), kalS = new Set(kal.map((r) => r.sid));
    const disS = [...ogrS].filter((s) => !kalS.has(s));
    let fx = null;
    if (F) fx = fiksOzet(F.list.filter((f) => f.mid === id && f.start >= (a - 2) * 1000 && f.start <= b * 1000 && (!MAT_SEC.sid || f.sid === MAT_SEC.sid)));
    const sat = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    $("#ozet").innerHTML =
      sat("Aralık (ders saati)", ts.length ? `${rel(a)} – ${rel(b)}` : YOK) +
      sat("Ekranda kalma (tüm ders)", m.sure_sn ? mmss(m.sure_sn) : '<span class="yok">gösterilmedi</span>') +
      sat("Öğrenci", `${ogrS.size}${nTag(kalS.size, "kalibreli")}`) +
      sat("2 sn örnek", `${secili.length}${nTag(kal.length, "kalibreli")}`) +
      sat("Isı haritası noktası", I.nokta ? String(I.nokta) : YOK) +
      sat("Materyale bakma", ol(bk.v, bk.n, pctF, "örnek")) +
      sat("Ort. dikkat", ol(ortalama(secili.map((r) => r.att)), secili.filter((r) => r.att != null).length, fix1, "örnek")) +
      sat("Ort. enerji", ol(ortalama(secili.map((r) => r.en)), secili.filter((r) => r.en != null).length, fix1, "örnek")) +
      sat("Baskın duygu", `${emoS(baskin(secili.map((r) => r.emo)))}${nTag(secili.filter((r) => r.emo).length, "örnek")}`) +
      sat("Fiksasyon (tahmin)", fx == null ? '<span class="yok">hesaplanamadı</span>' : fx.n ? `${fx.n} · ort. ${fx.ort} ms${nTag(fx.ogr, "öğr.")}` : `${YOK}${nTag(0, "öğr.")}`);
    $("#mNot").innerHTML = `Isı haritası ve bakış ölçüleri yalnız iyi kalibreli örneklerden. ` +
      (dis.length ? `Dışarıda kalan: ${dis.length} örnek (kalibresiz ya da kaba kalibrasyon)${disS.length ? `, ${disS.length} öğrencinin hiç bakış verisi yok` : ""}. ` : "") +
      (img ? "Noktalar görselin içerik alanına eşlenir." : m.hasImage ? "Görsel yüklenemedi; boş 16:9 tuval." : "Bu materyalin görseli yok; boş 16:9 tuval.") +
      " Fiksasyon sayısı tam ekran bakıştan I-VT ile; derece dönüşümü tahmin.";
  };
  guncelle();
  onResize = guncelle;
  rb.oninput = re.oninput = guncelle;
  $("#mSid").onchange = (e) => { MAT_SEC.sid = e.target.value; guncelle(); };
  APP.querySelectorAll("input[name=mod]").forEach((r) => (r.onchange = () => { MAT_SEC.mod = r.value; guncelle(); }));
}

// ---------------------------------------------------------------- henüz yazılmamış görünümler (Task 8)
function viewSonra(baslik) {
  return async () => { APP.innerHTML = `<div class="card"><h2>${esc(baslik)}</h2><p class="muted">Bu görünüm sonraki adımda eklenecek.</p></div>`; };
}

// ---------------------------------------------------------------- yönlendirme
// karma: #<rota>/<parametreler…>; parametreler URL-kodlu. Ders kodu içeren rotalar: ilk parametre = ders kodu.
const ROUTES = {
  dersler: { view: viewDersler },
  ders: { view: viewDers, dersli: true },
  materyal: { view: viewMateryal, dersli: true },
  ogrenci: { view: viewSonra("Öğrenci"), dersli: true },
  karsilastirma: { view: viewSonra("Karşılaştırma (insan / YZ)") },
  katilimcilar: { view: viewSonra("Katılımcılar") },
};

function karma() {
  const [r, ...p] = location.hash.replace(/^#/, "").split("/").map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  return ROUTES[r] ? { r, p } : { r: "dersler", p: [] };
}

async function route() {
  if (!KEY) return askKey();
  const { r, p } = karma(), R = ROUTES[r];
  if (R.dersli) p[0] = String(p[0] || "").toUpperCase();
  CTX.code = R.dersli ? p[0] : null;
  cubukGuncelle(r);
  const seq = ++navSeq, live = () => seq === navSeq;
  onResize = null; ipucu(null);
  APP.innerHTML = '<div class="card muted">Yükleniyor…</div>';
  try { await R.view(p, live); }
  catch (e) {
    if (e instanceof Yetkisiz || !live()) return;
    APP.innerHTML = `<div class="card"><b>Yüklenemedi:</b> ${esc(e.message)} <a href="#dersler" style="margin-left:8px">Dersler</a></div>`;
  }
}

function cubukGuncelle(r) {
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.r === r || (a.dataset.r === "dersler" && ROUTES[r]?.dersli)));
  const sel = $("#dersSec");
  if (CTX.code && ![...sel.options].some((o) => o.value === CTX.code)) sel.add(new Option(CTX.code, CTX.code));
  sel.value = CTX.code || "";
  $("#csvHam").classList.toggle("hidden", !CTX.code);
  $("#csvUzun").title = CTX.code ? `Uzun biçim CSV: ${CTX.code}` : "Uzun biçim CSV: tüm dersler";
}

async function dersSeciciYukle() {
  try {
    const liste = await aapi("dersler");
    const sel = $("#dersSec");
    sel.innerHTML = '<option value="">Ders seç…</option>' + liste.map((d) =>
      `<option value="${esc(d.code)}">${esc(d.name || d.code)} · ${esc(d.code)}</option>`).join("");
    sel.value = CTX.code || "";
  } catch { /* 403 → anahtar formu zaten açıldı */ }
}

// üst çubuk
$("#gizle").checked = GIZLE;
$("#gizle").onchange = (e) => { GIZLE = e.target.checked; ss.set(GIZLE_K, GIZLE ? "1" : "0"); route(); };
$("#dersSec").onchange = (e) => { if (e.target.value) location.hash = "#ders/" + enc(e.target.value); };
const csvTik = (tur) => () => csvIndir(tur, CTX.code).catch((e) => { if (!(e instanceof Yetkisiz)) toast(e.message); });
$("#csvUzun").onclick = csvTik("uzun");
$("#csvHam").onclick = csvTik("ham");
$("#cikis").onclick = () => { askKey(""); };
addEventListener("hashchange", route);
addEventListener("resize", () => onResize && onResize());

if (KEY) { dersSeciciYukle(); route(); } else askKey();
