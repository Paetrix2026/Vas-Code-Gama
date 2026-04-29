// ============================================================
// map.js — Leaflet Map Module
// ============================================================

const MapEngine = (() => {
  let map = null;
  let userMarker = null;
  let destMarker = null;
  let driverMarker = null;
  let routeLine = null;

  const DEFAULT_CENTER = [12.87, 74.88]; // Mangaluru
  const DEFAULT_ZOOM = 13;

  function init(containerId) {
    map = L.map(containerId, {
      zoomControl: false,
      attributionControl: true,
      doubleClickZoom: false,
      scrollWheelZoom: true,
      dragging: true,
      touchZoom: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);

    return map;
  }

  function createIcon(className, size = [20, 20]) {
    return L.divIcon({
      className: '',
      html: `<div class="${className}"></div>`,
      iconSize: size,
      iconAnchor: [size[0] / 2, size[1] / 2],
    });
  }

  function setUserLocation(lat, lon) {
    if (!map) return;
    if (userMarker) map.removeLayer(userMarker);
    userMarker = L.marker([lat, lon], {
      icon: createIcon('marker-user'),
      interactive: false,
    }).addTo(map);
    map.setView([lat, lon], 15, { animate: true });
  }

  function setDestination(lat, lon) {
    if (!map) return;
    if (destMarker) map.removeLayer(destMarker);
    destMarker = L.marker([lat, lon], {
      icon: createIcon('marker-destination', [16, 24]),
    }).addTo(map);
  }

  function drawRoute(pickupLat, pickupLon, destLat, destLon) {
    if (!map) return;
    if (routeLine) map.removeLayer(routeLine);
    routeLine = L.polyline(
      [[pickupLat, pickupLon], [destLat, destLon]],
      { color: '#FFB300', weight: 4, opacity: 0.8, dashArray: '8, 12' }
    ).addTo(map);

    const bounds = L.latLngBounds(
      [pickupLat, pickupLon],
      [destLat, destLon]
    );
    map.fitBounds(bounds, { padding: [60, 60], animate: true });
  }

  function setDriverLocation(lat, lon) {
    if (!map) return;
    if (driverMarker) {
      driverMarker.setLatLng([lat, lon]);
    } else {
      driverMarker = L.marker([lat, lon], {
        icon: createIcon('marker-driver'),
        interactive: false,
      }).addTo(map);
    }
  }

  function removeDriver() {
    if (driverMarker && map) {
      map.removeLayer(driverMarker);
      driverMarker = null;
    }
  }

  function clearAll() {
    if (map) {
      if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
      if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
      if (driverMarker) { map.removeLayer(driverMarker); driverMarker = null; }
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    }
  }

  function getMap() { return map; }

  return { init, setUserLocation, setDestination, drawRoute, setDriverLocation, removeDriver, clearAll, getMap, createIcon };
})();
