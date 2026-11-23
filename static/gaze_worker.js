// MediaPipe FaceLandmarker'ı ana iş parçacığının dışında çalıştırır (gaze.js GazeTracker kullanır).
// KLASİK worker olmalı (type: "module" DEĞİL): tasks-vision 0.10.14 wasm yükleyicisini importScripts ile yükler;
// module worker'da importScripts tanımlı ama çağrılınca hata atar. Paket dinamik import() ile alınır.
//
// Mesajlar:
//   gelen  {tip:"kur", base, model}                → giden {tip:"hazir", delegate, gpuHata} | {tip:"kurHata", e}
//   gelen  {tip:"kare", bmp: ImageBitmap, ts (ms)} → giden {tip:"sonuc", res, ms, bmp} | {tip:"hata", e, bmp}
//   bmp her durumda ana iş parçacığına geri aktarılır (göz yamaları aynı kareden kesilir).
let isaretci = null;

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
      const res = yalin(isaretci.detectForVideo(m.bmp, m.ts));
      postMessage({ tip: "sonuc", res, ms: performance.now() - t0, bmp: m.bmp }, [m.bmp]);
    } catch (x) {
      postMessage({ tip: "hata", e: String(x?.message || x).slice(0, 160), bmp: m.bmp }, [m.bmp]);
    }
  }
};
