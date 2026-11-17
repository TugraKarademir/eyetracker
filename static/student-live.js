// Öğrenci: öğretmenin canlı yayınını alır. Öğrencinin görüntüsü hiçbir zaman gönderilmez.
// Söz kanalı: öğretmen söz verdiğinde öğrenci, kendi onayıyla mikrofonunu açar; sesi
// öğretmene gider ve öğretmen tarafından diğer öğrencilere iletilir.
window.LIVE = (() => {
  let pc = null, chain = Promise.resolve(), live = false;
  let floorMid = null, floorTrans = null, micTrack = null, hasFloor = false;
  const video = $("#teacherVideo"), floorAudio = $("#floorAudio");
  const sig = (data) => api("/api/event", { code: CODE, sid: SID, type: "signal", data }).catch(() => {});

  function status(msg) {
    $("#tvOff").classList.toggle("hidden", !msg);
    if (msg) $("#tvMsg").textContent = msg;
  }

  function close() {
    pc?.close(); pc = null; chain = Promise.resolve(); floorTrans = null;
    video.srcObject = null; floorAudio.srcObject = null;
    $("#unmuteBtn").classList.add("hidden");
    setSpeaker(null);
  }

  function setLive(on) {
    live = on;
    if (!on && hasFloor) endFloor(false);
    close();
    if (on) { status("Yayına bağlanılıyor…"); sig({ kind: "ready" }); }
    else status("Öğretmen henüz yayın başlatmadı");
  }

  async function play() {
    try {
      video.muted = false; await video.play();
      floorAudio.play().catch(() => {});
      $("#unmuteBtn").classList.add("hidden");
    } catch {                       // tarayıcı sesli otomatik oynatmayı engelledi
      video.muted = true; video.play().catch(() => {});
      $("#unmuteBtn").classList.remove("hidden");
    }
  }

  function setSpeaker(name) {
    $("#speakerPill").classList.toggle("hidden", !name);
    if (name) $("#speakerName").textContent = name + " konuşuyor";
  }

  // ---- söz kanalı ----
  function renderFloor() {
    $("#floorCard").classList.toggle("hidden", !hasFloor);
    $("#micOnBtn").classList.toggle("hidden", !!micTrack);
    $("#micLive").classList.toggle("hidden", !micTrack);
    $("#muteBtn").textContent = micTrack && !micTrack.enabled ? "🎙️ Sesi aç" : "🔇 Sessize al";
  }

  async function openMic() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      micTrack = s.getAudioTracks()[0];
    } catch (e) {
      toast("Mikrofona erişilemedi: " + (e.name === "NotAllowedError" ? "izin reddedildi." : e.message), 6000);
      return;
    }
    if (!hasFloor) { micTrack.stop(); micTrack = null; return; }   // bu arada söz geri alındıysa
    await floorTrans?.sender.replaceTrack(micTrack).catch(() => {});
    sig({ kind: "floor_mic", on: true });
    renderFloor();
  }

  function stopMic() {
    floorTrans?.sender.replaceTrack(null).catch(() => {});
    micTrack?.stop(); micTrack = null;
  }

  function endFloor(notify) {
    hasFloor = false; stopMic(); renderFloor();
    if (notify) sig({ kind: "floor_mic", on: false });
  }

  function onSignal(d) {
    if (d.kind === "offer") {
      close();
      pc = new RTCPeerConnection(RTC_CONFIG);
      floorMid = d.floorMid ?? null;
      const ms = new MediaStream();
      video.srcObject = ms;
      pc.ontrack = (e) => {
        if (floorMid != null && e.transceiver.mid === floorMid) {
          floorAudio.srcObject = new MediaStream([e.track]);
          floorAudio.play().catch(() => {});
          return;
        }
        ms.addTrack(e.track); status(null); play();
      };
      let answerSent; const answerReady = new Promise((r) => (answerSent = r));
      pc.onicecandidate = (e) => e.candidate && answerReady.then(() => sig({ kind: "ice", candidate: e.candidate.toJSON() }));
      const mine = pc;
      pc.onconnectionstatechange = () => {
        if (pc !== mine) return;
        const s = pc.connectionState;
        if (s === "connected") status(null);
        else if (s === "failed") { status("Bağlantı koptu, yeniden deneniyor…"); setTimeout(() => live && pc === mine && setLive(true), 2000); }
        else if (s === "disconnected") status("Bağlantı zayıf…");
      };
      if (d.speaker) setSpeaker(d.speaker);
      chain = chain.then(async () => {
        await mine.setRemoteDescription(d.sdp);
        floorTrans = mine.getTransceivers().find((t) => t.mid === floorMid) || null;
        if (floorTrans) {
          floorTrans.direction = "sendrecv";                       // mikrofon gerektiğinde bu kanaldan gider
          if (micTrack) await floorTrans.sender.replaceTrack(micTrack);
        }
        await mine.setLocalDescription(await mine.createAnswer());
        await sig({ kind: "answer", sdp: mine.localDescription.toJSON() });
        answerSent();
      }).catch((e) => console.warn("answer", e));
    } else if (d.kind === "ice" && pc) {
      const mine = pc;
      chain = chain.then(() => mine.addIceCandidate(d.candidate)).catch((e) => console.warn("ice", e));
    } else if (d.kind === "floor") {
      if (d.on) {
        hasFloor = true; renderFloor();
        toast("🎙️ Öğretmen size söz verdi. Konuşmak için mikrofonunuzu açın.", 6000);
      } else if (hasFloor) {
        endFloor(false); toast("Söz süreniz bitti.");
      }
    } else if (d.kind === "speaker") {
      setSpeaker(d.name);
    }
  }

  $("#unmuteBtn").onclick = play;
  // Sinema modu (CSS): tarayıcı tam ekranından farklı olarak pencere boyutunu değiştirmez,
  // böylece bakış kalibrasyonu geçerli kalır.
  $("#fsBtn").onclick = () => document.body.classList.toggle("theater");
  addEventListener("keydown", (e) => { if (e.key === "Escape") document.body.classList.remove("theater"); });
  $("#micOnBtn").onclick = openMic;
  $("#muteBtn").onclick = () => { if (micTrack) { micTrack.enabled = !micTrack.enabled; renderFloor(); } };
  $("#endFloorBtn").onclick = () => endFloor(true);
  return { setLive, onSignal, get pc() { return pc; }, get hasFloor() { return hasFloor; }, get micTrack() { return micTrack; } };
})();
