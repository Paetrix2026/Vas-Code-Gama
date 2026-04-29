// ============================================================
// driver.js — Driver Dashboard Logic
// ============================================================

(function () {
  'use strict';

  // ── DOM refs ─────────────────────────────────────────────
  const waitingState = document.getElementById('waiting-state');
  const rideCard = document.getElementById('ride-card');
  const rideActive = document.getElementById('ride-active');
  const pickupAddress = document.getElementById('pickup-address');
  const destAddress = document.getElementById('dest-address');
  const rideDistance = document.getElementById('ride-distance');
  const rideFare = document.getElementById('ride-fare');
  const btnAccept = document.getElementById('btn-accept');
  const btnReject = document.getElementById('btn-reject');
  const btnEndRide = document.getElementById('btn-end-ride');
  const activeText = document.getElementById('active-text');
  const connStatus = document.getElementById('connection-status');
  const connText = connStatus.querySelector('.conn-text');

  // ── State ────────────────────────────────────────────────
  let currentRide = null;
  let driverMap = null;
  let activeMap = null;
  let pickupMarker = null;
  let destMarker = null;
  let activePickupMarker = null;
  let activeDestMarker = null;
  let driverLocMarker = null;

  // ── Connect WebSocket ────────────────────────────────────
  SocketClient.connect('driver');

  SocketClient.on('open', () => {
    connStatus.classList.add('connected');
    connText.textContent = 'Connected';
  });

  SocketClient.on('close', () => {
    connStatus.classList.remove('connected');
    connText.textContent = 'Disconnected';
  });

  // ── Ride request handler ─────────────────────────────────
  SocketClient.on('RIDE_REQUEST', (data) => {
    currentRide = data;

    pickupAddress.textContent = data.pickup?.address || 'Unknown pickup';
    destAddress.textContent = data.destination?.address || 'Unknown destination';
    rideDistance.textContent = data.distance_km ? data.distance_km.toFixed(1) : '—';
    rideFare.textContent = data.fare ? `₹${data.fare}` : '—';

    // Show ride card, hide waiting
    waitingState.style.display = 'none';
    rideCard.style.display = 'block';
    rideActive.style.display = 'none';

    // Init mini map
    setTimeout(() => initDriverMap(data), 100);
  });

  function createIcon(className) {
    return L.divIcon({
      className: '',
      html: `<div class="${className}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function initDriverMap(data) {
    const mapEl = document.getElementById('driver-map');
    if (!mapEl) return;

    // Destroy existing map
    if (driverMap) {
      driverMap.remove();
      driverMap = null;
    }

    driverMap = L.map('driver-map', {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      touchZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(driverMap);

    // Apply dark filter
    mapEl.querySelector('.leaflet-tile-pane').style.filter = 'brightness(0.6) contrast(1.1) saturate(0.3)';

    if (data.pickup && data.destination) {
      pickupMarker = L.marker([data.pickup.lat, data.pickup.lon], {
        icon: createIcon('marker-pickup-driver'),
      }).addTo(driverMap);

      destMarker = L.marker([data.destination.lat, data.destination.lon], {
        icon: createIcon('marker-dest-driver'),
      }).addTo(driverMap);

      // Draw route line
      L.polyline(
        [[data.pickup.lat, data.pickup.lon], [data.destination.lat, data.destination.lon]],
        { color: '#FFB300', weight: 3, opacity: 0.7, dashArray: '6, 10' }
      ).addTo(driverMap);

      const bounds = L.latLngBounds(
        [data.pickup.lat, data.pickup.lon],
        [data.destination.lat, data.destination.lon]
      );
      driverMap.fitBounds(bounds, { padding: [30, 30] });
    }
  }

  // ── Accept button ────────────────────────────────────────
  btnAccept.addEventListener('click', () => {
    if (!currentRide) return;

    SocketClient.send({
      type: 'DRIVER_ACCEPTED',
      driverName: 'Ravi Kumar',
      driverLocation: {
        lat: (currentRide.pickup?.lat || 12.87) + 0.008,
        lon: (currentRide.pickup?.lon || 74.88) + 0.005,
      },
    });

    // Switch to active ride view
    rideCard.style.display = 'none';
    rideActive.style.display = 'flex';
    activeText.textContent = `Heading to pickup: ${currentRide.pickup?.address || 'Unknown'}`;

    // Init active ride map
    setTimeout(() => initActiveMap(), 100);
  });

  function initActiveMap() {
    if (!currentRide) return;
    const mapEl = document.getElementById('active-map');
    if (!mapEl) return;

    if (activeMap) {
      activeMap.remove();
      activeMap = null;
    }

    activeMap = L.map('active-map', {
      zoomControl: false,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(activeMap);

    mapEl.querySelector('.leaflet-tile-pane').style.filter = 'brightness(0.6) contrast(1.1) saturate(0.3)';

    if (currentRide.pickup) {
      activePickupMarker = L.marker([currentRide.pickup.lat, currentRide.pickup.lon], {
        icon: createIcon('marker-pickup-driver'),
      }).addTo(activeMap);
    }

    if (currentRide.destination) {
      activeDestMarker = L.marker([currentRide.destination.lat, currentRide.destination.lon], {
        icon: createIcon('marker-dest-driver'),
      }).addTo(activeMap);
    }

    if (currentRide.pickup && currentRide.destination) {
      L.polyline(
        [[currentRide.pickup.lat, currentRide.pickup.lon], [currentRide.destination.lat, currentRide.destination.lon]],
        { color: '#FFB300', weight: 3, opacity: 0.7, dashArray: '6, 10' }
      ).addTo(activeMap);

      const bounds = L.latLngBounds(
        [currentRide.pickup.lat, currentRide.pickup.lon],
        [currentRide.destination.lat, currentRide.destination.lon]
      );
      activeMap.fitBounds(bounds, { padding: [30, 30] });
    }
  }

  // ── Driver movement updates ──────────────────────────────
  SocketClient.on('DRIVER_MOVING', (data) => {
    if (data.estimatedMinutes !== undefined) {
      activeText.textContent = `Arriving at pickup in ~${data.estimatedMinutes} min`;
    }
  });

  SocketClient.on('DRIVER_ARRIVED', () => {
    activeText.textContent = 'Arrived at pickup! Waiting for rider…';
  });

  // ── Reject button ────────────────────────────────────────
  btnReject.addEventListener('click', () => {
    SocketClient.send({ type: 'DRIVER_REJECTED' });

    currentRide = null;
    rideCard.style.display = 'none';
    waitingState.style.display = 'flex';

    if (driverMap) {
      driverMap.remove();
      driverMap = null;
    }
  });

  // ── End ride button ──────────────────────────────────────
  btnEndRide.addEventListener('click', async () => {
    SocketClient.send({ type: 'END_RIDE' });

    try {
      await fetch('/api/end-ride', { method: 'POST' });
    } catch (e) {
      console.warn('[DRIVER] End ride API call failed:', e);
    }

    currentRide = null;
    rideActive.style.display = 'none';
    waitingState.style.display = 'flex';

    if (activeMap) {
      activeMap.remove();
      activeMap = null;
    }
  });

  // ── Ride ended (from server) ─────────────────────────────
  SocketClient.on('RIDE_ENDED', () => {
    currentRide = null;
    rideCard.style.display = 'none';
    rideActive.style.display = 'none';
    waitingState.style.display = 'flex';

    if (driverMap) { driverMap.remove(); driverMap = null; }
    if (activeMap) { activeMap.remove(); activeMap = null; }
  });
})();
