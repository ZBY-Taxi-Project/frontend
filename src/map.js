/**
 * Interactive Real-Time Map Engine for Dispatcher Operations Hub
 * Multi-provider support (OpenStreetMap, CartoDB, Satellite) with automatic resizing and fallback.
 */

let mapInstance = null;
let currentTileLayer = null;
let driverMarkers = {};
let routePolyline = null;
let pickupMarker = null;
let deliveryMarker = null;
let resizeObserver = null;

// Tashkent city center coordinates
const DEFAULT_CENTER = [41.311081, 69.240562];
const DEFAULT_ZOOM = 13;

const TILE_PROVIDERS = {
  dark: {
    name: '🌙 Tungi Xarita (Toza)',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 16, attribution: 'Tiles &copy; Esri &copy; OpenStreetMap' },
  },
  osm: {
    name: '🗺️ OpenStreetMap Standart',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' },
  },
  satellite: {
    name: '🛰️ Sun‘iy Yo‘ldosh Gibrid',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    options: { maxZoom: 18, attribution: 'Tiles &copy; Esri' },
  },
};

let currentProviderKey = 'dark';

/**
 * Ensures Leaflet library is loaded, injecting from CDN if needed.
 */
export async function ensureLeaflet() {
  if (typeof window.L !== 'undefined') {
    return window.L;
  }

  return new Promise((resolve, reject) => {
    // Check if script is already injected
    let script = document.querySelector('script[src*="leaflet"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.crossOrigin = '';
      document.head.appendChild(script);
    }

    let css = document.querySelector('link[href*="leaflet"]');
    if (!css) {
      css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }

    const checkInterval = setInterval(() => {
      if (typeof window.L !== 'undefined') {
        clearInterval(checkInterval);
        resolve(window.L);
      }
    }, 50);

    setTimeout(() => {
      clearInterval(checkInterval);
      if (typeof window.L !== 'undefined') {
        resolve(window.L);
      } else {
        reject(new Error('Leaflet load timeout'));
      }
    }, 5000);
  });
}

/**
 * Initialize map instance with robust size invalidation and multi-tile fallback.
 */
export async function initMap(containerId = 'dispatch-map') {
  const container = document.getElementById(containerId);
  if (!container) return null;

  try {
    await ensureLeaflet();
  } catch (e) {
    console.warn('Leaflet load failed, falling back to vector radar:', e);
    renderVectorFallback(containerId);
    return null;
  }

  // Clean up previous instance
  if (mapInstance) {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    mapInstance.remove();
    mapInstance = null;
    driverMarkers = {};
    routePolyline = null;
    pickupMarker = null;
    deliveryMarker = null;
  }

  try {
    mapInstance = window.L.map(containerId, {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true,
      zoomAnimation: true,
    }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    // Zoom controls on top-right
    window.L.control.zoom({ position: 'topright' }).addTo(mapInstance);

    // Set tile layer
    setTileProvider(currentProviderKey);

    // Automatically invalidate size whenever container resizes
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (mapInstance) {
          mapInstance.invalidateSize({ animate: false });
        }
      });
      resizeObserver.observe(container);
    }

    // Force size calculation after DOM render
    setTimeout(() => {
      if (mapInstance) {
        mapInstance.invalidateSize({ animate: true });
      }
    }, 150);

    return mapInstance;
  } catch (err) {
    console.error('Failed to init Leaflet map:', err);
    renderVectorFallback(containerId);
    return null;
  }
}

export function setTileProvider(providerKey) {
  if (!mapInstance || !TILE_PROVIDERS[providerKey]) return;

  if (currentTileLayer) {
    mapInstance.removeLayer(currentTileLayer);
  }

  currentProviderKey = providerKey;
  const config = TILE_PROVIDERS[providerKey];

  currentTileLayer = window.L.tileLayer(config.url, {
    ...config.options,
    errorTileUrl: 'https://tile.openstreetmap.org/0/0/0.png',
  }).addTo(mapInstance);
}

export function invalidateMapSize() {
  if (mapInstance) {
    setTimeout(() => {
      mapInstance.invalidateSize({ animate: true });
    }, 200);
  }
}

