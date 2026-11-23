// Yönetim ekranı (araştırmacı paneli). Tek sayfa, adres karmasıyla gezinme.
// Kural: tahmini/eksik veri ölçülmüş gibi gösterilmez. Her ölçünün yanında n; değer yoksa "veri yok" (asla 0).
// Görünüm eklemek için: bir view fonksiyonu yaz, ROUTES tablosuna ekle.
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
async function aapiResp(path, body) {
  let r;
  const headers = { "X-Admin-Key": KEY || "" };
  if (body) headers["Content-Type"] = "application/json";
  try { r = await fetch("/api/admin/" + path, body ? { method: "POST", headers, body: JSON.stringify(body) } : { headers, cache: "no-store" }); }
  catch { throw new Error("Sunucuya ulaşılamadı."); }
  if (r.status === 403) { askKey("Anahtar geçersiz ya da bu bilgisayardan açılmıyor."); throw new Yetkisiz(); }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `İstek başarısız (${r.status})`); }
  return r;
}
const aapi = async (path, body) => (await aapiResp(path, body)).json();
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
const nTag = (n, birim = "") => `<span class="n">${n == null ? "n yok" : `n=${n}${birim ? " " + birim : ""}`}</span>`;
const saatS = (d) => d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
// Önbellekler (_gorsel, _ham, _ogr, _fiks). Bitmemiş derste her girişte o dersin önbelleği silinir (canlı veriyle karışmasın).
function onbellekTemizle(code) {
  for (const m of [_gorsel, _ham, _ogr, _fiks]) for (const k of [...m.keys()]) if (code == null || k === code || k.startsWith(code + "/")) m.delete(k);
}
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
      const sayi = (s) => { if (s === "" || s == null) return null; const v = +s; return Number.isFinite(v) ? v : null; };
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
      const I = ogrenciIvt(rs, (await ogrenciVeri(code, sid)).kurulumlar);
      if (!I) { out.pencereYok.push(sid); continue; }
      for (const f of I.fix) out.list.push({ sid, mid: f.mid, start: f.start, dur: f.dur });
      out.ogrenci.add(sid);
    }
    return out;
  })();
  p.catch(() => _fiks.delete(code));
  _fiks.set(code, p);
  return p;
}
// Tek öğrencinin ham satırlarından (yalnız kalibreli, tam ekran bakışlı) I-VT. fiksasyonlar() ve öğrenci veri grafiği aynı kuralı kullanır.
// Segment: pencere boyutu ya da materyal değişince ya da 250 ms'den uzun boşlukta kesilir (fiksasyon materyal sınırını aşmaz).
// Dönen: { fix: [{mid,start,end,dur}], sac: [{start,end,dur}] | null, sacHz, segs: [[[tm, px, py, mid], …], …] } ya da pencere kaydı yoksa null.
// Fiksasyonlar GazeLab kuralıyla 400 ms'den uzunsa parçalara bölünür: sayı "I-VT parçası" sayısıdır.
// Sakkad (iki fiksasyon arası ≤ maxSacc ms) ancak örnek aralığı yeterince kısaysa ölçülebilir: bir segmentte 2 × medyan aralık > maxSacc ise
// sac = null ("ölçülemez"; ~10 Hz'de I-VT süzgeci hız tepesini 150 ms'den uzun yayar, 0 sakkad ölçüm değil yapı gereğidir).
function ogrenciIvt(rows, kurulumlar) {
  const kur = (kurulumlar || []).map((k) => ({ t: k.t, m: /^(\d+)x(\d+)$/.exec(k.setup?.pencere || "") })).filter((k) => k.m);
  if (!kur.length) return null;
  const boyut = (t) => { let s = kur[0]; for (const k of kur) if (k.t <= t) s = k; return [+s.m[1], +s.m[2]]; };
  const rs = rows.filter((r) => r.cal && Array.isArray(r.gaze) && r.gaze.length).sort((a, b) => a.t - b.t);
  const out = { fix: [], sac: [], sacHz: null, segs: [] }, araliklar = [];
  let olcumsuz = false;
  let seg = [], onceki = null, wh = null;
  const bitir = () => {
    if (seg.length) out.segs.push(seg);
    if (seg.length >= 3) {
      const I = GL.ivt(seg), mid = seg[0][3];
      for (const f of I.fixations) out.fix.push({ mid, start: f.start, end: f.end, dur: f.dur });
      const d = seg.slice(1).map((p, i) => p[0] - seg[i][0]).sort((x, y) => x - y), md = d[d.length >> 1];
      araliklar.push(...d);
      if (2 * md > I.opts.maxSacc) olcumsuz = true;
      // GL.ivt sakkadı: ardışık iki fiksasyon arası, 0 < süre ≤ maxSacc (aynı koşul; sayısı I.saccades ile aynı)
      for (let k = 1; k < I.fixations.length; k++) {
        const a = I.fixations[k - 1], b = I.fixations[k], dur = b.start - a.end;
        if (dur > 0 && dur <= I.opts.maxSacc) out.sac.push({ start: a.end, end: b.start, dur });
      }
    }
    seg = [];
  };
  for (const r of rs) {
    const b = boyut(r.t);
    if (!wh || b[0] !== wh[0] || b[1] !== wh[1] || (seg.length && seg[seg.length - 1][3] !== r.mid)) { bitir(); wh = b; onceki = null; }
    for (const g of r.gaze) {
      const tm = r.t * 1000 + g[0];
      if (onceki != null && (tm - onceki > 250 || tm < onceki)) bitir();
      seg.push([tm, g[1] * wh[0], g[2] * wh[1], r.mid]); onceki = tm;
    }
  }
  bitir();
  if (araliklar.length) { araliklar.sort((x, y) => x - y); const md = araliklar[araliklar.length >> 1]; if (md > 0) out.sacHz = 1000 / md; }
  if (olcumsuz) out.sac = null;
  return out;
}
// Bakış hızı (°/s, tahmin): GL.ivt'nin içindeki hesapla aynı (noiseWin ms medyan süzgeç, piksel × GL.DEG_PER_PX / sn).
function hizSerisi(seg) {
  const n = seg.length, half = GL.IVT_DEFAULTS.noiseWin / 2, fx = [], fy = [];
  const med = (a) => { a.sort((p, q) => p - q); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    while (b < n && seg[b][0] <= seg[i][0] + half) b++;
    while (seg[a][0] < seg[i][0] - half) a++;
    const w = seg.slice(a, b); fx[i] = med(w.map((p) => p[1])); fy[i] = med(w.map((p) => p[2]));
  }
  const out = [];
  for (let i = 1; i < n; i++) {
    const dt = (seg[i][0] - seg[i - 1][0]) / 1000;
    if (dt > 0) out.push([seg[i][0], (Math.hypot(fx[i] - fx[i - 1], fy[i] - fy[i - 1]) * GL.DEG_PER_PX) / dt]);
  }
  return out;
}
const FIKS_PARCA = "Fiksasyon sayısı “I-VT parçası” sayısıdır: GazeLab kuralıyla 400 ms'den uzun fiksasyon eşit parçalara bölünür.";
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
  const an = new Date();
  _esik = esik;
  if (!live()) return;
  if (d.ders.ended == null) onbellekTemizle(d.ders.code);
  const L = d.ders, ad = adlar(d.ogrenciler);
  const t1 = L.ended ?? (d.zaman.length ? d.zaman[d.zaman.length - 1].t + 10 : null);
  const el = {}, sohbet = {};
  for (const o of d.olaylar) {
    if (!o.sid) continue;
    if (o.kind === "hand" && o.data?.up) el[o.sid] = (el[o.sid] || 0) + 1;
    if (o.kind === "chat") sohbet[o.sid] = (sohbet[o.sid] || 0) + 1;
  }
  APP.innerHTML = `
    <div class="head"><div class="muted small"><a href="#dersler">Dersler</a> / ${esc(L.code)}</div>
      <div class="row" style="justify-content:space-between;flex-wrap:wrap"><h1>${esc(L.name || L.code)}</h1>
        <button class="btn sm" id="dCsvHam" title="Bu dersin tüm 2 sn örnekleri (bakış, bölge payları, kurulum dışı)">CSV (ham)</button></div>
      <div class="muted small">${tarih(L.created)} · süre ${t1 != null ? mmss(t1 - L.created) + " (dk:sn)" : "veri yok"}${L.ended == null ? ' · <span class="pill">bitmedi (süre son örneğe göre)</span>' : ""}
        · veri anı: ${saatS(an)} · Konu: ${esc(L.topic || "—")} · ${d.ogrenciler.length} öğrenci · ${d.materyaller.length} materyal</div></div>
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
        <th title="I-VT (GL.ivt), tam ekran bakıştan; derece dönüşümü tahmin">Fiksasyon (I-VT parçası, tahmin)</th><th>Isı haritası</th></tr>
      ${d.materyaller.map((m) => `<tr class="click" data-mat="${m.id}">
        <td>${kindChip(m.kind)}</td><td><a href="#materyal/${enc(L.code)}/${m.id}">${esc(m.name)}</a></td>
        <td class="num">${m.sure_sn ? mmss(m.sure_sn) : '<span class="yok">gösterilmedi</span>'}</td>
        <td class="num">${ol(m.bakma_pct, m.n_bakma, pctF, "öğr.")}</td>
        <td class="num" style="color:${levelColor(m.ort_dikkat)}">${ol(m.ort_dikkat, m.n_ornek, fix1, "örnek")}</td>
        <td>${emoS(m.baskin_duygu)}</td>
        <td class="num" data-fiks="${m.id}"><span class="muted small">hesaplanıyor…</span></td>
        <td><canvas class="mini" data-isi="${m.id}"></canvas></td></tr>`).join("")}
    </table></div>
    ${d.materyaller.length ? "" : '<div class="muted" style="padding:10px 4px">Bu derste materyal tanımlanmamış.</div>'}
    <div class="note">Materyale bakma ve ısı haritası yalnız iyi kalibreli öğrencilerden (materyale bakma n = ortalamaya en az bir örnekle katılan öğrenci). Fiksasyon: sayı · ortalama süre,
      tam ekran bakış örneklerinden I-VT (30°/s, 80–400 ms); piksel→derece dönüşümü tahmindir, konum materyal üzerine eşlenmez. ${FIKS_PARCA}<span id="pYok"></span></div></div>
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
    <div class="note">${esikNotu(esik)}</div></div>`;
  $("#dCsvHam").onclick = () => csvIndir("ham", L.code).catch((e) => { if (!(e instanceof Yetkisiz)) toast(e.message); });

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
    if (F.pencereYok.length) $("#pYok").textContent = ` Pencere boyutu yok: ${F.pencereYok.length} öğrenci (fiksasyona girmedi).`;
  }).catch((e) => { if (!(e instanceof Yetkisiz)) hata("td[data-fiks]"); });
}
function esikNotu(esik) {
  const i = esik.iyi, o = esik.orta;
  return `Kalite notu (yalnız filtre ve uyarı içindir, veri silmez): <b>iyi</b> = kamerada ≥%${i.kamerada}, kalibreli ≥%${i.kalibreli},
    örnekleme ≥${i.hz} Hz ve son kalibrasyon hatası ≤${i.hata} px (hata kaydı yoksa bu koşula bakılmaz); <b>orta</b> = kamerada ≥%${o.kamerada}, kalibreli ≥%${o.kalibreli};
    geri kalanı <b>düşük</b>. Örnekleme: kalibreli 2 sn örneklerdeki tam ekran bakış noktası / saniye.`;
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
  const an = new Date();
  if (!live()) return;
  if (d.ders.ended == null) onbellekTemizle(d.ders.code);
  const m = d.materyaller.find((x) => x.id === id);
  if (!m) { APP.innerHTML = `<div class="card">Materyal bulunamadı. <a href="#ders/${enc(code)}">Derse dön</a></div>`; return; }
  const L = d.ders, ad = adlar(d.ogrenciler);
  APP.innerHTML = `
    <div class="head"><div class="muted small"><a href="#dersler">Dersler</a> / <a href="#ders/${enc(L.code)}">${esc(L.name || L.code)}</a> / materyal</div>
      <h1>${kindChip(m.kind)} ${esc(m.name)}</h1>
      <div class="muted small">veri anı: ${saatS(an)}${L.ended == null ? ' · <span class="pill">bitmedi</span>' : ""}</div></div>
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
      sat("Fiksasyon (I-VT parçası, tahmin)", fx == null ? '<span class="yok">hesaplanamadı</span>' : fx.n ? `${fx.n} · ort. ${fx.ort} ms${nTag(fx.ogr, "öğr.")}` : `${YOK}${nTag(0, "öğr.")}`);
    $("#mNot").innerHTML = `Isı haritası ve bakış ölçüleri yalnız iyi kalibreli örneklerden. ` +
      (dis.length ? `Dışarıda kalan: ${dis.length} örnek (kalibresiz ya da kaba kalibrasyon)${disS.length ? `, ${disS.length} öğrencinin hiç bakış verisi yok` : ""}. ` : "") +
      (img ? "Noktalar görselin içerik alanına eşlenir." : m.hasImage ? "Görsel yüklenemedi; boş 16:9 tuval." : "Bu materyalin görseli yok; boş 16:9 tuval.") +
      " Fiksasyon sayısı tam ekran bakıştan I-VT ile; derece dönüşümü tahmin. " + FIKS_PARCA +
      (F && F.pencereYok.length ? ` Pencere boyutu yok: ${F.pencereYok.length} öğrenci (fiksasyona girmedi).` : "");
  };
  guncelle();
  onResize = guncelle;
  rb.oninput = re.oninput = guncelle;
  $("#mSid").onchange = (e) => { MAT_SEC.sid = e.target.value; guncelle(); };
  APP.querySelectorAll("input[name=mod]").forEach((r) => (r.onchange = () => { MAT_SEC.mod = r.value; guncelle(); }));
}

// ---------------------------------------------------------------- görünüm 4: öğrenci
const OGR = { sekme: "kalite", mid: null, mod: "isi" };
const SEKMELER = [["kalite", "Kalite"], ["grafik", "Veri grafiği"], ["isi", "Isı haritası"], ["kurulum", "Kurulum"], ["olaylar", "Olaylar"]];
const OLAY_AD = { hand: "El", lower_hand: "El indirildi (öğretmen)", chat: "Sohbet", reaction: "Tepki", alert: "Uyarı",
                  topic: "Konu", material: "Materyal", end: "Ders bitti" };
const satir = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;

async function viewOgrenci([code, sid], live) {
  const [d, esik] = await Promise.all([aapi(`ders?code=${enc(code)}`), _esik || aapi("kalite_esik")]);
  _esik = esik;
  if (!live()) return;
  if (d.ders.ended == null) onbellekTemizle(d.ders.code);
  const [o, rows] = await Promise.all([ogrenciVeri(d.ders.code, sid), hamOrnekler(d.ders.code)]);
  const an = new Date();
  if (!live()) return;
  const L = d.ders, ad = adlar(d.ogrenciler), K = o.kalite, pc = o.bilgi.participant_code;
  const mine = rows.filter((r) => r.sid === sid), kal = mine.filter((r) => r.cal);
  const G = {
    L, o, mine, kal, mats: new Map(d.materyaller.map((m) => [m.id, m])), spans: d.spans,
    I: o.bakis.length ? ogrenciIvt(mine, o.kurulumlar) : null,
    rel: (t) => mmss(t - L.created),
  };
  APP.innerHTML = `
    <div class="head"><div class="muted small"><a href="#dersler">Dersler</a> / <a href="#ders/${enc(L.code)}">${esc(L.name || L.code)}</a> / öğrenci</div>
      <h1>${esc(ad(sid))} ${kaliteRozet(K.not)}</h1>
      <div class="muted small">${pc ? "Katılımcı kodu " + esc(pc) : "kodsuz (karşılaştırmada eşleştirmeye girmez)"} · derse giriş ${tarih(o.bilgi.joined)}
        · ${o.ornekler.length} örnek (2 sn) · veri anı: ${saatS(an)}${L.ended == null ? ' · <span class="pill">bitmedi</span>' : ""}</div></div>
    <div class="tabs" role="tablist">${SEKMELER.map(([k, t]) => `<button type="button" data-s="${k}">${t}</button>`).join("")}</div>
    <div id="sekme"></div>`;
  const ac = (k) => {
    OGR.sekme = k; onResize = null; ipucu(null);
    APP.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.s === k));
    ({ kalite: sekmeKalite, grafik: sekmeGrafik, isi: sekmeIsi, kurulum: sekmeKurulum, olaylar: sekmeOlaylar })[k]($("#sekme"), G, esik, live);
  };
  APP.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => ac(b.dataset.s)));
  ac(SEKMELER.some(([k]) => k === OGR.sekme) ? OGR.sekme : "kalite");
}

function sekmeKalite(el, G, esik) {
  const { o, kal } = G, K = o.kalite, n = o.ornekler.length;
  const ic = o.bakis.filter((p) => p[1] >= 0 && p[1] <= 1 && p[2] >= 0 && p[2] <= 1).length;
  const kalRows = o.kalibrasyonlar;
  el.innerHTML = `
    <div class="card"><h3>Kalite</h3><dl class="ozet ozet-gen">
      ${satir("Kalite notu", kaliteRozet(K.not) + (K.kal_hata == null ? ' <span class="yok">kalibrasyon hatası: veri yok</span>' : ""))}
      ${satir("Kamerada görünme", ol(K.kamerada_pct, n, pctF, "örnek"))}
      ${satir("Kalibreli zaman", ol(K.kalibreli_pct, n, pctF, "örnek"))}
      ${satir("Bakış pencere içinde", ol(o.bakis.length ? Math.round((100 * ic) / o.bakis.length) : null, o.bakis.length, pctF, "nokta"))}
      ${satir("Örnekleme", ol(K.hz, kal.length, (v) => fix1(v) + " Hz", "kalibreli örnek"))}
      ${satir("Son kalibrasyon hatası", val(K.kal_hata, (v) => Math.round(v) + " px"))}
      ${satir("Kalibrasyon sayısı", String(kalRows.length))}
      ${satir("Baş uyarıları", YOK)}
    </dl>
    <div class="note">${esikNotu(esik)}${K.kal_hata == null && K.not === "iyi" ? " <b>Bu öğrencide kalibrasyon hatası kaydı yok; “iyi” notu hata koşuluna bakılmadan verildi.</b>" : ""}
      Bakış pencere içinde: iyi kalibreli örneklerdeki tam ekran bakış noktalarından pencere sınırı (0–1) içinde kalanların payı.
      Baş uyarıları bu sürümde derse kaydedilmiyor.</div></div>
    <div class="card"><h3>Kalibrasyonlar</h3>${kalRows.length ? `<div class="tbl"><table>
      <tr><th>Zaman</th><th>Hata</th><th>Titreme</th><th>3×3 isabet</th><th title="55 cm uzaklık ve 96 dpi varsayımıyla">Derece (tahmin)</th><th>Durum</th><th>Yöntem</th><th>Kamera</th></tr>
      ${kalRows.map((k) => { const r = k.report && typeof k.report === "object" ? k.report : {}; const num = (v) => (typeof v === "number" ? v : null);
        return `<tr><td class="num">${G.rel(k.t)}</td><td class="num">${val(num(r.acc), (v) => Math.round(v) + " px")}</td>
          <td class="num">${val(num(r.prec), (v) => Math.round(v) + " px")}</td><td class="num">${val(num(r.hit3), pctF)}</td>
          <td class="num">${val(num(r.deg), (v) => "~" + fix1(v) + "°")}</td>
          <td>${r.coarse === true ? '<span class="pill" style="color:var(--bad)">kaba — bakış kaydedilmez</span>' : r.coarse === false ? '<span class="pill" style="color:var(--good)">iyi</span>' : YOK}</td>
          <td>${r.yontem ? esc(r.yontem) : YOK}</td><td>${r.kamera ? esc(r.kamera) : YOK}</td></tr>`; }).join("")}
    </table></div>` : `<p>${YOK} <span class="muted small">— kalibrasyon kaydı yok; bu öğrencinin bakış ölçüleri hesaplanmaz.</span></p>`}
    <div class="note">Zaman: ders başından (dk:sn). Hata: kalibrasyon sonrası ölçülen ortalama/medyan uzaklık (px). Derece değerleri tahmindir.</div></div>`;
}

// --- veri grafiği
const GR_PANEL = [["xy", 130], ["hiz", 80], ["fs", 16], ["mat", 16], ["att", 100], ["emo", 14]];
const GR_PAD = { l: 100, r: 12, t: 8, b: 22 }, GR_ARA = 10;
const GR_RENK = { x: "#0f9d8a", y: "#a855f7", hiz: "#3b4252", fix: "#1f9d55", sac: "#d64545" };
function grafikVeri(G) {
  const { o, I } = G;
  const ts = o.ornekler.map((r) => r[0]);
  const lo = [], hi = [];
  if (ts.length) { lo.push(ts[0] - 2); hi.push(ts[ts.length - 1]); }
  if (o.bakis.length) { lo.push(o.bakis[0][0] / 1000); hi.push(o.bakis[o.bakis.length - 1][0] / 1000); }
  if (!lo.length) return null;
  const tA = Math.min(...lo), tB = Math.max(...hi, tA + 10);
  const hiz = I ? I.segs.map(hizSerisi) : null;
  let vmax = 100;
  if (hiz) {
    const v = hiz.flat().map((p) => p[1]).sort((a, b) => a - b);
    if (v.length) vmax = Math.min(1000, Math.max(60, Math.ceil((v[Math.floor(v.length * 0.95)] * 1.3) / 50) * 50));
  }
  return { tA, tB, hiz, vmax };
}
function cizGrafik(canvas, G, V, sel) {
  const T = tuval(canvas); if (!T) return;
  const { ctx, w, h } = T, { o, I } = G, P = GR_PAD;
  const iw = w - P.l - P.r, X = (s) => P.l + ((s - V.tA) / (V.tB - V.tA)) * iw;
  const muted = cssVar("var(--muted)"), border = cssVar("var(--border)");
  ctx.font = "11px system-ui, sans-serif"; ctx.lineJoin = "round";
  const kutu = {}; let y = P.t;
  for (const [k, hh] of GR_PANEL) { kutu[k] = { y, h: hh }; y += hh + GR_ARA; }
  const yaz = (s, x, yy, c = muted) => { ctx.fillStyle = c; ctx.fillText(s, x, yy); };
  const sag = (s, yy, c = muted) => { ctx.textAlign = "right"; yaz(s, P.l - 4, yy, c); ctx.textAlign = "start"; };   // eksen değeri
  const yok = (k, s) => { const b = kutu[k]; ctx.fillStyle = muted; ctx.font = "italic 12px system-ui, sans-serif"; ctx.fillText(s, P.l + 8, b.y + b.h / 2 + 4); ctx.font = "11px system-ui, sans-serif"; };
  const cizgi = (pts, Y, kes, col, lw = 1.3) => {
    ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
    let onceki = null;
    for (const [s, v] of pts) { const x = X(s), yy = Y(v); onceki != null && s - onceki <= kes ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); onceki = s; }
    ctx.stroke();
  };
  // seçim (arkada)
  if (sel) { ctx.fillStyle = "rgba(47,111,219,.10)"; ctx.fillRect(X(sel[0]), P.t, X(sel[1]) - X(sel[0]), y - GR_ARA - P.t); }
  // X / Y (%)
  let b = kutu.xy; const bxy = b, Yxy = (v) => bxy.y + bxy.h * (1 - (Math.min(120, Math.max(-20, v)) + 20) / 140);
  ctx.strokeStyle = border; ctx.lineWidth = 1;
  for (const v of [0, 50, 100]) { const yy = Yxy(v); ctx.beginPath(); ctx.moveTo(P.l, yy); ctx.lineTo(w - P.r, yy); ctx.stroke(); sag("%" + v, yy + 4); }
  yaz("X / Y (%)", 4, b.y + 12);
  if (o.bakis.length) {
    cizgi(o.bakis.map((p) => [p[0] / 1000, p[1] * 100]), Yxy, 0.25, GR_RENK.x);
    cizgi(o.bakis.map((p) => [p[0] / 1000, p[2] * 100]), Yxy, 0.25, GR_RENK.y);
  } else yok("xy", "veri yok — iyi kalibreli bakış örneği yok");
  // hız
  b = kutu.hiz; const bv = b, Yv = (v) => bv.y + bv.h * (1 - Math.min(v, V.vmax) / V.vmax);
  ctx.strokeStyle = border; ctx.beginPath(); ctx.moveTo(P.l, b.y + b.h); ctx.lineTo(w - P.r, b.y + b.h); ctx.stroke();
  yaz("Hız °/s", 4, b.y + 12); yaz("(tahmin)", 4, b.y + 25); sag(String(V.vmax), b.y + 10);
  if (V.hiz) {
    for (const s of V.hiz) cizgi(s.map(([tm, v]) => [tm / 1000, v]), Yv, 0.25, GR_RENK.hiz);
    const thr = GL.IVT_DEFAULTS.velThr;
    if (thr < V.vmax) { ctx.strokeStyle = GR_RENK.sac; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(P.l, Yv(thr)); ctx.lineTo(w - P.r, Yv(thr)); ctx.stroke(); ctx.setLineDash([]); sag(thr + " eşik", Yv(thr) + 4, GR_RENK.sac); }
  } else yok("hiz", o.bakis.length ? "veri yok — pencere boyutu kaydı yok" : "veri yok");
  // fiksasyon / sakkad şeridi
  b = kutu.fs; yaz(I && !I.sac ? "Fiksasyon" : "Fiks./sakkad", 4, b.y + 12);
  ctx.fillStyle = cssVar("var(--surface-2)"); ctx.fillRect(P.l, b.y, iw, b.h);
  if (I) {
    ctx.fillStyle = GR_RENK.fix; for (const f of I.fix) ctx.fillRect(X(f.start / 1000), b.y, Math.max(1, X(f.end / 1000) - X(f.start / 1000)), b.h);
    if (I.sac) { ctx.fillStyle = GR_RENK.sac; for (const s of I.sac) ctx.fillRect(X(s.start / 1000), b.y + 3, Math.max(1, X(s.end / 1000) - X(s.start / 1000)), b.h - 6); }
    else { ctx.textAlign = "right"; ctx.fillStyle = "rgba(0,0,0,.6)"; const tx = "sakkad: ölçülemez", tw = ctx.measureText(tx).width;
      ctx.fillRect(w - P.r - tw - 10, b.y + 1, tw + 8, b.h - 2); yaz(tx, w - P.r - 6, b.y + 12, "#fff"); ctx.textAlign = "start"; }
  } else yok("fs", "veri yok");
  // materyal şeridi
  b = kutu.mat; yaz("Materyal", 4, b.y + 12);
  ctx.fillStyle = cssVar("var(--surface-2)"); ctx.fillRect(P.l, b.y, iw, b.h);
  for (const s of G.spans) {
    const a = Math.max(s.t_start, V.tA), e = Math.min(s.t_end ?? V.tB, V.tB); if (e <= a) continue;
    const m = G.mats.get(s.material_id);
    ctx.fillStyle = kindOf(m?.kind).color; ctx.fillRect(X(a), b.y, X(e) - X(a), b.h);
    ctx.save(); ctx.beginPath(); ctx.rect(X(a), b.y, X(e) - X(a), b.h); ctx.clip(); yaz(m ? m.name : "?", X(a) + 4, b.y + 12, "#fff"); ctx.restore();
  }
  // dikkat / enerji
  b = kutu.att; const ba = b, Ya = (v) => ba.y + ba.h * (1 - v / 100);
  ctx.strokeStyle = border; ctx.lineWidth = 1;
  for (const v of [0, 50, 100]) { const yy = Ya(v); ctx.beginPath(); ctx.moveTo(P.l, yy); ctx.lineTo(w - P.r, yy); ctx.stroke(); sag(String(v), yy + 4); }
  yaz("Dikkat", 4, b.y + 12, cssVar("var(--c-att)")); yaz("Enerji", 4, b.y + 25, cssVar("var(--c-en)"));
  for (const [i, c] of [[1, "var(--c-att)"], [2, "var(--c-en)"]]) {
    const pts = o.ornekler.filter((r) => r[i] != null).map((r) => [r[0] - 1, r[i]]);
    cizgi(pts, Ya, 4.5, cssVar(c), 2);
  }
  // duygu
  b = kutu.emo; yaz("Duygu", 4, b.y + 11);
  for (const r of o.ornekler) {
    if (!r[3]) continue;
    ctx.fillStyle = EMO[r[3]] ? cssVar(EMO[r[3]].color) : "#999"; ctx.fillRect(X(r[0] - 2), b.y, Math.max(1, X(r[0]) - X(r[0] - 2)), b.h);
  }
  // zaman ekseni
  const yb = y - GR_ARA;
  for (let i = 0; i <= 6; i++) {
    const s = V.tA + ((V.tB - V.tA) * i) / 6, str = G.rel(s), tw = ctx.measureText(str).width;
    yaz(str, Math.min(Math.max(X(s) - tw / 2, P.l), w - P.r - tw), yb + 16);
  }
  if (sel) { ctx.strokeStyle = "#2f6fdb"; ctx.lineWidth = 1; for (const s of sel) { ctx.beginPath(); ctx.moveTo(X(s), P.t); ctx.lineTo(X(s), yb); ctx.stroke(); } }
  canvas._g = { iw, tA: V.tA, tB: V.tB };
}
const ayristirSure = (s) => {
  s = String(s).trim(); let m;
  if ((m = /^(\d+):([0-5]?\d)$/.exec(s))) return +m[1] * 60 + +m[2];
  return /^\d+(\.\d+)?$/.test(s) ? +s : null;
};
function sekmeGrafik(el, G, _e, live) {
  const V = grafikVeri(G);
  if (!V) { el.innerHTML = `<div class="card">${YOK} <span class="muted small">— bu öğrencinin hiç örneği yok.</span></div>`; return; }
  const { o, I, L } = G;
  el.innerHTML = `<div class="card">
    <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px"><h3 style="margin:0">Veri grafiği</h3>
      <div class="legend"><span style="--c:${GR_RENK.x}">X (pencerenin %'si)</span><span style="--c:${GR_RENK.y}">Y (pencerenin %'si)</span>
        <span style="--c:${GR_RENK.hiz}">Hız (tahmin)</span><span style="--c:${GR_RENK.fix}">Fiksasyon</span><span style="--c:${GR_RENK.sac}">Sakkad</span>
        ${Object.values(KIND).map((k) => `<span style="--c:${k.color}">${k.label}</span>`).join("")}</div></div>
    <canvas id="og" class="og"></canvas>
    <div class="legend" style="margin-top:6px">Duygu: ${Object.values(EMO).map((e) => `<span style="--c:${e.color}">${e.label}</span>`).join("")}</div>
    <form class="secim" id="secF"><span class="muted small">Zaman aralığı (ders başından dk:sn; grafikte sürükleyerek de seçilir)</span>
      <label>Başlangıç <input id="sA" size="6" placeholder="0:00"></label><label>Bitiş <input id="sB" size="6" placeholder="0:00"></label>
      <button class="btn sm primary">Uygula</button><button class="btn sm" type="button" id="sTum">Tümü</button><span class="error" id="sErr"></span></form>
    <dl class="ozet ozet-gen" id="sOz"></dl>
    <div class="note">X/Y: tam ekran bakış, pencereye göre (0–100; pencere dışı −20…120 kırpılı), yalnız iyi kalibreli örnekler. Hız ve fiksasyon/sakkad:
      I-VT (GL.ivt: ${GL.IVT_DEFAULTS.velThr}°/s, ${GL.IVT_DEFAULTS.minFix}–${GL.IVT_DEFAULTS.maxFix} ms), piksel = pencere oranı × kurulumdaki pencere boyutu,
      derece = piksel × ${GL.DEG_PER_PX} (varsayım) → <b>tahmin</b>; hız ekseninin üstü kırpılı (${V.vmax}°/s).
      ${FIKS_PARCA} Aralık özeti: fiksasyon/sakkad başlangıcı aralıktaysa tüm süresi sayılır.
      ${I && !I.sac ? `Sakkad ölçülemez: örnekleme ~${I.sacHz ? Math.round(I.sacHz) : "?"} Hz; I-VT sakkad koşulu (≤${GL.IVT_DEFAULTS.maxSacc} ms) için ≥~${fix1(2000 / GL.IVT_DEFAULTS.maxSacc)} Hz gerekir.` : ""} Materyal şeridi: öğretmenin “şimdi bu” kayıtları. Dikkat/enerji/duygu: 2 sn örnekler.</div></div>`;
  const cv = $("#og");
  const sacYok = () => `<span class="yok">ölçülemez</span> <span class="muted small">— örnekleme ~${I.sacHz ? Math.round(I.sacHz) : "?"} Hz; I-VT sakkad koşulu (≤${GL.IVT_DEFAULTS.maxSacc} ms) için ≥~${fix1(2000 / GL.IVT_DEFAULTS.maxSacc)} Hz gerekir</span>`;
  let sel = null;
  const ciz = () => cizGrafik(cv, G, V, sel);
  const ozet = () => {
    const [a, b] = sel || [V.tA, V.tB];
    $("#sA").value = G.rel(a); $("#sB").value = G.rel(b);
    const ic = (ms) => ms / 1000 >= a && ms / 1000 <= b;
    const nokta = o.bakis.filter((p) => ic(p[0])).length;
    const orn = o.ornekler.filter((r) => r[0] >= a && r[0] <= b);
    let fx = YOK, ort = YOK, sk = YOK;
    if (I) {
      const F = I.fix.filter((f) => ic(f.start)), S = I.sac ? I.sac.filter((s) => ic(s.start)) : null;
      fx = `${F.length}${nTag(nokta, "nokta")}`;
      ort = F.length ? `${Math.round(F.reduce((x, f) => x + f.dur, 0) / F.length)} ms${nTag(F.length, "fiks.")}` : `${YOK}${nTag(0, "fiks.")}`;
      sk = S ? `${S.length}${nTag(nokta, "nokta")}` : sacYok();
    }
    $("#sOz").innerHTML =
      satir("Aralık", `${G.rel(a)} – ${G.rel(b)} (${mmss(b - a)})`) +
      satir("Fiksasyon (I-VT parçası, tahmin)", fx) + satir("Ort. fiksasyon süresi (tahmin)", ort) + satir("Sakkad sayısı (tahmin)", sk) +
      satir("Bakış noktası", nokta ? String(nokta) : YOK) +
      satir("Ort. dikkat", ol(ortalama(orn.map((r) => r[1])), orn.filter((r) => r[1] != null).length, fix1, "örnek")) +
      satir("Ort. enerji", ol(ortalama(orn.map((r) => r[2])), orn.filter((r) => r[2] != null).length, fix1, "örnek")) +
      satir("Baskın duygu", `${emoS(baskin(orn.map((r) => r[3])))}${nTag(orn.filter((r) => r[3]).length, "örnek")}`) +
      (I || !o.bakis.length ? "" : satir("Not", '<span class="yok">pencere boyutu kaydı yok: fiksasyon hesaplanamadı</span>'));
  };
  ciz(); ozet(); onResize = ciz;
  const sAt = (ev) => { const g = cv._g || { iw: 1, tA: V.tA, tB: V.tB }; return Math.min(V.tB, Math.max(V.tA, g.tA + ((ev.offsetX - GR_PAD.l) / g.iw) * (g.tB - g.tA))); };
  let surukle = null, bekle = false;
  cv.onmousedown = (ev) => { surukle = sAt(ev); };
  cv.onmousemove = (ev) => {
    if (surukle == null || bekle) return;
    const s = sAt(ev); sel = [Math.min(surukle, s), Math.max(surukle, s)];
    bekle = true; requestAnimationFrame(() => { bekle = false; if (live()) ciz(); });
  };
  const birak = (ev) => {
    if (surukle == null) return;
    const s = sAt(ev);
    sel = Math.abs(s - surukle) < ((V.tB - V.tA) / (cv._g?.iw || 1)) * 3 ? null : [Math.min(surukle, s), Math.max(surukle, s)];
    surukle = null; ciz(); ozet();
  };
  cv.onmouseup = birak; cv.onmouseleave = birak;
  $("#sTum").onclick = () => { sel = null; $("#sErr").textContent = ""; ciz(); ozet(); };
  $("#secF").onsubmit = (e) => {
    e.preventDefault();
    const a = ayristirSure($("#sA").value), b = ayristirSure($("#sB").value);
    if (a == null || b == null || b <= a) { $("#sErr").textContent = "dk:sn biçiminde, bitiş başlangıçtan sonra olmalı"; return; }
    $("#sErr").textContent = "";
    sel = [Math.max(V.tA, L.created + a), Math.min(V.tB, L.created + b)];
    if (sel[1] <= sel[0]) sel = null;
    ciz(); ozet();
  };
}

function sekmeIsi(el, G, _e, live) {
  const { L, mine } = G, mats = [...G.mats.values()];
  if (!mats.length) { el.innerHTML = `<div class="card">${YOK} <span class="muted small">— bu derste materyal yok.</span></div>`; return; }
  const sayi = (id) => mine.filter((r) => r.mid === id).length;
  if (!G.mats.has(OGR.mid)) OGR.mid = (mats.find((m) => sayi(m.id)) || mats[0]).id;
  el.innerHTML = `<div class="mat-grid"><div class="card">
      <div class="opts"><label>Materyal <select id="oMat">${mats.map((m) => `<option value="${m.id}">${esc(kindOf(m.kind).label + ": " + m.name)} (${sayi(m.id)} örnek)</option>`).join("")}</select></label>
        <span><label><input type="radio" name="omod" value="isi"> Isı haritası</label><label><input type="radio" name="omod" value="sis"> Sis</label></span></div>
      <canvas id="oBig" class="big"></canvas><div class="note" id="oNot"></div></div>
    <div class="card"><h3>Özet</h3><dl class="ozet" id="oOz"></dl></div></div>`;
  $("#oMat").value = OGR.mid;
  APP.querySelector(`input[name=omod][value=${OGR.mod}]`).checked = true;
  const ciz = async () => {
    const m = G.mats.get(OGR.mid), rs = mine.filter((r) => r.mid === m.id), kal = rs.filter((r) => r.cal);
    const I = isiIzgara(kal), img = await gorselYukle(L.code, m);
    if (!live() || OGR.mid !== m.id || !$("#oBig")) return;
    cizMateryal($("#oBig"), { grid: I.grid, img, mod: OGR.mod });
    const bk = bakmaPct(rs);
    $("#oOz").innerHTML = satir("2 sn örnek", `${rs.length}${nTag(kal.length, "kalibreli")}`) +
      satir("Isı haritası noktası", I.nokta ? String(I.nokta) : YOK) + satir("Materyale bakma", ol(bk.v, bk.n, pctF, "örnek")) +
      satir("Ekranda kalma (tüm ders)", m.sure_sn ? mmss(m.sure_sn) : '<span class="yok">gösterilmedi</span>');
    $("#oNot").textContent = (rs.length && !kal.length ? "Bu materyalde öğrencinin iyi kalibreli örneği yok: bakış verisi yok. " : !rs.length ? "Öğrencinin bu materyal sırasında örneği yok. " : "") +
      "Yalnız iyi kalibreli örneklerin materyal üzerindeki noktaları; noktalar görselin içerik alanına eşlenir.";
  };
  ciz(); onResize = ciz;
  $("#oMat").onchange = (e) => { OGR.mid = +e.target.value; ciz(); };
  APP.querySelectorAll("input[name=omod]").forEach((r) => (r.onchange = () => { OGR.mod = r.value; ciz(); }));
}

const KUR_ALAN = [["kamera", "Kamera"], ["fps", "Kamera fps"], ["ekran", "Ekran"], ["pencere", "Pencere"], ["dpr", "DPR"], ["fs", "Tam ekran"],
                  ["tarayici", "Tarayıcı"], ["uzaklikCm", "Uzaklık (tahmin)"], ["islemeFps", "İşleme fps"]];
function sekmeKurulum(el, G) {
  const k = G.o.kurulumlar;
  const bic = (a, v) => (v == null || v === "" ? YOK : a === "fs" ? (v ? "evet" : "hayır") : a === "uzaklikCm" ? `~${esc(v)} cm` : esc(v));
  el.innerHTML = `<div class="card"><h3>Kurulum (zaman içinde)</h3>${k.length ? `<div class="tbl"><table>
      <tr><th>Zaman</th>${KUR_ALAN.map(([, t]) => `<th>${t}</th>`).join("")}</tr>
      ${k.map((r, i) => { const s = r.setup || {}, p = i ? k[i - 1].setup || {} : null;
        return `<tr><td class="num">${G.rel(r.t)}</td>${KUR_ALAN.map(([a]) => `<td class="num${p && JSON.stringify(p[a]) !== JSON.stringify(s[a]) ? " degisti" : ""}">${bic(a, s[a])}</td>`).join("")}</tr>`; }).join("")}
    </table></div>` : `<p>${YOK} <span class="muted small">— kurulum kaydı yok.</span></p>`}
    <div class="note">Her satır bir değişiklik (aynı kurulum tekrar yazılmaz); değişen hücre vurgulu. Uzaklık: MediaPipe yüz ölçüsünden tahmin.
      İşleme fps 5'in katına yuvarlı. Cihaz türü kaydedilmiyor.</div></div>`;
}

