/* vision.js — Harf taşı tanıma motoru (bağımlılıksız, tarayıcıda çalışır)
 *
 * Akış: kamera karesi → renk etiketleme (mavi/kırmızı taş) → bağlı bileşenler →
 *       her taşın içindeki açık renkli harf (taş maskesindeki "delikler") →
 *       ağırlık merkezi + yarıçapa göre ölçek normalleştirme → ±açı taraması →
 *       şablonlarla normalize çapraz korelasyon → en iyi harf.
 * Takipçi: kareler arası aynı taşı izler, birkaç kare kararlı görülünce tek bir
 *          "yeni harf" olayı üretir.
 */
(function (g) {
  'use strict';

  const HARFLER = 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ'.split('');
  const N = 32;          // normalleştirilmiş ızgara kenarı
  const OLCEK = 2.3;     // ızgaranın yarı genişliği = OLCEK * rms yarıçap

  const VARSAYILAN = {
    mavi: [180, 265],     // ton aralığı (derece)
    kirmizi: [330, 25],
    sMin: 0.35,           // en az doygunluk
    vMin: 0.16,           // en az parlaklık
    tasTipi: 'zemin',     // 'zemin': renkli taş + açık harf | 'harf': renkli harf, açık zemin
    minKenar: 14,         // işlem çözünürlüğünde taşın en küçük kenarı (px)
    maxKenar: 420,
    aciAraligi: 40,       // ± derece
    aciAdim: 8,
    tumYonler: true,      // taş ters/yan konsa da oku
    kabaAdim: 15,         // tüm yönler taranırken kaba açı adımı (derece)
    donmeCeza: 0.01,      // dönük okumaya küçük ceza (dik okuma öncelikli)
    donmeCeza90: 0.045,   // yan (90°) okumaya ek ceza: U/C, N/Z ikizlerinde dik ya da ters okuma kazanır
    minSkor: 0.5,
    minFark: 0.025,
    ogrenilmisBonus: 0.03,
    // 'harf' tipi (Osmo: beyaz taş + renkli harf) için taş zemini kontrolü
    cevrePay: 0.18,       // harf kutusunun etrafındaki halka kalınlığı (harf boyuna oran)
    beyazV: 0.42,         // zemin en az bu kadar parlak
    beyazS: 0.32,         // zemin en fazla bu kadar doygun (webcam mavi kayması için pay)
    beyazOran: 0.5,
    harfOrtS: 0.5,        // harf piksellerinin ortalama doygunluğu
    harfOrtV: 0.4
  };

  function aralikta(h, a) {
    return a[0] <= a[1] ? (h >= a[0] && h <= a[1]) : (h >= a[0] || h <= a[1]);
  }

  function ton(r, gg, b) {
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), df = mx - mn;
    if (!df) return { h: 0, s: 0, v: mx / 255 };
    let h;
    if (mx === r) h = ((gg - b) / df) % 6;
    else if (mx === gg) h = (b - r) / df + 2;
    else h = (r - gg) / df + 4;
    h *= 60; if (h < 0) h += 360;
    return { h, s: df / mx, v: mx / 255 };
  }

  /* 1 = mavi, 2 = kırmızı, 0 = diğer */
  function renkEtiketle(img, o) {
    const d = img.data, n = img.width * img.height, lab = new Uint8Array(n);
    const vMin = o.vMin * 255, sMin = o.sMin;
    for (let i = 0, p = 0; p < n; p++, i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      const mx = r > gg ? (r > b ? r : b) : (gg > b ? gg : b);
      if (mx < vMin) continue;
      const mn = r < gg ? (r < b ? r : b) : (gg < b ? gg : b);
      const df = mx - mn;
      if (df === 0 || df < sMin * mx) continue;
      let h;
      if (mx === r) h = ((gg - b) / df) % 6;
      else if (mx === gg) h = (b - r) / df + 2;
      else h = (r - gg) / df + 4;
      h *= 60; if (h < 0) h += 360;
      if (aralikta(h, o.mavi)) lab[p] = 1;
      else if (aralikta(h, o.kirmizi)) lab[p] = 2;
    }
    return lab;
  }

  function bilesenler(lab, w, h, minAlan) {
    const n = w * h, id = new Int32Array(n), yigin = new Int32Array(n);
    const comps = []; let k = 0;
    for (let p = 0; p < n; p++) {
      const c = lab[p];
      if (!c || id[p]) continue;
      k++; let sp = 0, alan = 0;
      yigin[sp++] = p; id[p] = k;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      while (sp) {
        const q = yigin[--sp]; alan++;
        const x = q % w, y = (q / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && lab[q - 1] === c && !id[q - 1]) { id[q - 1] = k; yigin[sp++] = q - 1; }
        if (x < w - 1 && lab[q + 1] === c && !id[q + 1]) { id[q + 1] = k; yigin[sp++] = q + 1; }
        if (y > 0 && lab[q - w] === c && !id[q - w]) { id[q - w] = k; yigin[sp++] = q - w; }
        if (y < h - 1 && lab[q + w] === c && !id[q + w]) { id[q + w] = k; yigin[sp++] = q + w; }
      }
      if (alan >= minAlan) comps.push({ ids: [k], renk: c, alan, x0, y0, x1, y1 });
    }
    return { id, comps };
  }

  /* Grup piksellerinden 1 px dolgulu yerel maske */
  function yerelMaske(grp, id, w) {
    const W = grp.x1 - grp.x0 + 3, H = grp.y1 - grp.y0 + 3, m = new Uint8Array(W * H);
    const set = grp.ids.length === 1 ? null : new Set(grp.ids), tek = grp.ids[0];
    for (let y = grp.y0; y <= grp.y1; y++) {
      const sat = y * w, ys = (y - grp.y0 + 1) * W + 1 - grp.x0;
      for (let x = grp.x0; x <= grp.x1; x++) {
        const v = id[sat + x];
        if (set ? set.has(v) : v === tek) m[ys + x] = 1;
      }
    }
    return { m, W, H };
  }

  /* Kenardan ulaşılamayan boşluklar = taşın içindeki harf */
  function delikler(m, W, H) {
    const dis = new Uint8Array(W * H), st = new Int32Array(W * H);
    let sp = 0; st[sp++] = 0; dis[0] = 1;
    while (sp) {
      const q = st[--sp], x = q % W, y = (q / W) | 0;
      if (x > 0 && !m[q - 1] && !dis[q - 1]) { dis[q - 1] = 1; st[sp++] = q - 1; }
      if (x < W - 1 && !m[q + 1] && !dis[q + 1]) { dis[q + 1] = 1; st[sp++] = q + 1; }
      if (y > 0 && !m[q - W] && !dis[q - W]) { dis[q - W] = 1; st[sp++] = q - W; }
      if (y < H - 1 && !m[q + W] && !dis[q + W]) { dis[q + W] = 1; st[sp++] = q + W; }
    }
    const harf = new Uint8Array(W * H); let say = 0;
    for (let i = 0; i < W * H; i++) if (!m[i] && !dis[i]) { harf[i] = 1; say++; }
    return { harf, say };
  }

  /* Küçük gürültü parçalarını sil (yerinde) */
  function kucukleriSil(m, W, H, minAlan) {
    const ziy = new Uint8Array(W * H), st = new Int32Array(W * H), parca = new Int32Array(W * H);
    let kalan = 0;
    for (let p = 0; p < W * H; p++) {
      if (!m[p] || ziy[p]) continue;
      let sp = 0, L = 0; st[sp++] = p; ziy[p] = 1;
      while (sp) {
        const q = st[--sp]; parca[L++] = q;
        const x = q % W, y = (q / W) | 0;
        // 8 komşuluk: noktalar ve ince çizgiler kopmasın
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const nq = ny * W + nx;
          if (m[nq] && !ziy[nq]) { ziy[nq] = 1; st[sp++] = nq; }
        }
      }
      if (L < minAlan) for (let i = 0; i < L; i++) m[parca[i]] = 0;
      else kalan += L;
    }
    return kalan;
  }

  /* e (esneme): masaya yatık taşlar eğik bakan kamerada dikeyde basık görünür; y ekseni e kadar
     uzatılmış uzayda çalışılır (e=1: düzeltme yok). */
  function moment(m, W, H, e) {
    e = e || 1;
    let s = 0, sx = 0, sy = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { s++; sx += x; sy += y; }
    if (!s) return null;
    const cx = sx / s, cy = sy / s; let rr = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) rr += (x - cx) * (x - cx) + (y - cy) * (y - cy) * e * e;
    return { s, cx, cy, e, r: Math.sqrt(rr / s) || 1 };
  }

  function izgara(m, W, H, mo, aci) {
    const out = new Float32Array(N * N), s = OLCEK * mo.r / (N / 2);
    const co = Math.cos(aci), si = Math.sin(aci);
    for (let gy = 0; gy < N; gy++) {
      const v = (gy + 0.5 - N / 2) * s;
      for (let gx = 0; gx < N; gx++) {
        const u = (gx + 0.5 - N / 2) * s;
        const x = mo.cx + u * co - v * si, y = mo.cy + (u * si + v * co) / (mo.e || 1);
        const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
        let a = 0, b = 0, c = 0, d = 0;
        if (y0 >= 0 && y0 < H) {
          if (x0 >= 0 && x0 < W) a = m[y0 * W + x0];
          if (x0 + 1 >= 0 && x0 + 1 < W) b = m[y0 * W + x0 + 1];
        }
        if (y0 + 1 >= 0 && y0 + 1 < H) {
          if (x0 >= 0 && x0 < W) c = m[(y0 + 1) * W + x0];
          if (x0 + 1 >= 0 && x0 + 1 < W) d = m[(y0 + 1) * W + x0 + 1];
        }
        out[gy * N + gx] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      }
    }
    return out;
  }

  /* 3x3 bulanıklaştır + sıfır ortalama + birim norm */
  function hazirla(v) {
    const b = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
        s += v[ny * N + nx] * (dx || dy ? 1 : 2); k += (dx || dy ? 1 : 2);
      }
      b[y * N + x] = s / k;
    }
    let ort = 0; for (let i = 0; i < N * N; i++) ort += b[i]; ort /= N * N;
    let nn = 0; for (let i = 0; i < N * N; i++) { b[i] -= ort; nn += b[i] * b[i]; }
    nn = Math.sqrt(nn); if (nn < 1e-6) return null;
    for (let i = 0; i < N * N; i++) b[i] /= nn;
    return b;
  }

  /* ---- Şablonlar ---- */
  const FONTLAR = [
    '900 {px}px "Arial Black", Arial, sans-serif',
    'bold {px}px Verdana, sans-serif',
    'bold {px}px "Trebuchet MS", sans-serif',
    'bold {px}px Helvetica, Arial, sans-serif',
    'bold {px}px "Avenir Next", "Segoe UI", sans-serif'
  ];

  function maskeyiSablonla(m, W, H, harf, kaynak) {
    const mo = moment(m, W, H); if (!mo) return null;
    const ham = izgara(m, W, H, mo, 0), v = hazirla(ham);
    return v ? { harf, v, ham, kaynak } : null;
  }

  function fontSablonlari(fontlar) {
    fontlar = fontlar || FONTLAR;
    const S = 160, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (const f of fontlar) for (const harf of HARFLER) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
      ctx.fillStyle = '#fff'; ctx.font = f.replace('{px}', 80);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(harf, S / 2, S / 2 + 4);
      const d = ctx.getImageData(0, 0, S, S).data, m = new Uint8Array(S * S);
      for (let i = 0; i < S * S; i++) m[i] = d[i * 4] > 127 ? 1 : 0;
      const t = maskeyiSablonla(m, S, S, harf, 'font');
      if (t) out.push(t);
    }
    return out;
  }

  function hamKodla(ham) {
    let s = ''; for (let i = 0; i < ham.length; i++) s += String.fromCharCode(Math.round(Math.max(0, Math.min(1, ham[i])) * 255));
    return btoa(s);
  }
  function hamCoz(b64) {
    const s = atob(b64), v = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) v[i] = s.charCodeAt(i) / 255;
    return v;
  }
  function ogrenilmisSablon(harf, b64) {
    const ham = hamCoz(b64), v = hazirla(ham);
    return v ? { harf, v, ham, kaynak: 'ogrenilmis' } : null;
  }

  const AILE = { Ö: 'O', Ü: 'U', İ: 'I', Ğ: 'G', Ç: 'C', Ş: 'S' };
  /* ---- Sınıflandırma ---- */
  // Taş her yöne konabilir (ters, yan). Tüm açılar kaba adımla denenir, en iyi adayların
  // çevresi ince adımla taranır. Dik duruşa küçük bir öncelik verilir (N/Z, C/U gibi 90° ikizlerinde
  // dik okuma kazanır).
  function sinifla(m, W, H, sablonlar, o) {
    const mo = moment(m, W, H, o.esneme);
    if (!mo || mo.s < 10) return null;
    const enIyi = new Map();
    const dene = a => {
      if (a > Math.PI) a -= 2 * Math.PI; else if (a <= -Math.PI) a += 2 * Math.PI;
      const v = hazirla(izgara(m, W, H, mo, a));
      if (!v) return;
      const sn = Math.sin(a), ceza = o.donmeCeza90 * sn * sn + o.donmeCeza * Math.abs(a) / Math.PI;
      for (const t of sablonlar) {
        const tv = t.v; let s = 0;
        for (let i = 0; i < tv.length; i++) s += v[i] * tv[i];
        s -= ceza;
        if (t.kaynak === 'ogrenilmis') s += o.ogrenilmisBonus;
        const e = enIyi.get(t.harf);
        if (e === undefined || s > e.s) enIyi.set(t.harf, { s, a });
      }
    };
    const R = Math.PI / 180;
    if (o.tumYonler) {
      for (let d = -180 + o.kabaAdim; d <= 180; d += o.kabaAdim) dene(d * R);
      const ilk = [...enIyi.values()].sort((x, y) => y.s - x.s).slice(0, 3), yapildi = new Set();
      for (const e of ilk) for (const dd of [-10, -5, 5, 10]) {
        const a = e.a + dd * R, k = Math.round(a * 1000);
        if (!yapildi.has(k)) { yapildi.add(k); dene(a); }
      }
    } else {
      for (let d = -o.aciAraligi; d <= o.aciAraligi + 1e-6; d += o.aciAdim) dene(d * R);
    }
    const sirali = [...enIyi.entries()].sort((a, b) => b[1].s - a[1].s);
    if (!sirali.length) return null;
    // 'harf' tipinde nokta/şapka ayrı kuralla karar verilir: O/Ö, U/Ü… aynı aile sayılır
    const aile = h => (o.tasTipi === 'harf' ? (AILE[h] || h) : h);
    const rakip = sirali.find(e => aile(e[0]) !== aile(sirali[0][0]));
    return {
      harf: sirali[0][0], skor: sirali[0][1].s, aci: sirali[0][1].a,
      fark: sirali[0][1].s - (rakip ? rakip[1].s : 0),
      ikinci: rakip ? rakip[0] : null,
      ham: izgara(m, W, H, mo, 0)
    };
  }

  function harfGruplari(comps) {
    // 'harf' taş tipi: aynı renkteki yakın parçaları birleştir (İ noktası, Ö, Ü, Ğ vb.)
    const n = comps.length, ata = comps.map((_, i) => i);
    const bul = i => (ata[i] === i ? i : (ata[i] = bul(ata[i])));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = comps[i], b = comps[j];
      if (a.renk !== b.renk) continue;
      const boy = Math.max(a.x1 - a.x0, a.y1 - a.y0, b.x1 - b.x0, b.y1 - b.y0) + 1;
      const gx = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
      const gy = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
      // yalnızca küçük bir parça (nokta, şapka, çengel) büyük harfe eklenir
      const kucuk = Math.min(a.alan, b.alan), buyuk = Math.max(a.alan, b.alan);
      if (kucuk <= buyuk * 0.25 && gx <= boy * 0.2 && gy <= boy * 0.4) ata[bul(i)] = bul(j);
      // ince çizgide kopmuş harf parçaları (neredeyse bitişik) boyutuna bakmadan birleşir
      else if (gx <= Math.max(2, boy * 0.06) && gy <= Math.max(2, boy * 0.06)) ata[bul(i)] = bul(j);
    }
    const m = new Map();
    comps.forEach((c, i) => {
      const r = bul(i);
      const g0 = m.get(r);
      if (!g0) m.set(r, { ids: [...c.ids], renk: c.renk, alan: c.alan, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, parcalar: [c] });
      else {
        g0.ids.push(...c.ids); g0.alan += c.alan; g0.parcalar.push(c);
        g0.x0 = Math.min(g0.x0, c.x0); g0.y0 = Math.min(g0.y0, c.y0);
        g0.x1 = Math.max(g0.x1, c.x1); g0.y1 = Math.max(g0.y1, c.y1);
      }
    });
    return [...m.values()];
  }

  /* Harfin çevresindeki halkada açık renkli (taş zemini) piksel oranı */
  function beyazCevre(img, grp, o) {
    const w = img.width, h = img.height, d = img.data;
    const boy = Math.max(grp.x1 - grp.x0, grp.y1 - grp.y0) + 1;
    const bosluk = Math.max(1, Math.round(boy * 0.05));
    const pad = Math.max(3, Math.round(boy * o.cevrePay)) + bosluk;
    const X0 = Math.max(0, grp.x0 - pad), X1 = Math.min(w - 1, grp.x1 + pad);
    const Y0 = Math.max(0, grp.y0 - pad), Y1 = Math.min(h - 1, grp.y1 + pad);
    const adim = Math.max(1, Math.round(pad / 6));
    let top = 0, beyaz = 0;
    for (let y = Y0; y <= Y1; y += adim) for (let x = X0; x <= X1; x += adim) {
      // harfin hemen yanındaki bulanık renk halesi sayılmaz
      if (x >= grp.x0 - bosluk && x <= grp.x1 + bosluk && y >= grp.y0 - bosluk && y <= grp.y1 + bosluk) continue;
      const i = (y * w + x) * 4, r = d[i], g2 = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b);
      top++;
      if (mx < o.beyazV * 255 || mx - mn > o.beyazS * mx) continue;
      // ten/ahşap gibi kırmızımsı-sarımsı açık yüzeyler beyaz sayılmaz
      if (mx - mn > 0.14 * mx && mx === r) continue;
      beyaz++;
    }
    // görüntü kenarında kesilen halka: eksik kısmı beyaz sayma
    return top ? beyaz / top : 0;
  }

  /* 'harf' tipi: grubun gerçekten beyaz taş üstünde canlı renkli bir harf olup olmadığı */
  let sonSebep = '';
  function harfAdayi(grp, img, id, o) {
    const red = s => { sonSebep = s; return null; };
    const bw = grp.x1 - grp.x0 + 1, bh = grp.y1 - grp.y0 + 1, boy = Math.max(bw, bh);
    if (boy < o.minKenar) return red('çok küçük');
    if (boy > o.maxKenar) return red('çok büyük');
    if (grp.alan < o.minKenar * 1.5) return red('çok ince');
    if (boy / Math.min(bw, bh) > 8) return red('çizgi');        // çizgi/kenar parçası (I harfi ~5:1)
    const dol = grp.alan / (bw * bh);
    // I harfi tek dik çubuktur (çok dolu ama uzun-ince); kare/yuvarlak dolu lekeler elenir
    const bhE = bh * (o.esneme || 1);
    if (dol > 0.85 && Math.max(bw, bhE) / Math.min(bw, bhE) < 2.5) return red('dolu leke');
    if (dol < 0.08) return red('dağınık');
    // renk canlılığı: harf mürekkebi doygun ve parlaktır (lacivert kumaş, gölge, ten elenir)
    const w = img.width, d = img.data, set = new Set(grp.ids);
    // Küçük/bulanık harflerde kenar pikselleri soluk kalır: yalnızca en canlı yarının ortalaması alınır
    const ss = [], vv = [];
    for (let y = grp.y0; y <= grp.y1; y++) for (let x = grp.x0; x <= grp.x1; x++) {
      if (!set.has(id[y * w + x])) continue;
      const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      ss.push((mx - mn) / mx); vv.push(mx / 255);
    }
    const n = ss.length;
    if (!n) return red('renk soluk');
    const ustYari = a => { a.sort((p, q) => q - p); const k = Math.max(1, Math.ceil(a.length / 2)); let t = 0; for (let i = 0; i < k; i++) t += a[i]; return t / k; };
    if (ustYari(ss) < o.harfOrtS) return red('renk soluk');
    if (ustYari(vv) < o.harfOrtV) return red('karanlık');
    const bc = beyazCevre(img, grp, o);
    if (bc < o.beyazOran) return red('etrafı beyaz değil ' + Math.round(bc * 100) + '%');   // taş zemini yok
    sonSebep = '';
    return grp;
  }

  /* Harf maskesi + soluk/bulanık kalmış nokta, şapka, çengel (Ö Ü İ Ğ Ç Ş).
     Harfin üstünde/altında, daha düşük doygunluk eşiğiyle, harfe değmeyen küçük parçalar eklenir. */
  function aksanEkle(img, grp, id, o) {
    const w = img.width, h = img.height, d = img.data;
    const bw = grp.x1 - grp.x0 + 1, bh = grp.y1 - grp.y0 + 1, boy = Math.max(bw, bh);
    const X0 = Math.max(0, grp.x0 - Math.round(boy * 0.12)), X1 = Math.min(w - 1, grp.x1 + Math.round(boy * 0.12));
    const Y0 = Math.max(0, grp.y0 - Math.round(boy * 0.45)), Y1 = Math.min(h - 1, grp.y1 + Math.round(boy * 0.35));
    const W = X1 - X0 + 3, H = Y1 - Y0 + 3, m = new Uint8Array(W * H), zayif = new Uint8Array(W * H);
    const set = new Set(grp.ids), aralik = grp.renk === 1 ? o.mavi : o.kirmizi, sZ = o.sMin * 0.55, vZ = o.vMin * 255;
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const gi = y * w + x, li = (y - Y0 + 1) * W + (x - X0 + 1);
      if (set.has(id[gi])) { m[li] = 1; continue; }
      const i = gi * 4, r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), df = mx - mn;
      if (mx < vZ || !df || df < sZ * mx) continue;
      let hh = mx === r ? ((g - b) / df) % 6 : mx === g ? (b - r) / df + 2 : (r - g) / df + 4;
      hh *= 60; if (hh < 0) hh += 360;
      if (aralikta(hh, aralik)) zayif[li] = 1;
    }
    const ziy = new Uint8Array(W * H), st = new Int32Array(W * H), parca = new Int32Array(W * H);
    const enFazla = grp.alan * 0.3;
    for (let p = 0; p < W * H; p++) {
      if (!zayif[p] || ziy[p]) continue;
      let sp = 0, L = 0, deger = false, sx = 0;
      st[sp++] = p; ziy[p] = 1;
      while (sp) {
        const q = st[--sp]; parca[L++] = q;
        const x = q % W, y = (q / W) | 0; sx += x;
        if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) deger = true;   // bölge kenarına taşıyor: dış nesne
        const kom = [q - 1, q + 1, q - W, q + W];
        for (const n of kom) {
          if (n < 0 || n >= W * H) continue;
          if (m[n]) deger = true;                                        // harfe yapışık hale: ekleme
          else if (zayif[n] && !ziy[n]) { ziy[n] = 1; st[sp++] = n; }
        }
      }
      const cx = sx / L + X0 - 1;
      if (deger || L < 2 || L > enFazla || cx < grp.x0 || cx > grp.x1) continue;
      for (let i = 0; i < L; i++) m[parca[i]] = 1;
    }
    return { m, W, H };
  }

  /* Nokta/şapka/çengel kararı: gövdenin üstünde ya da altında ayrı duran küçük parçaları say.
     Şekil eşleme küçük işaretleri gövdeye göre zayıf tartar; bu kural onları açıkça ayırır. */
  const UST_CIFT = { O: 'Ö', Ö: 'Ö', U: 'Ü', Ü: 'Ü', I: 'İ', İ: 'İ', G: 'Ğ', Ğ: 'Ğ' };
  const UST_YALIN = { Ö: 'O', Ü: 'U', İ: 'I', Ğ: 'G' };
  const ALT_CIFT = { C: 'Ç', S: 'Ş' };
  function aksanKarari(m, W, H, harf, aci) {
    if (!(harf in UST_CIFT) && !(harf in ALT_CIFT) && harf !== 'Ç' && harf !== 'Ş') return harf;
    // 8 komşulu parçalar
    const ziy = new Uint8Array(W * H), st = new Int32Array(W * H), parcalar = [];
    for (let p = 0; p < W * H; p++) {
      if (!m[p] || ziy[p]) continue;
      let sp = 0, alan = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      st[sp++] = p; ziy[p] = 1;
      while (sp) {
        const q = st[--sp], x = q % W, y = (q / W) | 0; alan++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const n = ny * W + nx;
          if (m[n] && !ziy[n]) { ziy[n] = 1; st[sp++] = n; }
        }
      }
      parcalar.push({ alan, x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
    }
    if (!parcalar.length) return harf;
    parcalar.sort((a, b) => b.alan - a.alan);
    const g = parcalar[0];
    // harfin kendi ekseninde (taş döndürülmüş/ters olabilir) üst-alt ayrımı
    const ca = Math.cos(aci || 0), sa = Math.sin(aci || 0);
    const gcx = (g.x0 + g.x1) / 2, gcy = (g.y0 + g.y1) / 2;
    const kose = [[g.x0, g.y0], [g.x1, g.y0], [g.x0, g.y1], [g.x1, g.y1]];
    const vs = kose.map(([x, y]) => -(x - gcx) * sa + (y - gcy) * ca), us = kose.map(([x, y]) => (x - gcx) * ca + (y - gcy) * sa);
    const gh = Math.max(...vs) - Math.min(...vs) + 1, gw = Math.max(...us) - Math.min(...us) + 1;
    let ust = 0, alt = 0;
    for (const k of parcalar.slice(1)) {
      if (k.alan < Math.max(2, g.alan * 0.006)) continue;
      const dx = k.cx - gcx, dy = k.cy - gcy;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (Math.abs(u) > gw * 0.8) continue;
      if (v < -gh * 0.3 && v > -gh * 1.1) ust++;
      else if (v > gh * 0.3 && v < gh * 1.0) alt++;
    }
    if (harf in UST_CIFT) return ust ? UST_CIFT[harf] : (UST_YALIN[harf] || harf);
    if (harf in ALT_CIFT) return alt ? ALT_CIFT[harf] : harf;
    return harf; // Ç / Ş: çengel gövdeye bitişik olabilir, şekil eşlemeye güven
  }

  /* Ana giriş: ImageData benzeri {data,width,height} */
  function tara(img, sablonlar, secenek) {
    const o = Object.assign({}, VARSAYILAN, secenek || {});
    const w = img.width, h = img.height;
    const lab = renkEtiketle(img, o);
    const minAlan = o.tasTipi === 'harf' ? 3 : o.minKenar * o.minKenar * 0.3;
    const { id, comps } = bilesenler(lab, w, h, minAlan);
    const gruplar = o.tasTipi === 'harf' ? harfGruplari(comps) : comps;
    const tespitler = [], elenenler = [];
    for (let grp of gruplar) {
      let bw = grp.x1 - grp.x0 + 1, bh = grp.y1 - grp.y0 + 1, boy = Math.max(bw, bh);
      if (o.tasTipi !== 'harf' && (boy < o.minKenar || boy > o.maxKenar)) continue;
      let { m, W, H } = yerelMaske(grp, id, w);
      let harfM;
      if (o.tasTipi === 'harf') {
        let g2 = harfAdayi(grp, img, id, o);
        if (!g2 && grp.parcalar && grp.parcalar.length > 1) {
          // birleşen parçalardan biri yabancıysa (dudak, parmak) yalnız en büyük parçayı dene
          const ana = grp.parcalar.reduce((a, b) => (a.alan >= b.alan ? a : b));
          g2 = harfAdayi(ana, img, id, o);
        }
        if (!g2) {
          if (grp.alan >= 25 && boy >= o.minKenar * 0.6) elenenler.push({ kutu: [grp.x0, grp.y0, grp.x1, grp.y1], renk: grp.renk === 1 ? 'mavi' : 'kirmizi', sebep: sonSebep, alan: grp.alan });
          continue;
        }
        grp = g2;
        ({ m, W, H } = aksanEkle(img, grp, id, o));
        harfM = m;
      } else {
        if (boy / Math.min(bw, bh) > 1.8) continue;          // iki taş yapışık ya da kenar
        const dl = delikler(m, W, H);
        // Harfin iç boşlukları (O, B, D, A…) taş renginde: harften çıkar
        let ic = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x;
          if (dl.harf[i] && lab[(grp.y0 + y - 1) * w + grp.x0 + x - 1] === grp.renk) { dl.harf[i] = 0; dl.say--; ic++; }
        }
        const dolu = grp.alan + ic + dl.say;
        if (dolu / (bw * bh) < 0.42) continue;               // taş değil (dağınık leke)
        const kalan = kucukleriSil(dl.harf, W, H, Math.max(2, dolu * 0.003));
        const oran = kalan / dolu;
        if (oran < 0.025 || oran > 0.65) continue;            // içinde harf yok
        harfM = dl.harf;
      }
      bw = grp.x1 - grp.x0 + 1; bh = grp.y1 - grp.y0 + 1; boy = Math.max(bw, bh);
      const s = sinifla(harfM, W, H, sablonlar, o);
      if (s && o.tasTipi === 'harf') s.harf = aksanKarari(harfM, W, H, s.harf, s.aci);
      const tamam = s && s.skor >= o.minSkor && s.fark >= o.minFark;
      tespitler.push({
        renk: grp.renk === 1 ? 'mavi' : 'kirmizi',
        x: (grp.x0 + grp.x1) / 2, y: (grp.y0 + grp.y1) / 2, boyut: boy,
        kutu: [grp.x0, grp.y0, grp.x1, grp.y1],
        harf: tamam ? s.harf : null,
        aday: s ? s.harf : null, skor: s ? s.skor : 0, fark: s ? s.fark : 0,
        ham: s ? s.ham : null
      });
    }
    elenenler.sort((a, b) => b.alan - a.alan);
    return { tespitler, lab, elenenler: elenenler.slice(0, 10) };
  }

  /* ---- Takipçi ---- */
  class Takipci {
    constructor(sec) {
      this.o = Object.assign({ kare: 3, oran: 0.6, unutma: 1200 }, sec || {});
      this.izler = []; this.sayac = 0;
    }
    sifirla() { this.izler = []; }
    guncelle(tespitler, t) {
      const kullanildi = new Set(), olaylar = [];
      for (const d of tespitler) {
        let en = null, enD = Infinity;
        for (const iz of this.izler) {
          if (kullanildi.has(iz) || iz.renk !== d.renk) continue;
          const dd = Math.hypot(iz.x - d.x, iz.y - d.y);
          if (dd < Math.max(iz.boyut, d.boyut) * 0.8 && dd < enD) { en = iz; enD = dd; }
        }
        if (!en) {
          en = { no: ++this.sayac, renk: d.renk, x: d.x, y: d.y, boyut: d.boyut, oy: {}, gorulme: 0, son: t, onay: false, harf: null };
          this.izler.push(en);
        }
        kullanildi.add(en);
        en.x = d.x; en.y = d.y; en.boyut = d.boyut; en.son = t;
        if (d.harf) { en.oy[d.harf] = (en.oy[d.harf] || 0) + 1; en.gorulme++; }
        d.iz = en.no;
      }
      for (const iz of this.izler) {
        if (iz.onay || iz.gorulme < this.o.kare) continue;
        let bh = null, bo = 0;
        for (const k in iz.oy) if (iz.oy[k] > bo) { bo = iz.oy[k]; bh = k; }
        if (bh && bo / iz.gorulme >= this.o.oran) { iz.onay = true; iz.harf = bh; olaylar.push({ harf: bh, renk: iz.renk, iz: iz.no }); }
        else if (iz.gorulme > this.o.kare * 4) { iz.oy = {}; iz.gorulme = 0; } // kararsız, baştan say
      }
      this.izler = this.izler.filter(iz => t - iz.son <= this.o.unutma);
      return olaylar;
    }
  }

  g.Vision = {
    HARFLER, N, VARSAYILAN, tara, ton, fontSablonlari, ogrenilmisSablon, maskeyiSablonla,
    hamKodla, hamCoz, Takipci, _ic: { renkEtiketle, bilesenler, delikler, izgara, hazirla, moment, aksanEkle, aksanKarari, harfAdayi, harfGruplari, beyazCevre }
  };
})(window);
