/*
 * Faz 2 — Cok materyalli calisma + sunucuya kayit (jsPsych + WebGazer)
 *
 * Akis: onam -> cihaz kontrolu -> tam ekran -> kamera -> kalibrasyon (9) ->
 *       dogrulama (5) -> [her materyal: odak artisi + materyal ("Devam")] ->
 *       veriyi SUNUCUYA gonder (hata olursa yeniden dene + localStorage yedek + JSON indir).
 *
 * KURAL (spec §6, §15): Kamera goruntusu kaydedilmez/gonderilmez; yalnizca
 * bakis koordinatlari. Takip tuzaklari icin bkz. [[webgazer-jspsych-surum]].
 */
(function () {
  "use strict";

  const APP_VERSION = "0.6.1-faz6";
  const MIN_W = 1280;
  const MIN_H = 720;
  const STIM_ID = "#jspsych-image-button-response-stimulus";

  const study = JSON.parse(document.getElementById("study-data").textContent);
  const materials = JSON.parse(document.getElementById("materials-data").textContent);
  const api = JSON.parse(document.getElementById("api-data").textContent);

  console.log("Calisma JS surumu:", APP_VERSION, "| materyal:", materials.length);

  // Calisan surum rozeti
  try {
    const badge = document.createElement("div");
    badge.textContent = "v" + APP_VERSION;
    badge.style.cssText =
      "position:fixed;right:6px;bottom:6px;z-index:99999;font:11px system-ui," +
      "sans-serif;color:#999;background:rgba(255,255,255,.7);padding:2px 6px;" +
      "border-radius:4px;pointer-events:none";
    if (document.body) document.body.appendChild(badge);
  } catch (e) { /* yok say */ }

  // --- yardimcilar -----------------------------------------------------------
  function getCookie(name) {
    const m = document.cookie.match("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)");
    return m ? decodeURIComponent(m.pop()) : "";
  }

  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function postWithRetry(url, body, retries) {
    return postJSON(url, body).catch(function (err) {
      if (retries > 0) {
        return new Promise(function (res) { setTimeout(res, 1000); })
          .then(function () { return postWithRetry(url, body, retries - 1); });
      }
      throw err;
    });
  }

  function measureBox() {
    const el = document.querySelector(STIM_ID);
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }
    }
    return null;
  }

  function deviceIssue() {
    const ua = navigator.userAgent;
    const isEdge = /Edg\//.test(ua);
    const isChrome = /Chrome\//.test(ua) && !/OPR\//.test(ua);
    if (!(isChrome || isEdge)) return "Bu calisma yalnizca masaustu Chrome veya Edge'de desteklenir.";
    if (/Mobi|Android|iPhone|iPad|iPod/.test(ua)) return "Bu calisma mobil cihaz/tablette yapilamaz.";
    if (window.innerWidth < MIN_W || window.innerHeight < MIN_H) {
      return "Ekran/pencere alani cok kucuk (" + window.innerWidth + "x" + window.innerHeight +
        "). En az " + MIN_W + "x" + MIN_H + " gereklidir.";
    }
    return null;
  }

  function showBlock(message) {
    const el = document.getElementById("engel");
    el.innerHTML = "<h1>Devam edilemiyor</h1><p>" + message + "</p>";
    el.style.display = "block";
  }

  // --- on kontroller ---------------------------------------------------------
  if (!materials.length) {
    showBlock("Bu calismada henuz materyal yok. Lutfen daha sonra tekrar deneyin.");
    return;
  }
  const issue = deviceIssue();
  if (issue) { showBlock(issue); return; }

  // Her oturum temiz kalibrasyonla baslasin
  try {
    if (typeof webgazer !== "undefined" && webgazer.saveDataAcrossSessions) {
      webgazer.saveDataAcrossSessions(false);
    }
  } catch (e) { console.warn("saveDataAcrossSessions:", e); }
  try {
    localStorage.removeItem("webgazerGlobalData");
    localStorage.removeItem("webgazerGlobalSettings");
  } catch (e) { /* yok say */ }

  // --- oturumu BASLAT (asenkron; sonda beklenir) -----------------------------
  const device = {
    user_agent: navigator.userAgent,
    screen_width: screen.width,
    screen_height: screen.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    device_pixel_ratio: window.devicePixelRatio || 1,
  };
  const sessionPromise = postWithRetry(api.start, { study_code: study.code, device: device }, 2)
    .then(function (res) { return res.session_id; })
    .catch(function (err) { console.error("Oturum baslatilamadi:", err); return null; });

  // Toplanan veriler
  const allSamples = []; // {material_id, t, x_px, y_px, x_norm, y_norm, in_material}
  let validationResult = null;
  const midChecks = [];  // ara kontroller (spec §5.8)

  // Materyal adiminda gecici toplayici
  let matStart = null, matSamples = [], matBox = null, unsubscribeGaze = null;

  // --- jsPsych ---------------------------------------------------------------
  const jsPsych = initJsPsych({
    extensions: [{ type: jsPsychExtensionWebgazer, params: { webgazer: webgazer } }],
    on_finish: function () { finishAndUpload(); },
  });

  const timeline = [];

  // 1) Onam
  timeline.push({
    type: jsPsychHtmlButtonResponse,
    stimulus:
      '<div style="max-width:720px;margin:0 auto;text-align:left;line-height:1.6">' +
      "<h2>Bilgilendirilmis Onam</h2>" +
      "<p><strong>" + escapeHtml(study.name) + "</strong> calismasina hos geldiniz. " +
      "Ekranda gosterilen materyalleri incelerken bilgisayarinizin <strong>web kamerasi</strong> " +
      "araciligiyla ekranin nerelerine baktiginiz tahmin edilecektir.</p>" +
      "<p><strong>Kamera goruntunuz kaydedilmez ve hicbir yere gonderilmez.</strong> " +
      "Yalnizca tahmini bakis koordinatlari toplanir. Katilim gonulludur.</p>" +
      "<p>Devam etmek icin onayinizi veriniz.</p></div>",
    choices: ["Onayliyorum", "Onaylamiyorum"],
    on_finish: function (data) {
      if (data.response === 1) {
        jsPsych.abortExperiment("Onam verilmedigi icin calisma sonlandirildi. Tesekkurler.");
      }
    },
  });

  // 2) Ortam yonergesi + tam ekran
  timeline.push({
    type: jsPsychFullscreen,
    message:
      '<div style="max-width:680px;margin:0 auto;line-height:1.6">' +
      "<h2>Baslamadan once</h2><ul style='text-align:left'>" +
      "<li>Yuzunuze <strong>onden</strong> gelen iyi bir isik olsun; arkanizda pencere olmasin.</li>" +
      "<li>Ekrana <strong>50–70 cm</strong> mesafede, dik oturun.</li>" +
      "<li>Kamera ekranin <strong>ust</strong> kenarinda olsun.</li>" +
      "<li>Calisma boyunca basinizi sabit tutun.</li></ul></div>",
    button_label: "Tam ekrana gec",
  });

  // 3) Kamera baslatma
  timeline.push({
    type: jsPsychWebgazerInitCamera,
    instructions:
      '<div style="max-width:680px;margin:0 auto;line-height:1.6">' +
      "<p>Kamera erisimine izin verin ve yuzunuzu kamerada <strong>ortalayin</strong>. " +
      "Yuz noktalari yesile dondugunde hazirsiniz.</p></div>",
  });

  // 4) Kalibrasyon: 13 nokta x 2 tekrar (daha iyi regresyon, ozellikle yatay)
  timeline.push({
    type: jsPsychWebgazerCalibrate,
    calibration_points: [
      [10, 10], [50, 10], [90, 10],
      [30, 30], [70, 30],
      [10, 50], [50, 50], [90, 50],
      [30, 70], [70, 70],
      [10, 90], [50, 90], [90, 90],
    ],
    calibration_mode: "click",
    repetitions_per_point: 2,
    randomize_calibration_order: true,
  });

  // 5) Dogrulama (5 nokta)
  timeline.push({
    type: jsPsychWebgazerValidate,
    validation_points: [[50, 50], [20, 20], [80, 20], [20, 80], [80, 80]],
    validation_point_coordinates: "percent",
    roi_radius: 200,
    time_to_saccade: 1000,
    validation_duration: 2000,
    data: { task: "validate" },
    on_finish: function (data) {
      validationResult = summarizeValidation(data);
      console.log("Dogrulama:", validationResult);
    },
  });

  // 6) Her materyal: odak artisi + materyal
  materials.forEach(function (mat, idx) {
    timeline.push({
      type: jsPsychHtmlKeyboardResponse,
      stimulus: '<div style="font-size:64px">+</div>',
      choices: "NO_KEYS",
      trial_duration: 1000,
    });

    timeline.push({
      type: jsPsychImageButtonResponse,
      stimulus: mat.src,
      maintain_aspect_ratio: true,
      stimulus_height: Math.min(mat.natural_height, Math.round(window.innerHeight * 0.9)),
      render_on_canvas: false,
      choices: ["Devam"],
      prompt: "<p style='color:#777'>Materyali inceledikten sonra <strong>Devam</strong> deyin.</p>",
      extensions: [{ type: jsPsychExtensionWebgazer, params: { targets: [STIM_ID] } }],
      data: { task: "material", material_id: mat.id },
      on_load: function () {
        matStart = performance.now();
        matSamples = [];
        matBox = null;
        // KRITIK: dogrulama sonrasi webgazer pause halde; resume sart
        try { jsPsych.extensions.webgazer.resume(); } catch (e) { console.error("resume:", e); }
        try {
          unsubscribeGaze = jsPsych.extensions.webgazer.onGazeUpdate(function (g) {
            if (g && typeof g.x === "number" && typeof g.y === "number") {
              matSamples.push({ x: g.x, y: g.y, t: Math.round(performance.now() - matStart) });
            }
          });
        } catch (e) { console.error("gaze dinleyici:", e); }
        const img = document.querySelector(STIM_ID);
        const grab = function () { const b = measureBox(); if (b) matBox = b; };
        if (img && img.complete && img.naturalWidth > 0) grab();
        else if (img) img.addEventListener("load", grab, { once: true });
        let tries = 0;
        const retry = setInterval(function () { if ((grab(), matBox) || ++tries > 10) clearInterval(retry); }, 150);
      },
      on_finish: function () {
        if (!matBox) matBox = measureBox();
        if (unsubscribeGaze) { try { unsubscribeGaze(); } catch (e) {} unsubscribeGaze = null; }
        try { jsPsych.extensions.webgazer.pause(); } catch (e) {}
        // Bu materyalin orneklerini normalize edip biriktir
        const box = matBox;
        matSamples.forEach(function (s) {
          let xn = null, yn = null, inm = false;
          if (box && box.width > 0 && box.height > 0) {
            xn = +((s.x - box.left) / box.width).toFixed(4);
            yn = +((s.y - box.top) / box.height).toFixed(4);
            inm = xn >= 0 && xn <= 1 && yn >= 0 && yn <= 1;
          }
          allSamples.push({
            material_id: mat.id, t: s.t,
            x_px: Math.round(s.x), y_px: Math.round(s.y),
            x_norm: xn, y_norm: yn, in_material: inm,
          });
        });
      },
    });

    // Ara kontrol (spec §5.8): her 3 materyalde bir tek noktali hizli dogrulama
    if ((idx + 1) % 3 === 0 && idx + 1 < materials.length) {
      timeline.push({
        type: jsPsychWebgazerValidate,
        validation_points: [[50, 50]],
        validation_point_coordinates: "percent",
        roi_radius: 200,
        time_to_saccade: 800,
        validation_duration: 1500,
        data: { task: "midcheck" },
        on_finish: function (data) {
          const v = summarizeValidation(data);
          v.attempt_no = 2 + midChecks.length;
          midChecks.push(v);
          if (v.avg_error_px != null && !v.passed) {
            console.warn("Ara kontrol: dogruluk dustu, yeniden kalibrasyon onerilebilir.");
          }
        },
      });
      // Yalnizca hata buyudiyse nazik bir hatirlatma goster (yeniden kalibrasyon onerisi)
      timeline.push({
        timeline: [{
          type: jsPsychHtmlButtonResponse,
          stimulus: "<div style='max-width:620px;margin:0 auto;line-height:1.6'>" +
            "<h3>Kisa hatirlatma</h3><p>Takip dogrulugu bir miktar dustu. Lutfen " +
            "basinizi ekrana gore <strong>ortalayin</strong> ve sabit tutun; " +
            "isigin yuzunuze onden geldiginden emin olun.</p></div>",
          choices: ["Devam"],
        }],
        conditional_function: function () {
          return midChecks.length && !midChecks[midChecks.length - 1].passed;
        },
      });
    }
  });

  jsPsych.run(timeline);

  // --- bitiste: sunucuya gonder ----------------------------------------------
  function finishAndUpload() {
    document.body.innerHTML =
      '<div id="son" style="font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;' +
      'text-align:center;line-height:1.6"><h2>Veriler kaydediliyor…</h2>' +
      "<p style='color:#777'>Lutfen pencereyi kapatmayin.</p></div>";

    const payload = {
      calibrations: (validationResult ? [validationResult] : []).concat(midChecks),
      samples: allSamples,
    };

    sessionPromise.then(function (sessionId) {
      if (!sessionId) throw new Error("Oturum yok");
      const dataUrl = api.data_tmpl.replace("__ID__", sessionId);
      const finishUrl = api.finish_tmpl.replace("__ID__", sessionId);
      return postWithRetry(dataUrl, payload, 3).then(function (res) {
        return postWithRetry(finishUrl, { status: "completed" }, 3).then(function () { return res; });
      });
    }).then(function (res) {
      setSon("<h2>Tesekkurler!</h2><p>Veriniz kaydedildi.</p>" +
        "<p style='color:#777'>" + (res.saved_samples || allSamples.length) + " bakis ornegi</p>");
    }).catch(function (err) {
      console.error("Sunucuya gonderim basarisiz:", err);
      // Yedek: localStorage + JSON indir
      backupLocally(payload);
      downloadJson({ meta: { app_version: APP_VERSION, study: study.code }, data: payload },
        "goz_izleme_yedek_" + Date.now() + ".json");
      setSon("<h2>Baglanti sorunu</h2><p>Veriniz sunucuya gonderilemedi ama " +
        "<strong>bilgisayariniza yedeklendi</strong> (JSON indirildi). Lutfen bu dosyayi arastirmaciya iletin.</p>");
    });
  }

  function setSon(html) {
    const el = document.getElementById("son");
    if (el) el.innerHTML = html;
  }

  function backupLocally(payload) {
    try {
      localStorage.setItem("goz_izleme_yedek_" + Date.now(), JSON.stringify(payload));
    } catch (e) { /* kota dolu olabilir */ }
  }

  function downloadJson(obj, filename) {
    try {
      const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { /* yok say */ }
  }

  function summarizeValidation(data) {
    // average_offset: her nokta icin {x, y, r}. Ortalama oklit ofseti (px).
    let avgPx = null;
    const arr = data.average_offset;
    if (Array.isArray(arr) && arr.length) {
      let sum = 0, n = 0;
      arr.forEach(function (p) {
        if (p && typeof p.x === "number" && typeof p.y === "number") {
          sum += Math.sqrt(p.x * p.x + p.y * p.y); n++;
        }
      });
      if (n) avgPx = +(sum / n).toFixed(1);
    }
    const vw = window.innerWidth || 1280;
    const avgNorm = avgPx != null ? +(avgPx / vw).toFixed(4) : null;
    // Varsayilan esik: goruntu alani genisliginin %10'u (spec §7)
    const passed = avgPx != null ? avgPx <= 0.10 * vw : false;
    return {
      attempt_no: 1,
      avg_error_px: avgPx,
      avg_error_norm: avgNorm,
      precision: typeof data.percent_in_roi === "number" ? data.percent_in_roi : null,
      passed: passed,
    };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
