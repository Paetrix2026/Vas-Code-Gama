// ============================================================
// rider.js — State Machine Voice Flow (Fixed)
// ============================================================

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const statusHeading = $('status-heading');
  const statusText = $('status-text');
  const pulseDot = $('pulse-dot');
  const waveform = $('waveform');
  const spinner = $('spinner');
  const mainOverlay = $('main-overlay');
  const bottomText = $('bottom-text');
  const driverCard = $('driver-card');
  const driverNameEl = $('driver-name');
  const driverEtaEl = $('driver-eta');
  const driverFareEl = $('driver-fare');
  const offlineBanner = $('offline-banner');
  const rippleContainer = $('ripple-container');

  // ── State Machine ────────────────────────────────────────
  const S = {
    IDLE: 'IDLE',
    LISTENING_DESTINATION: 'LISTENING_DESTINATION',
    CONFIRM_DESTINATION: 'CONFIRM_DESTINATION',
    SEARCHING_DRIVER: 'SEARCHING_DRIVER',
    DRIVER_FOUND: 'DRIVER_FOUND',
    CONFIRM_RIDE: 'CONFIRM_RIDE',
    DRIVER_CONFIRMATION: 'DRIVER_CONFIRMATION',
    FINAL_CONFIRMATION: 'FINAL_CONFIRMATION',
    RIDE_STARTED: 'RIDE_STARTED',
  };

  let state = S.IDLE;
  let lat = null, lon = null, address = '';
  let dLat = null, dLon = null, dAddr = '';
  let distKm = 0, fare = 0;
  let driver = null;
  let etaInterval = null;
  let retries = 0;

  function log(m) { console.log(`[FLOW][${state}] ${m}`); }
  function go(s) { log(`→ ${s}`); state = s; }

  // ── Init ─────────────────────────────────────────────────
  MapEngine.init('map');
  Wallet.init();
  SocketClient.connect('rider');

  window.addEventListener('offline', () => {
    offlineBanner.style.display = 'block';
    VoiceEngine.speakOnce('You are offline.');
  });
  window.addEventListener('online', () => { offlineBanner.style.display = 'none'; });

  detectLocation();

  async function detectLocation() {
    setUI('Detecting your location…', 'Please wait');
    pulseDot.classList.add('active');
    try {
      const pos = await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition(res, rej, {
          enableHighAccuracy: true, timeout: 15000, maximumAge: 60000,
        });
      });
      lat = pos.coords.latitude;
      lon = pos.coords.longitude;
      localStorage.setItem('last_lat', lat);
      localStorage.setItem('last_lon', lon);
      MapEngine.setUserLocation(lat, lon);
      address = await reverseGeo(lat, lon);
      setUI(address, 'Your current location');
      pulseDot.classList.remove('active');
      bottomText.textContent = 'TAP ANYWHERE TO BEGIN';
    } catch (e) {
      console.warn('[GEO]', e);
      const cLat = localStorage.getItem('last_lat');
      const cLon = localStorage.getItem('last_lon');
      if (cLat && cLon) {
        lat = +cLat; lon = +cLon;
        MapEngine.setUserLocation(lat, lon);
        address = await reverseGeo(lat, lon);
        setUI(address, 'Last known location');
      } else {
        setUI('Location unavailable', 'Enable location and tap');
        pulseDot.classList.add('error');
      }
      pulseDot.classList.remove('active');
      bottomText.textContent = 'TAP ANYWHERE TO BEGIN';
    }
  }

  async function reverseGeo(la, lo) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${la}&lon=${lo}&zoom=18&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
      const d = await r.json();
      return d.display_name ? d.display_name.split(',').map(s => s.trim()).slice(0, 3).join(', ') : `${la.toFixed(4)}, ${lo.toFixed(4)}`;
    } catch { return `${la.toFixed(4)}, ${lo.toFixed(4)}`; }
  }

  // ── Tap ──────────────────────────────────────────────────
  mainOverlay.addEventListener('click', (e) => {
    if (state !== S.IDLE) return;
    if (!lat || !lon) { detectLocation(); return; }
    if (navigator.vibrate) navigator.vibrate(100);
    createRipple(e.clientX, e.clientY);
    beginFlow();
  });

  function createRipple(x, y) {
    rippleContainer.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const r = document.createElement('div');
      r.className = 'ripple-ring';
      r.style.left = x + 'px'; r.style.top = y + 'px';
      r.style.width = (80 + i * 50) + 'px'; r.style.height = (80 + i * 50) + 'px';
      rippleContainer.appendChild(r);
    }
    setTimeout(() => { rippleContainer.innerHTML = ''; }, 1000);
  }

  // ── Helpers ──────────────────────────────────────────────
  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  function isYes(t) {
    if (!t) return false;
    const w = t.toLowerCase().trim();
    return /\b(yes|yeah|yep|yah|ya|correct|confirm|sure|ok|okay|book|haan|ha|right)\b/.test(w);
  }

  function isNo(t) {
    if (!t) return false;
    const w = t.toLowerCase().trim();
    return /\b(no|nope|nah|cancel|repeat|nahi|wrong|stop)\b/.test(w);
  }

  async function listenFor(prompt, timeoutMs = 7000) {
    setUI('Listening…', prompt);
    showWave(true);
    const r = await VoiceEngine.listen(timeoutMs);
    showWave(false);
    return r;
  }

  // ── FLOW ─────────────────────────────────────────────────
  async function beginFlow() {
    go(S.LISTENING_DESTINATION);
    retries = 0;
    pulseDot.classList.add('active');
    pulseDot.classList.remove('error', 'success');
    bottomText.textContent = 'LISTENING…';

    setUI('Your location', address);
    await VoiceEngine.speakOnce(
      `Your current location is ${address}. Please say your destination.`
    );
    await listenDestination();
  }

  // ── LISTENING_DESTINATION ────────────────────────────────
  async function listenDestination() {
    go(S.LISTENING_DESTINATION);
    const result = await listenFor('Say your destination', 8000);

    if (!result || !result.transcript) {
      retries++;
      if (retries > 2) {
        setUI('Could not hear you', 'Tap to try again');
        pulseDot.classList.add('error');
        await VoiceEngine.speakOnce("I could not hear you. Please tap to try again.");
        resetIdle();
        return;
      }
      await VoiceEngine.speakOnce("I didn't catch that. Please say your destination.");
      await listenDestination();
      return;
    }

    retries = 0;
    const raw = result.transcript;
    log(`Heard: "${raw}"`);

    // AI processing + autocorrect via Mistral
    setUI('Processing…', `"${raw}"`);
    showSpin(true);
    let dest = raw;
    try {
      const r = await fetch('/api/process-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: raw }),
      });
      const d = await r.json();
      if (d.destination) dest = d.destination;
    } catch (e) { console.warn('[AI]', e); }
    showSpin(false);

    await confirmDest(dest);
  }

  // ── CONFIRM_DESTINATION ──────────────────────────────────
  async function confirmDest(dest) {
    go(S.CONFIRM_DESTINATION);
    setUI(dest, 'Is this correct?');
    bottomText.textContent = 'SAY YES OR NO';

    await VoiceEngine.speakOnce(`Did you say ${dest}? Say yes or no.`);
    const result = await listenFor('Say YES or NO', 6000);
    const ans = result?.transcript || '';
    log(`Answer: "${ans}"`);

    if (isNo(ans)) {
      await VoiceEngine.speakOnce("Okay, please say your destination again.");
      retries = 0;
      await listenDestination();
      return;
    }

    if (isYes(ans)) {
      await afterConfirm(dest);
      return;
    }

    // Unclear or empty — retry confirmation once
    if (!ans) {
      await VoiceEngine.speakOnce("I didn't hear you. Say yes to confirm or no to retry.");
      const r2 = await listenFor('Say YES or NO', 6000);
      const a2 = r2?.transcript || '';
      if (isYes(a2)) { await afterConfirm(dest); return; }
      if (isNo(a2)) {
        await VoiceEngine.speakOnce("Okay, say your destination again.");
        await listenDestination();
        return;
      }
    }

    // Still unclear — assume yes and proceed
    log('Unclear, assuming yes');
    await afterConfirm(dest);
  }

  // ── After confirm → geocode + search ─────────────────────
  async function afterConfirm(dest) {
    setUI('Finding location…', dest);
    showSpin(true);

    // Geocode with location bias (nearby results preferred)
    const coords = await geocodeNearby(dest, lat, lon);
    showSpin(false);

    if (!coords) {
      await VoiceEngine.speakOnce(`Could not find ${dest}. Please say another destination.`);
      retries = 0;
      await listenDestination();
      return;
    }

    dLat = coords.lat; dLon = coords.lon; dAddr = coords.address || dest;
    MapEngine.setDestination(dLat, dLon);
    MapEngine.drawRoute(lat, lon, dLat, dLon);
    distKm = haversine(lat, lon, dLat, dLon);
    fare = Wallet.calculateFare(distKm);
    setUI(dAddr, `${distKm.toFixed(1)} km · ₹${fare}`);

    await searchDriver();
  }

  // ── Geocode with location bias ───────────────────────────
  async function geocodeNearby(query, userLat, userLon) {
    // Run 2 queries: raw + with nearby viewbox bias
    const viewbox = `${userLon - 0.5},${userLat - 0.5},${userLon + 0.5},${userLat + 0.5}`;
    const urls = [
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3&viewbox=${viewbox}&bounded=0`,
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await r.json();
        if (data && data.length > 0) {
          // Pick the closest result to user
          let best = data[0];
          let bestDist = haversine(userLat, userLon, +data[0].lat, +data[0].lon);
          for (let i = 1; i < data.length; i++) {
            const d = haversine(userLat, userLon, +data[i].lat, +data[i].lon);
            if (d < bestDist) { best = data[i]; bestDist = d; }
          }
          return {
            lat: +best.lat,
            lon: +best.lon,
            address: best.display_name.split(',').slice(0, 3).join(', '),
          };
        }
      } catch (e) { console.warn('[GEO] Query failed:', e); }
    }
    return null;
  }

  // ── SEARCHING_DRIVER ─────────────────────────────────────
  async function searchDriver() {
    go(S.SEARCHING_DRIVER);
    setUI('Searching…', 'Finding nearby drivers');
    showSpin(true);
    bottomText.textContent = 'SEARCHING…';

    await VoiceEngine.speakOnce('Searching for nearby drivers.');

    SocketClient.send({
      type: 'FIND_DRIVER',
      pickup: { lat, lon, address },
      destination: { lat: dLat, lon: dLon, address: dAddr },
      distance_km: distKm,
    });

    await delay(2500);
    showSpin(false);

    driver = { name: 'Ramesh', eta: 5, price: 120, lat: dLat + 0.008, lon: dLon + 0.005 };
    MapEngine.setDriverLocation(driver.lat, driver.lon);

    go(S.DRIVER_FOUND);
    setUI(`Driver ${driver.name}`, `ETA: ${driver.eta} min · ₹${driver.price}`);
    bottomText.textContent = 'DRIVER FOUND';
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    await confirmRide();
  }

  // ── CONFIRM_RIDE ─────────────────────────────────────────
  async function confirmRide() {
    go(S.CONFIRM_RIDE);
    bottomText.textContent = 'SAY YES TO BOOK';

    await VoiceEngine.speakOnce(
      `Driver ${driver.name} found. Arrival in ${driver.eta} minutes. Price is ${driver.price} rupees. Do you want to book?`
    );
    const result = await listenFor('Say YES to book', 7000);
    const ans = result?.transcript || '';
    log(`Book: "${ans}"`);

    if (isNo(ans)) {
      MapEngine.removeDriver();
      await VoiceEngine.speakOnce('Ride cancelled.');
      resetIdle();
      return;
    }

    if (isYes(ans) || !ans) {
      // If empty (no response), still proceed — user likely meant yes
      await sendRequest();
      return;
    }

    // Unknown — ask once more
    await VoiceEngine.speakOnce('Say yes to book or no to cancel.');
    const r2 = await listenFor('YES or NO', 5000);
    if (isNo(r2?.transcript)) {
      MapEngine.removeDriver();
      await VoiceEngine.speakOnce('Ride cancelled.');
      resetIdle();
      return;
    }
    await sendRequest();
  }

  // ── DRIVER_CONFIRMATION ──────────────────────────────────
  async function sendRequest() {
    go(S.DRIVER_CONFIRMATION);
    setUI('Sending request…', `To ${driver.name}`);
    showSpin(true);
    bottomText.textContent = 'CONTACTING DRIVER…';

    await VoiceEngine.speakOnce('Sending request to driver.');
    await delay(2000);
    showSpin(false);

    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    setUI('Driver accepted!', `${driver.name} is on the way`);
    bottomText.textContent = 'DRIVER ACCEPTED';

    driverNameEl.textContent = driver.name;
    driverEtaEl.textContent = `Arriving in ~${driver.eta} min`;
    driverFareEl.textContent = `₹${driver.price}`;
    driverCard.style.display = 'block';

    await finalConfirm();
  }

  // ── FINAL_CONFIRMATION ───────────────────────────────────
  async function finalConfirm() {
    go(S.FINAL_CONFIRMATION);
    bottomText.textContent = 'SAY YES TO FINALIZE';

    await VoiceEngine.speakOnce(`Driver ${driver.name} accepted. Do you want to finalize?`);
    const result = await listenFor('Say YES to finalize', 7000);
    const ans = result?.transcript || '';
    log(`Final: "${ans}"`);

    if (isNo(ans)) {
      driverCard.style.display = 'none';
      MapEngine.removeDriver();
      await VoiceEngine.speakOnce('Ride cancelled. No charge.');
      resetIdle();
      return;
    }

    // Yes or empty or unclear → finalize (user most likely wants to proceed)
    await rideStart();
  }

  // ── RIDE_STARTED ─────────────────────────────────────────
  async function rideStart() {
    go(S.RIDE_STARTED);

    if (!Wallet.canAfford(driver.price)) {
      setUI('Insufficient balance', `Need ₹${driver.price}`);
      await VoiceEngine.speakOnce('Insufficient balance. Please recharge.');
      driverCard.style.display = 'none';
      resetIdle();
      return;
    }

    Wallet.deduct(driver.price);
    pulseDot.classList.remove('active');
    pulseDot.classList.add('success');
    setUI('Ride confirmed!', `${driver.name} arriving in ${driver.eta} min`);
    bottomText.textContent = 'RIDE IN PROGRESS';

    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);

    await VoiceEngine.speakOnce(
      `Ride confirmed. ${driver.price} rupees deducted. Driver ${driver.name} arriving in ${driver.eta} minutes.`
    );

    let eta = driver.eta;
    etaInterval = setInterval(() => {
      eta = Math.max(1, eta - 1);
      driverEtaEl.textContent = `Arriving in ~${eta} min`;
      if (eta <= 1) {
        clearInterval(etaInterval);
        driverEtaEl.textContent = 'Driver arrived!';
        setUI('Driver arrived!', 'Your driver is here');
        VoiceEngine.speakOnce('Your driver has arrived.');
      }
    }, 30000);
  }

  // ── Reset ────────────────────────────────────────────────
  function resetIdle() {
    go(S.IDLE);
    pulseDot.classList.remove('active', 'error', 'success');
    showSpin(false); showWave(false);
    bottomText.textContent = 'TAP ANYWHERE TO BEGIN';
  }

  // ── WebSocket (for real driver page) ─────────────────────
  SocketClient.on('DRIVER_ACCEPTED', async (d) => {
    if (state === S.SEARCHING_DRIVER) {
      showSpin(false);
      driver = { name: d.driverName || 'Ramesh', eta: d.estimatedMinutes || 5, price: d.fare || fare || 120, lat: d.driverLocation?.lat || dLat + 0.008, lon: d.driverLocation?.lon || dLon + 0.005 };
      await rideStart();
    }
  });
  SocketClient.on('DRIVER_MOVING', (d) => {
    if (d.driverLocation) MapEngine.setDriverLocation(d.driverLocation.lat, d.driverLocation.lon);
    if (d.estimatedMinutes != null) driverEtaEl.textContent = `Arriving in ~${d.estimatedMinutes} min`;
  });
  SocketClient.on('DRIVER_ARRIVED', async () => {
    clearInterval(etaInterval);
    driverEtaEl.textContent = 'Driver arrived!';
    setUI('Driver arrived!', 'Your driver is here');
    if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 200]);
    await VoiceEngine.speakOnce('Your driver has arrived.');
  });
  SocketClient.on('RIDE_ENDED', async () => {
    clearInterval(etaInterval);
    driverCard.style.display = 'none';
    MapEngine.removeDriver();
    setUI('Ride complete', 'Thank you!');
    await VoiceEngine.speakOnce('You have reached your destination. Thank you for riding.');
    resetIdle();
  });

  // ── Geocoding helper ─────────────────────────────────────
  function haversine(a, b, c, d) {
    const R = 6371, p = Math.PI / 180;
    const dl = (c - a) * p, dn = (d - b) * p;
    const x = Math.sin(dl / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(dn / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  // ── UI ───────────────────────────────────────────────────
  function setUI(h, t) { statusHeading.textContent = h; statusText.textContent = t || ''; }
  function showWave(s) { waveform.style.display = s ? 'flex' : 'none'; mainOverlay.classList.toggle('state-listening', s); }
  function showSpin(s) { spinner.style.display = s ? 'flex' : 'none'; }
})();
