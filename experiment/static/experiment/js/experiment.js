/*
 * Faz 1 — Katilimci prototipi (jsPsych + WebGazer)
 *
 * Akis: onam -> cihaz kontrolu -> tam ekran -> kamera baslatma ->
 *       kalibrasyon (9) -> dogrulama (5) -> odak artisi -> tek materyal -> JSON indir
 *
 * KURAL (spec §6, §15): Kamera goruntusu hicbir zaman kaydedilmez/gonderilmez.
 * Yalnizca bakis koordinatlari (x, y, t) toplanir. Bu fazda sunucuya kayit YOKTUR;
 * veri tarayicidan JSON olarak indirilir.
 */
(function () {
  "use strict";

  const APP_VERSION = "0.1.0-faz1";
  const MIN_W = 1280;
  const MIN_H = 720;
  const STIM_ID = "#jspsych-image-button-response-stimulus";

  const material = JSON.parse(document.getElementById("material-data").textContent);

  // --- Cihaz / tarayici kontrolu (spec §5.2, §11) ---------------------------
  function deviceIssue() {
    const ua = navigator.userAgent;
    const isEdge = /Edg\//.test(ua);
    const isChrome = /Chrome\//.test(ua) && !/OPR\//.test(ua);
    if (!(isChrome || isEdge)) {
      return "Bu calisma yalnizca masaustu Chrome veya Edge tarayicilarinda desteklenir.";
    }
    if (/Mobi|Android|iPhone|iPad|iPod/.test(ua)) {
      return "Bu calisma mobil cihazlarda ve tabletlerde yapilamaz. Lutfen bir masaustu veya dizustu bilgisayar kullanin.";
    }
    if (window.innerWidth < MIN_W || window.innerHeight < MIN_H) {
      return (
        "Ekran/pencere alani cok kucuk (" + window.innerWidth + "x" + window.innerHeight +
        "). En az " + MIN_W + "x" + MIN_H + " gereklidir. Lutfen pencereyi buyutun veya ekran cozunurlugunu artirin."
      );
    }
    return null;
  }

  function showBlock(message) {
    const el = document.getElementById("engel");
    el.innerHTML = "<h1>Devam edilemiyor</h1><p>" + message + "</p>";
    el.style.display = "block";
  }

  const issue = deviceIssue();
  if (issue) {
    showBlock(issue);
    return; // jsPsych hic baslatilmaz
  }

  // --- jsPsych ---------------------------------------------------------------
  const jsPsych = initJsPsych({
    extensions: [{ type: jsPsychExtensionWebgazer, params: { webgazer: webgazer } }],
    on_finish: function () {
      try {
        buildAndDownload();
      } catch (e) {
        console.error("Veri hazirlama hatasi:", e);
        document.body.innerHTML =
          '<div style="font-family:sans-serif;margin:10vh auto;max-width:520px">' +
          "<h2>Veri hazirlanirken bir hata olustu</h2><pre>" + String(e) + "</pre></div>";
      }
    },
  });

  const timeline = [];

  // 1) Bilgilendirilmis onam (spec §5.1)
  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus:
      '<div style="max-width:720px;margin:0 auto;text-align:left;line-height:1.6">' +
      "<h2>Bilgilendirilmis Onam</h2>" +
      "<p>Bu calismada, ekranda gosterilen bir ogretim materyalini incelerken " +
      "bilgisayarinizin <strong>web kamerasi</strong> araciligiyla ekranin nerelerine " +
      "baktiginiz tahmin edilecektir.</p>" +
      "<p><strong>Kamera goruntunuz kaydedilmez ve hicbir yere gonderilmez.</strong> " +
      "Yalnizca tahmini bakis koordinatlari toplanir. Katilim gonulludur; istediginiz an " +
      "pencereyi kapatarak ayrilabilirsiniz.</p>" +
      "<p>Devam etmek icin onayinizi veriniz.</p></div>",
    choices: ["Onayliyorum", "Onaylamiyorum"],
    on_finish: function (data) {
      if (data.response === 1) {
        jsPsych.abortExperiment(
          "Onam verilmedigi icin calisma sonlandirildi. Katiliminiz icin tesekkurler."
        );
      }
    },
  });

  // 2) Kisa ortam yonergesi + tam ekran (spec §5.3, §5.4)
  timeline.push({
    type: jsPsychFullscreen,
    message:
      '<div style="max-width:680px;margin:0 auto;line-height:1.6">' +
      "<h2>Baslamadan once</h2><ul style='text-align:left'>" +
      "<li>Yuzunuze <strong>onden</strong> gelen iyi bir isik olsun; arkanizda pencere olmasin.</li>" +
      "<li>Ekrana <strong>50–70 cm</strong> mesafede, dik oturun.</li>" +
      "<li>Kameranin ekranin <strong>ust</strong> kenarinda oldugundan emin olun.</li>" +
      "<li>Calisma boyunca basinizi mumkun oldukça sabit tutun.</li></ul>" +
      "<p>Tam ekrana gecmek icin asagidaki dugmeye basin.</p></div>",
    button_label: "Tam ekrana gec",
  });

  // 3) Kamera baslatma ve yuz konumlandirma (spec §5.4)
  timeline.push({
    type: jsPsychWebgazerInitCamera,
    instructions:
      '<div style="max-width:680px;margin:0 auto;line-height:1.6">' +
      "<p>Kamera erisimine izin verin. Yuzunuzu kamerada <strong>ortalayin</strong>; " +
      "yuz hatlarinizin uzerindeki noktalar yesile dondugunde hazirsiniz demektir.</p></div>",
  });

  // 4) Kalibrasyon: 9 nokta, tiklama (spec §5.5)
  timeline.push({
    type: jsPsychWebgazerCalibrate,
    calibration_points: [
      [10, 10], [50, 10], [90, 10],
      [10, 50], [50, 50], [90, 50],
      [10, 90], [50, 90], [90, 90],
    ],
    calibration_mode: "click",
    repetitions_per_point: 1,
    randomize_calibration_order: true,
  });

  // 5) Dogrulama: 5 nokta (spec §5.6)
  timeline.push({
    type: jsPsychWebgazerValidate,
    validation_points: [
      [50, 50], [20, 20], [80, 20], [20, 80], [80, 80],
    ],
    validation_point_coordinates: "percent",
    roi_radius: 200,
    time_to_saccade: 1000,
    validation_duration: 2000,
    data: { task: "validate" },
    on_finish: function (data) {
      // Ortalama hata katilimciya kisaca gosterilir (bilgi amacli)
      console.log("Dogrulama ortalama ofset:", data.average_offset);
    },
  });

  // 6) Odak artisi — 1 sn (spec §5.7)
  timeline.push({
    type: jsPsychHtmlKeyboardResponse,
    stimulus: '<div style="font-size:64px">+</div>',
    choices: "NO_KEYS",
    trial_duration: 1000,
  });

  // 7) Tek materyal — letterbox, ortali, kaydirmasiz; "Devam" ile gecis (spec §5.7)
  timeline.push({
    type: jsPsychImageButtonResponse,
    stimulus: material.src,
    // En-boy orani korunur; ekrana sigacak sekilde kucultulur (letterbox etkisi)
    maintain_aspect_ratio: true,
    stimulus_height: Math.min(material.natural_height, Math.round(window.innerHeight * 0.9)),
    render_on_canvas: false,
    choices: ["Devam"],
    prompt: "<p style='color:#777'>Materyali inceledikten sonra <strong>Devam</strong> deyin.</p>",
    extensions: [
      { type: jsPsychExtensionWebgazer, params: { targets: [STIM_ID] } },
    ],
    data: { task: "material", material_name: material.name },
  });

  jsPsych.run(timeline);

  // --- Bitiste: veriyi derle, normalize et, JSON indir ----------------------
  function buildAndDownload() {
    const matTrial = jsPsych.data.get().filter({ task: "material" }).values()[0] || {};
    const valTrial = jsPsych.data.get().filter({ task: "validate" }).values()[0] || {};

    const gaze = matTrial.webgazer_data || []; // [{x, y, t}] viewport px
    const targets = matTrial.webgazer_targets || {};
    const box = targets[STIM_ID] || null; // {left, top, width, height, ...}

    // Koordinatlari materyale gore normalize et (spec §6)
    const samples = gaze.map(function (s) {
      let x_norm = null, y_norm = null, in_material = false;
      if (box && box.width > 0 && box.height > 0) {
        x_norm = (s.x - box.left) / box.width;
        y_norm = (s.y - box.top) / box.height;
        in_material = x_norm >= 0 && x_norm <= 1 && y_norm >= 0 && y_norm <= 1;
      }
      return {
        t: Math.round(s.t),            // materyal baslangicindan ms
        x_px: Math.round(s.x),         // goruntu alanina gore px
        y_px: Math.round(s.y),
        x_norm: x_norm,                // materyale gore 0–1
        y_norm: y_norm,
        in_material: in_material,
      };
    });

    // Gercek ornekleme hizi (spec §6): ornek sayisi / sure
    let actual_hz = null, duration_ms = null;
    if (gaze.length >= 2) {
      duration_ms = gaze[gaze.length - 1].t - gaze[0].t;
      if (duration_ms > 0) actual_hz = +(gaze.length / (duration_ms / 1000)).toFixed(1);
    }
    const n_missing = samples.filter(function (s) { return !s.in_material; }).length;

    const payload = {
      meta: {
        app_version: APP_VERSION,
        phase: "faz1-prototype",
        created_at: new Date().toISOString(),
        user_agent: navigator.userAgent,
        screen: { width: screen.width, height: screen.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        device_pixel_ratio: window.devicePixelRatio || 1,
      },
      validation: {
        average_offset: valTrial.average_offset || null,
        percent_in_roi: valTrial.percent_in_roi || null,
        samples_per_sec: valTrial.samples_per_sec || null,
      },
      material: {
        name: material.name,
        natural_width: material.natural_width,
        natural_height: material.natural_height,
        bounding_box_px: box, // materyalin goruntu alanindaki konumu
      },
      sampling: {
        n_samples: gaze.length,
        duration_ms: duration_ms,
        actual_hz: actual_hz,
        n_outside_material: n_missing,
      },
      samples: samples,
    };

    downloadJson(payload, "goz_izleme_" + Date.now() + ".json");

    // Katilimciya kapanis ekrani
    document.body.innerHTML =
      '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;' +
      'text-align:center;line-height:1.6">' +
      "<h2>Tesekkurler!</h2>" +
      "<p>Veriniz tarayiciniza <strong>JSON dosyasi</strong> olarak indirildi.</p>" +
      "<p style='color:#777'>Toplam " + gaze.length + " bakis ornegi" +
      (actual_hz ? " · ~" + actual_hz + " Hz" : "") + "</p></div>";
  }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
})();