export function createDriverIcon(driver) {
  const isAvailable = driver.status === 'available';
  const isBusy = driver.status === 'busy';
  const color = isAvailable ? '#10b981' : isBusy ? '#f59e0b' : '#64748b';
  const pulseClass = isAvailable ? 'driver-marker-pulse' : '';
  const vehicleEmoji = (driver.vehicle_type || '').toLowerCase().includes('moto') ? '🛵' : '🚗';

  const html = `
    <div class="custom-driver-marker ${pulseClass}" style="--marker-color:${color};">
      <div class="driver-pin-circle" style="background:${color};">
        <span class="driver-pin-icon">${vehicleEmoji}</span>
      </div>
      <div class="driver-pin-tag">${driver.name.split(' ')[0]}</div>
    </div>
  `;

  return window.L.divIcon({
    className: 'driver-div-icon',
    html: html,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

export function updateDriverMarkers(drivers = [], onDriverClick = null) {
  if (!mapInstance || typeof window.L === 'undefined') return;

  const currentIds = new Set();

  drivers.forEach((driver) => {
    // Only plot drivers that have actual GPS coordinates from the backend database
    if (driver.current_lat == null || driver.current_lng == null) {
      return;
    }

    const lat = Number(driver.current_lat);
    const lng = Number(driver.current_lng);

    currentIds.add(driver.id);

    const statusLabels = {
      available: "BO'SH",
      busy: "BAND",
      offline: "OFLAYN"
    };
    const statusText = statusLabels[driver.status] || driver.status.toUpperCase();

    const popupContent = `
      <div class="map-popup-card">
        <div class="popup-header">
          <strong>${driver.name}</strong>
          <span class="status-badge status-${driver.status}">${statusText}</span>
        </div>
        <p class="popup-meta">📱 ${driver.phone || 'Mavjud emas'}</p>
        <p class="popup-meta">🚙 ${driver.vehicle_type || 'Mashina'} • ${driver.license_plate || 'Raqamsiz'}</p>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:0.68rem;color:#94a3b8;margin-bottom:5px;font-weight:600;">Dispetcher: Holatni o'zgartirish:</div>
          <div style="display:flex;gap:4px;">
            <button type="button" class="btn-popup-change-status ${driver.status === 'available' ? 'active' : ''}" data-driver-id="${driver.id}" data-status="available" style="flex:1;padding:4px 6px;font-size:0.68rem;font-weight:700;border-radius:4px;cursor:pointer;background:${driver.status === 'available' ? '#10b981' : 'rgba(255,255,255,0.06)'};border:1px solid ${driver.status === 'available' ? '#10b981' : 'rgba(255,255,255,0.15)'};color:#fff;">Bo'sh</button>
            <button type="button" class="btn-popup-change-status ${driver.status === 'busy' ? 'active' : ''}" data-driver-id="${driver.id}" data-status="busy" style="flex:1;padding:4px 6px;font-size:0.68rem;font-weight:700;border-radius:4px;cursor:pointer;background:${driver.status === 'busy' ? '#f59e0b' : 'rgba(255,255,255,0.06)'};border:1px solid ${driver.status === 'busy' ? '#f59e0b' : 'rgba(255,255,255,0.15)'};color:#fff;">Band</button>
            <button type="button" class="btn-popup-change-status ${driver.status === 'offline' ? 'active' : ''}" data-driver-id="${driver.id}" data-status="offline" style="flex:1;padding:4px 6px;font-size:0.68rem;font-weight:700;border-radius:4px;cursor:pointer;background:${driver.status === 'offline' ? '#64748b' : 'rgba(255,255,255,0.06)'};border:1px solid ${driver.status === 'offline' ? '#64748b' : 'rgba(255,255,255,0.15)'};color:#fff;">Oflayn</button>
          </div>
        </div>
        <div class="popup-actions" style="margin-top:8px;display:flex;gap:6px;align-items:center;">
          <a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener noreferrer" style="font-size:0.72rem;color:#60a5fa;text-decoration:none;display:inline-flex;align-items:center;gap:3px;" title="Google Xaritada ochish">
            <span>Google Xaritada ochish</span> ↗
          </a>
        </div>
      </div>
    `;

    const icon = createDriverIcon(driver);

    if (driverMarkers[driver.id]) {
      driverMarkers[driver.id].setLatLng([lat, lng]);
      driverMarkers[driver.id].setIcon(icon);
      const popup = driverMarkers[driver.id].getPopup();
      if (popup) {
        popup.setContent(popupContent);
      } else {
        driverMarkers[driver.id].bindPopup(popupContent, { className: 'dark-leaflet-popup' });
      }
    } else {
      const marker = window.L.marker([lat, lng], { icon }).addTo(mapInstance);
      marker.bindPopup(popupContent, { className: 'dark-leaflet-popup' });

      marker.on('click', () => {
        if (onDriverClick) onDriverClick(driver);
      });

      driverMarkers[driver.id] = marker;
    }
  });

  Object.keys(driverMarkers).forEach((id) => {
    if (!currentIds.has(Number(id))) {
      mapInstance.removeLayer(driverMarkers[id]);
      delete driverMarkers[id];
    }
  });
}

export function focusDriver(driverId) {
  if (!mapInstance || !driverMarkers[driverId]) return;
  const marker = driverMarkers[driverId];
  mapInstance.flyTo(marker.getLatLng(), 15, { duration: 1.0 });
  marker.openPopup();
}

export function centerAllDrivers() {
  if (!mapInstance) return;
  const markers = Object.values(driverMarkers);
  if (markers.length === 0) {
    mapInstance.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    return;
  }
  const group = new window.L.featureGroup(markers);
  mapInstance.fitBounds(group.getBounds().pad(0.2), { maxZoom: 15 });
}

export function drawOrderRoute(order) {
  clearOrderRoute();
  // Route polyline disabled to keep radar map clean and focused purely on live drivers
}

export function clearOrderRoute() {
  if (!mapInstance) return;
  if (routePolyline) {
    try {
      mapInstance.removeLayer(routePolyline);
    } catch (e) {}
    routePolyline = null;
  }
  if (pickupMarker) {
    try {
      mapInstance.removeLayer(pickupMarker);
    } catch (e) {}
    pickupMarker = null;
  }
  if (deliveryMarker) {
    try {
      mapInstance.removeLayer(deliveryMarker);
    } catch (e) {}
    deliveryMarker = null;
  }
}

function renderVectorFallback(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div style="width:100%;height:100%;background:#0b0f19;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);position:relative;">
      <div style="font-size:3rem;margin-bottom:12px;">🗺️</div>
      <h3 style="color:#f1f5f9;margin-bottom:6px;">Vektorli Radar Ko'rinishi</h3>
      <p style="font-size:0.85rem;max-width:360px;text-align:center;color:var(--text-dim);margin-bottom:16px;">
        Toshkent Shahri ZBY Taksi Dispetcherlik Xizmati (Koordinatalar: 41.3111° N, 69.2405° E)
      </p>
      <button onclick="window.location.reload()" class="hud-btn" style="padding:8px 16px;">
        Xaritani Qayta Yuklash
      </button>
    </div>
  `;
}
