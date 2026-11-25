// MediaPipe FaceLandmarker'ı ana iş parçacığının dışında çalıştırır (gaze.js GazeTracker kullanır).
// KLASİK worker olmalı (type: "module" DEĞİL): tasks-vision 0.10.14 wasm yükleyicisini importScripts ile yükler;
// module worker'da importScripts tanımlı ama çağrılınca hata atar. Paket dinamik import() ile alınır.
//
// Mesajlar:
//   gelen  {tip:"kur", base, model}                → giden {tip:"hazir", delegate, gpuHata} | {tip:"kurHata", e}
//   gelen  {tip:"kare", id, bmp: ImageBitmap, kalite} → giden {tip:"sonuc", id, res, ms, bmp, q?, kaliteMs?} | {tip:"hata", id, e, bmp}
//   kalite: true ise görüntü kalitesi (kalite.js gzKaliteKesit) burada hesaplanır (ana iş parçacığı görüntü okumaz); yüz yoksa q = null
//   bmp her durumda ana iş parçacığına geri aktarılır (göz yamaları aynı kareden kesilir); id bayat yanıtı ayırmak için.
// detectForVideo zaman damgası worker'ın kendi saatinden, kesin artan (ana yol da detect anının performance.now()'unu verir;
// worker'ın saat başlangıcı ana iş parçacığınınkinden farklı olduğu için ana saatten gelen değer kullanılmaz).
importScripts("kalite.js");   // gzKalite, gzKaliteKesit (worker betiğiyle aynı klasör)
let isaretci = null, sonTs = 0, qCtx = null;
const ts = () => (sonTs = Math.max(performance.now(), sonTs + 0.001));

async function kur({ base, model }) {
  const v = await import(`${base}/vision_bundle.mjs`);
  const files = await v.FilesetResolver.forVisionTasks(`${base}/wasm`);
  const mk = (delegate) => v.FaceLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: model, delegate }, runningMode: "VIDEO", numFaces: 1,
    outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
  });
  let delegate = "GPU", gpuHata = null;
  try { isaretci = await mk("GPU"); }
  catch (e) { gpuHata = String(e?.message || e).slice(0, 160); isaretci = await mk("CPU"); delegate = "CPU"; }
  // Isınma: ilk detect GPU'da birkaç saniye sürebilir (gölgelendirici derleme); "hazir"dan önce yapılır ki ilk gerçek kare
  // ana iş parçacığındaki 2 sn bekçisine takılmasın. Sonucu kullanılmaz.
  try {
    const oc = new OffscreenCanvas(64, 64); oc.getContext("2d").fillRect(0, 0, 64, 64);
    const b = oc.transferToImageBitmap(); isaretci.detectForVideo(b, ts()); b.close();
  } catch {}
  return { delegate, gpuHata };
}

// Sonucu yalın dizi/sayıya çevir (gaze.js'in okuduğu alanlar, aynı biçimde)
const yalin = (r) => ({
  faceLandmarks: (r.faceLandmarks || []).map((f) => f.map((q) => ({ x: q.x, y: q.y, z: q.z }))),
  faceBlendshapes: (r.faceBlendshapes || []).map((b) => ({ categories: b.categories.map((c) => ({ categoryName: c.categoryName, score: c.score })) })),
  facialTransformationMatrixes: (r.facialTransformationMatrixes || []).map((m) => ({ rows: m.rows, columns: m.columns, data: Array.from(m.data) })),
});

onmessage = async (e) => {
  const m = e.data;
  if (m.tip === "kur") {
    try { postMessage({ tip: "hazir", ...(await kur(m)) }); }
    catch (x) { postMessage({ tip: "kurHata", e: String(x?.message || x).slice(0, 160) }); }
    return;
  }
  if (m.tip === "kare") {
    const t0 = performance.now();
    try {
      const r = isaretci.detectForVideo(m.bmp, ts()), ms = performance.now() - t0;   // ms: saf detect (ana yoldaki islemeMs ile aynı anlam)
      const ek = {};
      if (m.kalite) {
        const k0 = performance.now(), lm = r.faceLandmarks?.[0];
        try {
          if (lm && lm.length >= 478) {
            if (!qCtx) qCtx = new OffscreenCanvas(64, 64).getContext("2d", { willReadFrequently: true });
            const w = m.bmp.width, h = m.bmp.height;
            ek.q = gzKaliteKesit(qCtx, m.bmp, lm.map((q) => [q.x * w, q.y * h]), w, h);
          } else ek.q = null;
        } catch { ek.q = null; }
        ek.kaliteMs = performance.now() - k0;
      }
      postMessage({ tip: "sonuc", id: m.id, res: yalin(r), ms, bmp: m.bmp, ...ek }, [m.bmp]);
    } catch (x) {
      postMessage({ tip: "hata", id: m.id, e: String(x?.message || x).slice(0, 160), bmp: m.bmp }, [m.bmp]);
    }
  }
};
