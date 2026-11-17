/*
 * Faz 3 — AOI cizim araci (HTML Canvas).
 * Dikdortgen (surukle) ve cokgen (tikla + tamamla) ciz; koordinatlar materyale
 * gore 0-1 normalize saklanir. Kaydet -> sunucuya POST (cakisma uyarisi doner).
 */
(function () {
  "use strict";

  const material = JSON.parse(document.getElementById("material-data").textContent);
  let aois = JSON.parse(document.getElementById("aois-data").textContent); // {name,shape,coords,color}

  const img = document.getElementById("mat");
  const canvas = document.getElementById("overlay");
  const ctx = canvas.getContext("2d");
  const listEl = document.getElementById("aoi-list");
  const nameEl = document.getElementById("aoi-name");
  const colorEl = document.getElementById("aoi-color");
  const durumEl = document.getElementById("durum");
  const uyariEl = document.getElementById("uyari");
  const polyFinishBtn = document.getElementById("poly-finish");

  const MAX_W = 900;
  let mode = "rect";       // "rect" | "poly"
  let dispW = 0, dispH = 0;
  // cizim durumu
  let dragging = false, startPt = null, curPt = null;
  let polyPoints = [];     // canvas px [[x,y],...]

  function setMode(m) {
    mode = m;
    document.getElementById("tool-rect").classList.toggle("aktif", m === "rect");
    document.getElementById("tool-poly").classList.toggle("aktif", m === "poly");
    polyFinishBtn.style.display = m === "poly" ? "" : "none";
    polyPoints = [];
    redraw();
  }

  const isVideo = !!material.is_video;
  function srcW() { return isVideo ? img.videoWidth : img.naturalWidth; }
  function srcH() { return isVideo ? img.videoHeight : img.naturalHeight; }

  function sizeCanvas() {
    const scale = Math.min(1, MAX_W / (material.natural_width || srcW() || MAX_W));
    dispW = Math.round((material.natural_width || srcW()) * scale);
    dispH = Math.round((material.natural_height || srcH()) * scale);
    img.style.width = dispW + "px";
    img.style.height = dispH + "px";
    canvas.width = dispW;
    canvas.height = dispH;
    canvas.style.width = dispW + "px";
    canvas.style.height = dispH + "px";
    redraw();
  }

  // --- koordinat donusumleri (canvas px <-> normalize 0-1) ---
  function toNormX(px) { return +(px / dispW).toFixed(4); }
  function toNormY(px) { return +(px / dispH).toFixed(4); }
  function toPxX(n) { return n * dispW; }
  function toPxY(n) { return n * dispH; }

  function canvasPos(evt) {
    const r = canvas.getBoundingClientRect();
    return [
      Math.max(0, Math.min(dispW, evt.clientX - r.left)),
      Math.max(0, Math.min(dispH, evt.clientY - r.top)),
    ];
  }

  // --- cizim ---
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    aois.forEach(function (a) { drawAoi(a); });

    // devam eden dikdortgen onizleme
    if (mode === "rect" && dragging && startPt && curPt) {
      const x = Math.min(startPt[0], curPt[0]), y = Math.min(startPt[1], curPt[1]);
      const w = Math.abs(curPt[0] - startPt[0]), h = Math.abs(curPt[1] - startPt[1]);
      strokeFillRect(x, y, w, h, colorEl.value);
    }
    // devam eden cokgen
    if (mode === "poly" && polyPoints.length) {
      ctx.beginPath();
      ctx.moveTo(polyPoints[0][0], polyPoints[0][1]);
      for (let i = 1; i < polyPoints.length; i++) ctx.lineTo(polyPoints[i][0], polyPoints[i][1]);
      ctx.strokeStyle = colorEl.value;
      ctx.lineWidth = 2;
      ctx.stroke();
      polyPoints.forEach(function (p) {
        ctx.fillStyle = colorEl.value;
        ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, 2 * Math.PI); ctx.fill();
      });
    }
  }

  function hexA(hex, alpha) {
    // #rrggbb -> rgba
    const r = parseInt(hex.substr(1, 2), 16), g = parseInt(hex.substr(3, 2), 16), b = parseInt(hex.substr(5, 2), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function strokeFillRect(x, y, w, h, color) {
    ctx.fillStyle = hexA(color, 0.18);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawAoi(a) {
    ctx.save();
    if (a.shape === "rect") {
      const c = a.coords || {};
      strokeFillRect(toPxX(c.x), toPxY(c.y), toPxX(c.w), toPxY(c.h), a.color);
      label(a.name, toPxX(c.x) + 4, toPxY(c.y) + 14, a.color);
    } else {
      const pts = (a.coords && a.coords.points) || [];
      if (pts.length) {
        ctx.beginPath();
        ctx.moveTo(toPxX(pts[0][0]), toPxY(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(toPxX(pts[i][0]), toPxY(pts[i][1]));
        ctx.closePath();
        ctx.fillStyle = hexA(a.color, 0.18); ctx.fill();
        ctx.strokeStyle = a.color; ctx.lineWidth = 2; ctx.stroke();
        label(a.name, toPxX(pts[0][0]) + 4, toPxY(pts[0][1]) + 14, a.color);
      }
    }
    ctx.restore();
  }

  function label(text, x, y, color) {
    ctx.font = "12px system-ui, sans-serif";
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillRect(x - 2, y - 12, w, 16);
    ctx.fillStyle = color;
    ctx.fillText(text, x + 2, y);
  }

  // --- olaylar ---
  canvas.addEventListener("mousedown", function (e) {
    if (mode !== "rect") return;
    dragging = true; startPt = canvasPos(e); curPt = startPt;
  });
  canvas.addEventListener("mousemove", function (e) {
    if (mode === "rect" && dragging) { curPt = canvasPos(e); redraw(); }
  });
  window.addEventListener("mouseup", function (e) {
    if (mode === "rect" && dragging) {
      dragging = false;
      const p = curPt || startPt;
      const x = Math.min(startPt[0], p[0]), y = Math.min(startPt[1], p[1]);
      const w = Math.abs(p[0] - startPt[0]), h = Math.abs(p[1] - startPt[1]);
      if (w > 5 && h > 5) {
        aois.push({
          name: aoiName(), shape: "rect", color: colorEl.value,
          coords: { x: toNormX(x), y: toNormY(y), w: toNormX(w), h: toNormY(h) },
        });
        renderList(); redraw();
      }
      startPt = curPt = null;
    }
  });
  canvas.addEventListener("click", function (e) {
    if (mode !== "poly") return;
    polyPoints.push(canvasPos(e)); redraw();
  });
  polyFinishBtn.addEventListener("click", function () {
    if (mode === "poly" && polyPoints.length >= 3) {
      aois.push({
        name: aoiName(), shape: "polygon", color: colorEl.value,
        coords: { points: polyPoints.map(function (p) { return [toNormX(p[0]), toNormY(p[1])]; }) },
      });
      polyPoints = []; renderList(); redraw();
    }
  });
  document.getElementById("undo").addEventListener("click", function () {
    if (mode === "poly" && polyPoints.length) { polyPoints.pop(); redraw(); return; }
    aois.pop(); renderList(); redraw();
  });
  document.getElementById("tool-rect").addEventListener("click", function () { setMode("rect"); });
  document.getElementById("tool-poly").addEventListener("click", function () { setMode("poly"); });

  function aoiName() {
    const n = (nameEl.value || "").trim();
    return n || "AOI " + (aois.length + 1);
  }

  function renderList() {
    listEl.innerHTML = "";
    aois.forEach(function (a, i) {
      const li = document.createElement("li");
      const sw = document.createElement("span");
      sw.className = "swatch"; sw.style.background = a.color;
      const nm = document.createElement("span"); nm.textContent = a.name + " (" + a.shape + ")";
      const del = document.createElement("button");
      del.className = "sil"; del.textContent = "✕"; del.title = "Sil";
      del.addEventListener("click", function () { aois.splice(i, 1); renderList(); redraw(); });
      li.appendChild(sw); li.appendChild(nm); li.appendChild(del);
      listEl.appendChild(li);
    });
  }

  document.getElementById("save").addEventListener("click", function () {
    durumEl.textContent = "Kaydediliyor…"; uyariEl.style.display = "none";
    fetch(window.SAVE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF },
      body: JSON.stringify({ aois: aois, natural_width: srcW() || 0, natural_height: srcH() || 0 }),
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { durumEl.textContent = ""; showUyari([res.j.error || "Kaydedilemedi"]); return; }
        durumEl.textContent = res.j.saved + " AOI kaydedildi.";
        if (res.j.warnings && res.j.warnings.length) showUyari(res.j.warnings);
      }).catch(function (e) { durumEl.textContent = ""; showUyari(["Ag hatasi: " + e.message]); });
  });

  function showUyari(msgs) {
    uyariEl.innerHTML = "<strong>Uyarı:</strong><br>" + msgs.join("<br>");
    uyariEl.style.display = "block";
  }

  // --- baslat ---
  if (isVideo) {
    const seek = document.getElementById("seek");
    const seekTime = document.getElementById("seek-time");
    seek.addEventListener("input", function () {
      if (!img.duration || !isFinite(img.duration)) return;
      img.currentTime = img.duration * (seek.value / 1000);
      seekTime.textContent = img.currentTime.toFixed(1) + " sn";
    });
    img.addEventListener("loadedmetadata", sizeCanvas);
    // Gelistirme sunucusu (static serve) HTTP Range desteklemez -> Chrome ileri saramaz.
    // Videoyu tamamen indirip blob URL ile oynat: ileri sarma bellekte yapilir.
    durumEl.textContent = "Video yükleniyor…";
    fetch(material.src).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    }).then(function (b) {
      img.src = URL.createObjectURL(b);
      durumEl.textContent = "";
    }).catch(function (e) {
      img.src = material.src;  // yedek: en azindan ilk kare
      durumEl.textContent = "";
      showUyari(["Video tam yüklenemedi, ileri sarma çalışmayabilir: " + e.message]);
    });
  } else if (img.complete && img.naturalWidth) sizeCanvas();
  else img.addEventListener("load", sizeCanvas);
  window.addEventListener("resize", sizeCanvas);
  renderList();
})();
