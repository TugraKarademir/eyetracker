// Öğretmen canlı yayını: tek yönlü WebRTC (öğretmen -> her öğrenci).
// Sinyalleşme mevcut SSE + /api/event (type: "signal") kanalından geçer.
// Mesh yapı: öğretmen her öğrenciye ayrı akış gönderir; ~20-25 izleyiciye kadar uygundur.
window.LIVE = (() => {
  const peers = new Map();          // sid -> { pc, chain, vSender, aSender, name }
  let camStream = null, screenTrack = null, on = false;
  let floorSid = null, micLive = false;   // söz verilen öğrenci
  const outStream = new MediaStream();

  const sig = (to, data) => api("/api/event", { code: CODE, key: KEY, type: "signal", to, data }).catch(() => {});
  const curVideo = () => screenTrack || camStream?.getVideoTracks()[0] || null;
  const curAudio = () => camStream?.getAudioTracks()[0] || null;

  function updateUI() {
    $("#liveBtn").textContent = on ? "■ Yayını durdur" : "● Yayını başlat";
    $("#liveBtn").classList.toggle("primary", !on);
    $("#liveBtn").classList.toggle("danger", on);
    ["#micBtn", "#camBtn2", "#shareBtn"].forEach((s) => $(s).classList.toggle("hidden", !on));
    $("#onAir").classList.toggle("hidden", !on);
    $("#liveOff").classList.toggle("hidden", on && !!curVideo());
    const a = curAudio(), v = camStream?.getVideoTracks()[0];
    $("#micBtn").textContent = !a ? "🎙️ Mikrofon yok" : a.enabled ? "🎙️ Mikrofon açık" : "🔇 Mikrofon kapalı";
    $("#micBtn").classList.toggle("off", !a || !a.enabled);
    $("#micBtn").disabled = !a;
    $("#camBtn2").textContent = !v ? "📷 Kamera yok" : v.enabled ? "📷 Kamera açık" : "📷 Kamera kapalı";
    $("#camBtn2").classList.toggle("off", !v || !v.enabled);
    $("#camBtn2").disabled = !v;
    $("#shareBtn").textContent = screenTrack ? "🖥️ Paylaşımı bitir" : "🖥️ Ekran paylaş";
    const vid = $("#myVideo");
    vid.classList.toggle("mirror", !screenTrack);
    const connected = [...peers.values()].filter((p) => p.pc.connectionState === "connected");
    const fp = floorSid && peers.get(floorSid);
    $("#floorBar").classList.toggle("hidden", !fp);
    if (fp) $("#floorName").textContent = fp.name + (micLive ? " konuşuyor" : " — mikrofonunu açması bekleniyor…");
    $("#viewers").textContent = on ? `👁️ ${connected.length} öğrenci yayını izliyor` + (peers.size > connected.length ? ` · ${peers.size - connected.length} bağlanıyor` : "") : "";
  }

  function preview() {
    const tracks = [curVideo(), curAudio()].filter(Boolean);
    $("#myVideo").srcObject = new MediaStream(tracks.filter((t) => t.kind === "video"));
  }

  async function start() {
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e1) {
      try { camStream = await navigator.mediaDevices.getUserMedia({ audio: true }); toast("Kamera açılamadı; yalnızca ses ile yayın yapılıyor. Ekran paylaşabilirsiniz."); }
      catch (e2) { camStream = new MediaStream(); toast("Kamera ve mikrofon açılamadı. Yalnızca ekran paylaşımı kullanılabilir."); }
    }
    on = true; preview(); updateUI();
    await api("/api/event", { code: CODE, key: KEY, type: "live", on: true });   // öğrenciler "ready" gönderir
  }

  function stop(silent) {
    if (floorSid) takeFloor();
    on = false;
    peers.forEach((p, sid) => { p.pc.close(); });
    peers.clear();
    screenTrack?.stop(); screenTrack = null;
    camStream?.getTracks().forEach((t) => t.stop()); camStream = null;
    $("#myVideo").srcObject = null;
    updateUI();
    if (!silent) api("/api/event", { code: CODE, key: KEY, type: "live", on: false }).catch(() => {});
  }

  function makePeer(sid, name) {
    peers.get(sid)?.pc.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const p = { pc, chain: Promise.resolve(), name };
    p.vSender = pc.addTransceiver(curVideo() || "video", { direction: "sendonly", streams: [outStream] }).sender;
    p.aSender = pc.addTransceiver(curAudio() || "audio", { direction: "sendonly", streams: [outStream] }).sender;
    // Söz kanalı: öğrenciden mikrofon alır; diğer öğrencilere konuşanın sesini iletir
    p.fTrans = pc.addTransceiver("audio", { direction: "sendrecv", streams: [new MediaStream()] });
    if (floorSid && floorSid !== sid && peers.get(floorSid)) {
      p.fTrans.sender.replaceTrack(peers.get(floorSid).fTrans.receiver.track).catch(() => {});
    }
    let offerSent; const offerReady = new Promise((r) => (offerSent = r));
    // ICE adayları offer sunucuya ulaştıktan sonra gönderilir (sıra bozulmasın)
    pc.onicecandidate = (e) => e.candidate && offerReady.then(() => sig(sid, { kind: "ice", candidate: e.candidate.toJSON() }));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        if (peers.get(sid)?.pc === pc) { if (floorSid === sid) takeFloor(); peers.delete(sid); }
      }
      if (pc.connectionState === "disconnected") {
        setTimeout(() => { if (pc.connectionState === "disconnected" && peers.get(sid)?.pc === pc) { pc.close(); peers.delete(sid); updateUI(); } }, 10000);
      }
      updateUI();
    };
    peers.set(sid, p);
    p.chain = p.chain.then(async () => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await sig(sid, { kind: "offer", sdp: pc.localDescription.toJSON(), floorMid: p.fTrans.mid,
                       speaker: floorSid && floorSid !== sid ? peers.get(floorSid)?.name : null });
      offerSent();
    }).catch((e) => console.warn("offer", e));
    updateUI();
  }

  function onSignal(m) {
    const d = m.data, sid = m.from;
    if (d.kind === "ready") { if (on) makePeer(sid, m.name); return; }
    const p = peers.get(sid); if (!p) return;
    if (d.kind === "floor_mic") {
      if (sid !== floorSid) return;
      if (d.on) { micLive = true; toast(`🎙️ ${p.name} konuşuyor`); updateUI(); }
      else takeFloor(true);
      return;
    }
    p.chain = p.chain.then(async () => {
      if (d.kind === "answer") await p.pc.setRemoteDescription(d.sdp);
      else if (d.kind === "ice") await p.pc.addIceCandidate(d.candidate);
    }).catch((e) => console.warn("signal", d.kind, e));
  }

  function giveFloor(sid) {
    if (!on) return toast("Söz vermek için önce canlı yayını başlatın.");
    const p = peers.get(sid);
    if (!p || p.pc.connectionState !== "connected") return toast("Bu öğrenci yayına bağlı değil (demo öğrenciler konuşamaz).");
    if (floorSid) takeFloor();
    floorSid = sid; micLive = false;
    const track = p.fTrans.receiver.track;
    $("#floorAudio").srcObject = new MediaStream([track]);
    $("#floorAudio").play().catch(() => {});
    peers.forEach((o, osid) => {
      if (osid === sid) return;
      o.fTrans.sender.replaceTrack(track).catch(() => {});
      sig(osid, { kind: "speaker", name: p.name });
    });
    sig(sid, { kind: "floor", on: true });
    api("/api/event", { code: CODE, key: KEY, type: "lower_hand", id: sid }).catch(() => {});
    updateUI();
  }

  function takeFloor(byStudent) {
    if (!floorSid) return;
    const sid = floorSid, name = peers.get(sid)?.name || "Öğrenci";
    floorSid = null; micLive = false;
    $("#floorAudio").srcObject = null;
    peers.forEach((o, osid) => {
      o.fTrans.sender.replaceTrack(null).catch(() => {});
      if (osid !== sid) sig(osid, { kind: "speaker", name: null });
    });
    if (!byStudent) sig(sid, { kind: "floor", on: false });
    else toast(`${name} sözünü bitirdi`);
    updateUI();
  }

  function swapVideo() {
    const t = curVideo();
    peers.forEach((p) => p.vSender.replaceTrack(t).catch(() => {}));
    preview(); updateUI();
  }

  async function toggleShare() {
    if (screenTrack) { screenTrack.stop(); screenTrack = null; return swapVideo(); }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      screenTrack = s.getVideoTracks()[0];
      screenTrack.contentHint = "detail";
      screenTrack.onended = () => { screenTrack = null; swapVideo(); };
      swapVideo();
    } catch (e) { if (e.name !== "NotAllowedError") toast("Ekran paylaşılamadı: " + e.message); }
  }

  // Sayfa yenilendiğinde yayın akışı kaybolur; sunucudaki durumu düzelt.
  let checked = false;
  function onServerState(live) {
    if (!checked) { checked = true; if (live && !on) api("/api/event", { code: CODE, key: KEY, type: "live", on: false }).catch(() => {}); }
    updateUI();
  }

  $("#liveBtn").onclick = () => (on ? stop() : start().catch((e) => toast(e.message)));
  $("#micBtn").onclick = () => { const a = curAudio(); if (a) { a.enabled = !a.enabled; updateUI(); } };
  $("#camBtn2").onclick = () => { const v = camStream?.getVideoTracks()[0]; if (v) { v.enabled = !v.enabled; updateUI(); } };
  $("#shareBtn").onclick = toggleShare;
  $("#takeFloorBtn").onclick = () => takeFloor();
  addEventListener("pagehide", () => { if (on) navigator.sendBeacon?.("/api/event", new Blob([JSON.stringify({ code: CODE, key: KEY, type: "live", on: false })], { type: "application/json" })); });

  updateUI();
  return { onSignal, onServerState, stop, start, peers, giveFloor, takeFloor,
           get floorSid() { return floorSid; }, get on() { return on; } };
})();