function sekmeOlaylar(el, G) {
  const ay = (e) => {
    const d = e.data;
    if (e.kind === "hand") return d?.up ? "kaldırdı" : "indirdi";
    if (e.kind === "chat") return esc(d?.text ?? "");
    if (e.kind === "reaction") return esc(d?.emoji ?? "");
    return d == null ? "" : `<code>${esc(JSON.stringify(d))}</code>`;
  };
  const ev = G.o.olaylar;
  el.innerHTML = `<div class="card"><h3>Olaylar (ham)</h3>${ev.length ? `<div class="tbl"><table>
      <tr><th>Zaman</th><th>Tür</th><th>Ayrıntı</th></tr>
      ${ev.map((e) => `<tr><td class="num">${G.rel(e.t)}</td><td>${esc(OLAY_AD[e.kind] || e.kind)}</td><td>${ay(e)}</td></tr>`).join("")}
    </table></div>` : `<p>${YOK} <span class="muted small">— bu öğrenciye ait olay yok.</span></p>`}
    <div class="note">Yalnız bu öğrenciye ait olaylar; sınıf geneli olaylar (konu, materyal, uyarı, bitiş) ders sayfasındaki zaman çizelgesinde.</div></div>`;
}

// ---------------------------------------------------------------- görünüm 5: karşılaştırma (insan / YZ)
const KARS = { secili: null };   // null = tüm dersler
async function viewKarsilastirma(_p, live) {
  const liste = await aapi("dersler");
  if (!live()) return;
  const kodlar = liste.map((d) => d.code);
  if (KARS.secili) KARS.secili = KARS.secili.filter((c) => kodlar.includes(c));
  const secili = KARS.secili ?? kodlar;
  const r = secili.length ? await aapi("karsilastirma?dersler=" + enc(secili.join(","))) : null;
  if (!live()) return;
  // grup değerleri ders × öğrenci başına ortalama (yonetim._grup_ozet); birim: tür tablosunda ders × öğrenci, eşleşik hücrede ders
  const hucre = (g, b = "ders×öğr.") => `<td class="num">${ol(g.bakma_pct, g.n_bakma, pctF, b)}</td>
    <td class="num" style="color:${levelColor(g.ort_dikkat)}">${ol(g.ort_dikkat, g.n_dikkat, fix1, b)}</td><td class="num">${ol(g.ort_enerji, g.n_enerji, fix1, b)}</td>`;
  const duyguS = (g) => (g.baskin_duygu == null ? `${YOK}${nTag(0, "ders×öğr.")}` : `${emoS(g.baskin_duygu)}${nTag(g.n_duygu, "ders×öğr.")}<br><span class="muted small">${
    Object.entries(g.duygu_pct || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${esc(EMO[k] ? EMO[k].label : k)} %${v}`).join(" · ")}</span>`);
  const fark = (a, b, f) => (a == null || b == null ? YOK : f(b - a));
  const isaretli = (v, f = String) => (v > 0 ? "+" : "") + f(v);
  APP.innerHTML = `
    <div class="head"><h1>Karşılaştırma — insan / YZ materyali</h1>
      <div class="muted small">Seçili dersler boyunca, örnekler o an ekrandaki materyalin türüne göre gruplanır (materyalsiz örnekler girmez).</div></div>
    <form class="card" id="kF"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0">Dersler (${secili.length}/${liste.length})</h3>
        <div class="row"><button type="button" class="btn sm" id="kHep">Hepsi</button><button type="button" class="btn sm" id="kHic">Hiçbiri</button><button class="btn sm primary">Uygula</button></div></div>
      <div class="kdersler">${liste.map((d) => `<label><input type="checkbox" value="${esc(d.code)}"${secili.includes(d.code) ? " checked" : ""}>
        ${esc(d.name || d.code)} <span class="muted small">${esc(d.code)} · ${tarih(d.created)}</span></label>`).join("") || '<span class="muted">Kayıtlı ders yok.</span>'}</div></form>
    ${!r ? `<div class="card">${YOK} <span class="muted small">— ders seçilmedi.</span></div>` : `
    <div class="card"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><h3 style="margin:0">Materyal türüne göre</h3>
        <button class="btn sm" id="kCsv" title="Uzun biçim: ders × öğrenci × materyal × ölçü">${secili.length === 1 ? `CSV (uzun) — ${esc(secili[0])}` : "CSV (uzun) — tüm dersler"}</button></div>
      <div class="tbl"><table><tr><th>Tür</th><th title="Kalibreli öğrencilerin bakışının materyal bölgesindeki payı">Materyale bakma</th><th>Ort. dikkat</th><th>Ort. enerji</th><th>Duygu (baskın · dağılım)</th><th>Ders × öğrenci</th><th title="İkincil bilgi; ortalamalar örnek ağırlıklı değildir">2 sn örnek</th></tr>
        ${["insan", "yz", "diger"].map((k) => { const g = r.tur[k]; return `<tr><td>${kindChip(k)}</td>${hucre(g)}<td>${duyguS(g)}</td><td class="num">${g.n_ogrenci}</td><td class="num muted">${g.n_ornek}</td></tr>`; }).join("")}
      </table></div>
      <div class="note">Her değer <b>öğrenci başına</b> hesaplanır: önce her ders × öğrenci için kendi ortalaması (o türdeki örneklerinden), sonra bunların ortalaması
        (çok örneği olan öğrenci ağır basmaz). n = o ölçüye değer veren ders × öğrenci sayısı; 2 sn örnek yalnız ikincil bilgidir.
        Materyale bakma yalnız iyi kalibreli örneklerden. Duygu dağılımı: her öğrencinin duygu payları, öğrenciler üzerinden ortalama.
        Fiksasyon türe göre bu tabloda yok (ders/materyal sayfalarında, tahmin).
        ${secili.length > 1 && secili.length < liste.length ? "CSV yalnız tek ders ya da tüm dersler için alınabilir; seçim CSV'ye uygulanmaz." : ""}</div></div>
    <div class="card"><h3>Eşleştirilmiş katılımcılar (aynı kişi hem insan hem YZ materyali gördü)</h3>
      ${r.eslesik.length ? `<div class="tbl"><table>
        <tr><th>Katılımcı</th><th>İnsan: bakma</th><th>İnsan: dikkat</th><th>İnsan: enerji</th><th>YZ: bakma</th><th>YZ: dikkat</th><th>YZ: enerji</th>
          <th>Fark (YZ − insan): bakma</th><th>Fark: dikkat</th><th>Fark: enerji</th></tr>
        ${r.eslesik.map((e) => `<tr><td><b>${esc(e.katilimci)}</b></td>${hucre(e.insan, "ders")}${hucre(e.yz, "ders")}
          <td class="num">${fark(e.insan.bakma_pct, e.yz.bakma_pct, (v) => isaretli(v) + " puan")}</td>
          <td class="num">${fark(e.insan.ort_dikkat, e.yz.ort_dikkat, (v) => isaretli(Math.round(v * 10) / 10, fix1))}</td>
          <td class="num">${fark(e.insan.ort_enerji, e.yz.ort_enerji, (v) => isaretli(Math.round(v * 10) / 10, fix1))}</td></tr>`).join("")}
      </table></div>` : `<p>${YOK} <span class="muted small">— seçili derslerde hem insan hem YZ materyali görmüş kodlu katılımcı yok.</span></p>`}
      <div class="note">Eşleştirme katılımcı koduna göre, dersler arası. Kodsuz öğrenci (ders × öğrenci): <b>${r.kodsuz_n}</b> — eşleştirmeye girmedi.
        Hücre değeri: katılımcının o türdeki ders değerlerinin ortalaması (n = ders). Fark yalnız iki değer de varsa hesaplanır.</div></div>`}`;
  const kutular = () => [...APP.querySelectorAll(".kdersler input")];
  $("#kHep").onclick = () => kutular().forEach((c) => (c.checked = true));
  $("#kHic").onclick = () => kutular().forEach((c) => (c.checked = false));
  $("#kF").onsubmit = (e) => {
    e.preventDefault();
    const s = kutular().filter((c) => c.checked).map((c) => c.value);
    KARS.secili = s.length === kodlar.length ? null : s;
    route();
  };
  if (r) $("#kCsv").onclick = () => csvIndir("uzun", secili.length === 1 ? secili[0] : null).catch((e) => { if (!(e instanceof Yetkisiz)) toast(e.message); });
}

// ---------------------------------------------------------------- katılımcılar
async function viewKatilimcilar(_p, live) {
  const liste = await aapi("katilimcilar");
  if (!live()) return;
  APP.innerHTML = `
    <div class="head"><h1>Katılımcılar</h1><div class="muted small">Kalıcı katılımcı kodları. Öğrenci derse girerken adının yanında bu kodu yazar; kod dersler arasında aynı kalır.</div></div>
    <form class="card filters" id="kpF"><div class="grow"><label for="kpKod">Yeni kod</label><input id="kpKod" maxlength="20" placeholder="ör. P03" autocomplete="off" required></div>
      <div><button class="btn primary">Ekle</button></div><div class="error" id="kpErr" style="flex-basis:100%"></div></form>
    <div class="card"><h3>Kodlar (${liste.length})</h3>${liste.length ? `<div class="tbl"><table><tr><th>Kod</th><th>Oluşturma</th></tr>
      ${liste.map((p) => `<tr><td><b>${esc(p.code)}</b></td><td class="num">${tarih(p.created)}</td></tr>`).join("")}</table></div>`
      : '<p class="muted">Henüz katılımcı kodu yok.</p>'}
      <div class="note">Biçim: A–Z, 0–9, _ ve - (1–20 karakter); küçük harf büyüğe çevrilir. Aynı kod ikinci kez eklenmez.</div></div>`;
  $("#kpKod").focus();
  $("#kpF").onsubmit = async (e) => {
    e.preventDefault();
    const kod = $("#kpKod").value.trim();
    if (!kod) return;
    try {
      const r = await aapi("katilimci", { kod });
      toast(liste.some((p) => p.code === r.kod) ? `${r.kod} zaten vardı` : `${r.kod} eklendi`);
      route();
    } catch (err) { if (!(err instanceof Yetkisiz)) $("#kpErr").textContent = err.message; }
  };
}

// ---------------------------------------------------------------- yönlendirme
// karma: #<rota>/<parametreler…>; parametreler URL-kodlu. Ders kodu içeren rotalar: ilk parametre = ders kodu.
const ROUTES = {
  dersler: { view: viewDersler },
  ders: { view: viewDers, dersli: true },
  materyal: { view: viewMateryal, dersli: true },
  ogrenci: { view: viewOgrenci, dersli: true },
  karsilastirma: { view: viewKarsilastirma },
  katilimcilar: { view: viewKatilimcilar },
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
$("#cikis").onclick = () => { onbellekTemizle(null); _esik = null; askKey(""); };
addEventListener("hashchange", route);
addEventListener("resize", () => onResize && onResize());

if (KEY) { dersSeciciYukle(); route(); } else askKey();
