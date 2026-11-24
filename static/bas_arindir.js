// Baş etkisini çıkarma (bakis_test.html "bizA", "reLA", "karmaA"). Baş turunda göz bir noktada sabitken baş çevrilir: o noktanın
// kareleri arasındaki öznitelik farkı yalnız baştan gelir. Her öznitelik için 6 baş değerine (gzPose3: yaw/pitch/roll, tx/ty/tz)
// doğrusal eğim öğrenilir, sonraki her karede eğim × (poz − referans poz) çıkarılır; modeller bu "başı çıkarılmış" öznitelikle kurulur.
//
// Öğrenme: her noktanın kareleri kendi ortalamasına göre merkezlenir (bakış farkı eğime karışmasın), poz sütunları z-skorlanır,
// ridge: B = (PᵀP + λ·n·I)⁻¹ PᵀX. Öznitelik başına 6 eğim (p ≫ n olsa da her sütun ayrı 6 değişkenli regresyon, aşırı uyum yok).
// haric: dokunulmayan sütunlar (baş açısının kendisi gibi; model başı yine görebilsin).
const BAS_POZ = ["yaw", "pitch", "roll", "tx", "ty", "tz"];

function basPoz(b) {
  const p = b && b.pose3; if (!p) return null;
  const v = BAS_POZ.map((k) => p[k]);
  return v.every(Number.isFinite) ? v : null;
}

// gruplar: [{ X: [vektör...], P: [poz(6)...] }] (bir grup = göz sabit tek nokta; X[i] ile P[i] aynı kare)
function basEtkisiOgren(gruplar, { lam = 0.05, haric = [] } = {}) {
  const G = gruplar.filter((g) => g.X.length >= 3 && g.X.length === g.P.length);
  if (!G.length) return null;
  const d = G[0].X[0].length, k = BAS_POZ.length;
  const Xc = [], Pc = [], tumP = [];
  for (const g of G) {
    if (g.X.some((x) => x.length !== d)) continue;
    const mx = new Float64Array(d), mp = new Float64Array(k), n = g.X.length;
    for (let i = 0; i < n; i++) { for (let j = 0; j < d; j++) mx[j] += g.X[i][j] / n; for (let j = 0; j < k; j++) mp[j] += g.P[i][j] / n; }
    for (let i = 0; i < n; i++) {
      const x = new Float64Array(d), p = new Float64Array(k);
      for (let j = 0; j < d; j++) x[j] = g.X[i][j] - mx[j];
      for (let j = 0; j < k; j++) p[j] = g.P[i][j] - mp[j];
      Xc.push(x); Pc.push(p); tumP.push(g.P[i]);
    }
  }
  const n = Xc.length; if (n < 10) return null;
  const sd = new Float64Array(k);
  for (let j = 0; j < k; j++) { let s = 0; for (const p of Pc) s += p[j] * p[j]; sd[j] = Math.sqrt(s / n) || 1; }
  for (const p of Pc) for (let j = 0; j < k; j++) p[j] /= sd[j];
  const A = Array.from({ length: k }, () => new Float64Array(k));
  for (const p of Pc) for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) A[a][c] += p[a] * p[c];
  for (let a = 0; a < k; a++) A[a][a] += lam * n;
  const C = Array.from({ length: k }, () => new Float64Array(d));
  for (let i = 0; i < n; i++) for (let a = 0; a < k; a++) { const pa = Pc[i][a]; if (pa) for (let j = 0; j < d; j++) C[a][j] += pa * Xc[i][j]; }
  // A simetrik pozitif tanımlı: Gauss eleme (k = 6)
  for (let a = 0; a < k; a++) {
    const piv = A[a][a];
    for (let c = a + 1; c < k; c++) {
      const r = A[c][a] / piv; if (!r) continue;
      for (let e = a; e < k; e++) A[c][e] -= r * A[a][e];
      for (let j = 0; j < d; j++) C[c][j] -= r * C[a][j];
    }
  }
  const B = Array.from({ length: k }, () => new Float64Array(d));
  for (let a = k - 1; a >= 0; a--) for (let j = 0; j < d; j++) {
    let s = C[a][j]; for (let e = a + 1; e < k; e++) s -= A[a][e] * B[e][j];
    B[a][j] = s / A[a][a];
  }
  for (const j of haric) if (j >= 0 && j < d) for (let a = 0; a < k; a++) B[a][j] = 0;
  const ref = new Float64Array(k);
  for (const p of tumP) for (let j = 0; j < k; j++) ref[j] += p[j] / tumP.length;
  return { B, ref, sd, d, n, grup: G.length };
}

// v: öznitelik vektörü, p: o karenin pozu (basPoz). Dönüş: başı çıkarılmış kopya; E yoksa, boy uymuyorsa ya da poz yoksa null.
function basCikar(E, v, p) {
  if (!E || !v || !p || v.length !== E.d) return null;
  const k = BAS_POZ.length, z = new Float64Array(k);
  for (let a = 0; a < k; a++) z[a] = (p[a] - E.ref[a]) / E.sd[a];
  const o = new Float32Array(E.d);
  for (let j = 0; j < E.d; j++) { let s = v[j]; for (let a = 0; a < k; a++) s -= E.B[a][j] * z[a]; o[j] = s; }
  return o;
}
