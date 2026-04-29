// ============================================================
// voice.js — STT + TTS (Rate-Limited, Robust)
// ============================================================

const VoiceEngine = (() => {
  // ── TTS State ────────────────────────────────────────────
  let ttsVoice = null;
  let sarvamTTSAvailable = true;
  let sarvamSTTCooldown = false;
  let lastSarvamSTTCall = 0;
  const SARVAM_STT_MIN_INTERVAL = 8000; // min 8s between Sarvam STT calls

  function initTTSVoice() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    const preferred = ['Google UK English Female', 'Google हिन्दी', 'Microsoft Zira', 'Samantha'];
    for (const name of preferred) {
      const v = voices.find((v) => v.name.includes(name));
      if (v) { ttsVoice = v; return; }
    }
    const enIn = voices.find((v) => v.lang === 'en-IN');
    if (enIn) { ttsVoice = enIn; return; }
    const enUs = voices.find((v) => v.lang.startsWith('en'));
    if (enUs) ttsVoice = enUs;
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = initTTSVoice;
    initTTSVoice();
  }

  // ── Sarvam TTS ───────────────────────────────────────────
  async function sarvamSpeak(text) {
    try {
      const res = await fetch('/api/sarvam-tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language: 'en-IN' }),
      });
      if (!res.ok) {
        console.warn('[TTS] Sarvam returned', res.status);
        if (res.status === 429) return false; // rate limited, try browser
        sarvamTTSAvailable = false;
        return false;
      }
      const data = await res.json();
      const audioBase64 = data.audios?.[0];
      if (!audioBase64) { sarvamTTSAvailable = false; return false; }
      await playBase64Audio(audioBase64);
      return true;
    } catch (err) {
      console.warn('[TTS] Sarvam error:', err.message);
      return false;
    }
  }

  function playBase64Audio(base64) {
    return new Promise((resolve) => {
      try {
        const audio = new Audio('data:audio/wav;base64,' + base64);
        const timer = setTimeout(() => { try { audio.pause(); } catch {} resolve(); }, 30000);
        audio.onended = () => { clearTimeout(timer); resolve(); };
        audio.onerror = () => { clearTimeout(timer); resolve(); };
        audio.play().catch(() => { clearTimeout(timer); resolve(); });
      } catch { resolve(); }
    });
  }

  // ── Browser TTS fallback ─────────────────────────────────
  function browserSpeak(text) {
    return new Promise((resolve) => {
      if (!window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.85;
      utt.pitch = 1.0;
      if (ttsVoice) utt.voice = ttsVoice;
      const timer = setTimeout(() => resolve(), 20000);
      utt.onend = () => { clearTimeout(timer); resolve(); };
      utt.onerror = () => { clearTimeout(timer); resolve(); };
      window.speechSynthesis.speak(utt);
    });
  }

  // ── speak — ONCE by default ──────────────────────────────
  async function speak(text, times = 1) {
    for (let i = 0; i < times; i++) {
      if (i > 0) await delay(400);
      let spoken = false;
      if (sarvamTTSAvailable) {
        spoken = await sarvamSpeak(text);
      }
      if (!spoken) {
        await browserSpeak(text);
      }
    }
    // Wait a bit after speaking so mic doesn't pick up echo
    await delay(600);
  }

  function speakOnce(text) { return speak(text, 1); }
  function stopSpeaking() { if (window.speechSynthesis) window.speechSynthesis.cancel(); }

  // ── STT — Web Speech API ─────────────────────────────────
  let recognition = null;
  let sttTimeout = null;

  function initRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = 'en-IN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    return rec;
  }

  function listen(timeout = 8000) {
    return new Promise((resolve) => {
      // Stop any ongoing TTS first to free audio
      if (window.speechSynthesis) window.speechSynthesis.cancel();

      recognition = initRecognition();
      if (!recognition) {
        console.warn('[STT] Not available');
        resolve(null);
        return;
      }

      let settled = false;
      function settle(result) {
        if (settled) return;
        settled = true;
        clearTimeout(sttTimeout);
        try { recognition.stop(); } catch {}
        resolve(result);
      }

      sttTimeout = setTimeout(() => {
        console.log('[STT] Timeout');
        settle(null);
      }, timeout);

      recognition.onresult = (event) => {
        const r = event.results[0][0];
        console.log('[STT] Got:', r.transcript, 'conf:', r.confidence);
        settle({ transcript: r.transcript.trim(), confidence: r.confidence });
      };

      recognition.onerror = (event) => {
        console.warn('[STT] Error:', event.error);
        // All errors just resolve null — don't crash
        if (event.error !== 'aborted') settle(null);
      };

      recognition.onend = () => { if (!settled) settle(null); };

      try {
        recognition.start();
      } catch (e) {
        console.warn('[STT] Start fail:', e.message);
        settle(null);
      }
    });
  }

  function stopListening() {
    clearTimeout(sttTimeout);
    try { if (recognition) recognition.stop(); } catch {}
  }

  // ── Sarvam STT fallback (rate-limited) ───────────────────
  async function listenSarvam(durationMs = 5000) {
    // Rate limit: don't call more than once per 8 seconds
    const now = Date.now();
    if (now - lastSarvamSTTCall < SARVAM_STT_MIN_INTERVAL) {
      console.log('[Sarvam STT] Rate limited, skipping');
      return null;
    }
    lastSarvamSTTCall = now;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                       MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '';
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      const chunks = [];

      return new Promise((resolve) => {
        let resolved = false;
        function done(val) {
          if (resolved) return;
          resolved = true;
          stream.getTracks().forEach(t => t.stop());
          resolve(val);
        }

        const safety = setTimeout(() => { try { recorder.stop(); } catch {} done(null); }, durationMs + 5000);

        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.onstop = async () => {
          clearTimeout(safety);
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size < 100) { done(null); return; }

          const fd = new FormData();
          fd.append('file', blob, 'audio.webm');
          fd.append('language_code', 'en-IN');

          try {
            const res = await fetch('/api/sarvam-stt', { method: 'POST', body: fd });
            if (!res.ok) { console.warn('[Sarvam STT] HTTP', res.status); done(null); return; }
            const data = await res.json();
            const t = data.transcript || data.text || null;
            done(t ? { transcript: t, confidence: 0.85 } : null);
          } catch (err) {
            console.warn('[Sarvam STT] Error:', err.message);
            done(null);
          }
        };
        recorder.onerror = () => { clearTimeout(safety); done(null); };
        recorder.start();
        setTimeout(() => { try { recorder.stop(); } catch { done(null); } }, durationMs);
      });
    } catch (err) {
      console.warn('[Sarvam STT] Setup error:', err.message);
      return null;
    }
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  return { speak, speakOnce, stopSpeaking, listen, stopListening, listenSarvam };
})();
