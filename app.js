// --- Estado global ---
const state = {
  restaurants: [],
  filters: { cuisine: '', district: '', price: '', terrace: false, quality: true, openNow: false }
};

// --- Mapa (se pinta YA, antes de cargar datos) ---
const map = L.map('map').setView([40.4168, -3.7038], 13);
L.tileLayer('[%7Bs%7D.tile.openstreetmap.org](https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png)', {
  attribution: '© OpenStreetMap',
  maxZoom: 19
}).addTo(map);

const cluster = L.markerClusterGroup({ maxClusterRadius: 50 });
map.addLayer(cluster);

// --- Servidores Overpass (probamos varios por si uno cae) ---
const OVERPASS_SERVERS = [
  '[overpass-api.de](https://overpass-api.de/api/interpreter)',
  '[overpass.kumi.systems](https://overpass.kumi.systems/api/interpreter)',
  '[overpass.private.coffee](https://overpass.private.coffee/api/interpreter)'
];

const MADRID_QUERY = `
[out:json][timeout:60];
area["name"="Madrid"]["admin_level"="8"]->.madrid;
(
  node["amenity"="restaurant"](area.madrid);
  way["amenity"="restaurant"](area.madrid);
);
out center tags;
`;

async function loadRestaurants() {
  setStatus('Cargando restaurantes de Madrid…');

  // Caché de 24h
  const cached = localStorage.getItem('madrid-restaurants');
  const cachedTime = localStorage.getItem('madrid-restaurants-time');
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (cached && cachedTime && Date.now() - parseInt(cachedTime) < ONE_DAY) {
    try {
      state.restaurants = JSON.parse(cached);
      setStatus(`Caché del ${new Date(parseInt(cachedTime)).toLocaleString('es-ES')}`);
      render();
      return;
    } catch (e) { /* sigue al fetch */ }
  }

  // Intenta cada servidor hasta que uno funcione
  for (const url of OVERPASS_SERVERS) {
    try {
      setStatus(`Conectando a ${new URL(url).hostname}…`);
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(MADRID_QUERY),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.restaurants = (data.elements || []).map(parseElement).filter(Boolean);
      try {
        localStorage.setItem('madrid-restaurants', JSON.stringify(state.restaurants));
        localStorage.setItem('madrid-restaurants-time', Date.now().toString());
      } catch (e) { /* localStorage lleno, da igual */ }
      setStatus(`✅ ${state.restaurants.length} restaurantes cargados`);
      render();
      return;
    } catch (err) {
      console.warn(`Falló ${url}:`, err);
    }
  }
  setStatus('❌ No se pudo conectar a Overpass. Reintenta en 1 minuto.');
}

function parseElement(el) {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!lat || !lon) return null;
  const t = el.tags || {};
  if (!t.name) return null;

  return {
    id: el.id,
    name: t.name,
    lat, lon,
    cuisine: (t.cuisine || '').toLowerCase(),
    district: t['addr:district'] || t['addr:suburb'] || t['addr:city'] || '',
    street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
    phone: t.phone || t['contact:phone'],
    website: t.website || t['contact:website'],
    hours: t.opening_hours,
    priceRange: parsePriceRange(t),
    terrace: t.outdoor_seating === 'yes',
    takeaway: t.takeaway === 'yes',
    delivery: t.delivery === 'yes'
  };
}

function parsePriceRange(t) {
  if (t.price_range) {
    const n = parseInt(t.price_range);
    if (!isNaN(n)) return Math.min(4, Math.max(1, n));
  }
  return null;
}

function isQuality(r) {
  return !!(r.website && r.phone && r.hours);
}

function matchesCuisine(r, value) {
  if (!value) return true;
  if (!r.cuisine) return false;
  const map = {
    spanish: ['spanish', 'tapas', 'castilian', 'andalusian'],
    italian: ['italian', 'pizza', 'pasta'],
    asian: ['asian', 'chinese', 'japanese', 'thai', 'vietnamese', 'korean'],
    seafood: ['seafood', 'fish'],
    vegetarian: ['vegetarian', 'vegan'],
    tapas: ['tapas', 'spanish'],
    pizza: ['pizza', 'italian'],
    burger: ['burger', 'american']
  };
  const accepted = map[value] || [value];
  return accepted.some(c => r.cuisine.includes(c));
}

function isOpenNow(r) {
  if (!r.hours || typeof opening_hours === 'undefined') return false;
  try {
    const oh = new opening_hours(r.hours, { address: { country_code: 'es' } });
    return oh.getState(new Date());
  } catch { return false; }
}

// --- Render ---
function render() {
  cluster.clearLayers();
  const { cuisine, district, price, terrace, quality, openNow } = state.filters;
  const filtered = state.restaurants.filter(r => {
    if (quality && !isQuality(r)) return false;
    if (terrace && !r.terrace) return false;
    if (district && !r.district.toLowerCase().includes(district.toLowerCase())) return false;
    if (price && r.priceRange !== parseInt(price)) return false;
    if (!matchesCuisine(r, cuisine)) return false;
    if (openNow && !isOpenNow(r)) return false;
    return true;
  });

  filtered.forEach(r => {
    const marker = L.marker([r.lat, r.lon]);
    marker.bindPopup(popupHtml(r), { maxWidth: 280 });
    cluster.addLayer(marker);
  });

  document.getElementById('count').textContent = `${filtered.length} restaurantes mostrados`;
}

function popupHtml(r) {
  const gmaps = `[google.com](https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name) + ' ' + (r.street || 'Madrid'))}`;
  const photos = `[google.com](https://www.google.com/search?tbm=isch&q=${encodeURIComponent(r.name) + ' Madrid restaurante')}`;
  return `
    <div class="popup-card">
      <h3>${escapeHtml(r.name)}</h3>
      ${r.cuisine ? `<div class="meta">🍴 ${escapeHtml(r.cuisine)}</div>` : ''}
      ${r.street ? `<div class="meta">📍 ${escapeHtml(r.street)}</div>` : ''}
      ${r.hours ? `<div class="meta">🕐 ${escapeHtml(r.hours)}</div>` : ''}
      <div class="badges">
        ${r.terrace ? '<span class="badge terrace">Terraza 🌿</span>' : ''}
        ${r.priceRange ? `<span class="badge">${'€'.repeat(r.priceRange)}</span>` : ''}
        ${r.takeaway ? '<span class="badge">Take-away</span>' : ''}
        ${r.delivery ? '<span class="badge">Delivery</span>' : ''}
      </div>
      <div class="actions">
        ${r.website ? `<a href="${r.website}" target="_blank" rel="noopener">🌐 Web</a>` : ''}
        ${r.phone ? `<a href="tel:${r.phone}">📞 Llamar</a>` : ''}
        <a href="${gmaps}" target="_blank" rel="noopener">🗺️ Google Maps</a>
        <a href="${photos}" target="_blank" rel="noopener">📸 Fotos</a>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function setStatus(msg) {
  const el = document.getElementById('status');
  if (el) el.textContent = msg;
}

// --- Eventos UI ---
function bindUI() {
  document.getElementById('filter-cuisine').addEventListener('change', e => { state.filters.cuisine = e.target.value; render(); });
  document.getElementById('filter-district').addEventListener('change', e => { state.filters.district = e.target.value; render(); });
  document.getElementById('filter-terrace').addEventListener('change', e => { state.filters.terrace = e.target.checked; render(); });
  document.getElementById('filter-quality').addEventListener('change', e => { state.filters.quality = e.target.checked; render(); });
  document.getElementById('filter-open-now').addEventListener('change', e => { state.filters.openNow = e.target.checked; render(); });

  document.querySelectorAll('#filter-price button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#filter-price button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filters.price = btn.dataset.value;
      render();
    });
  });

  document.getElementById('reload').addEventListener('click', () => {
    localStorage.removeItem('madrid-restaurants');
    localStorage.removeItem('madrid-restaurants-time');
    loadRestaurants();
  });
}

// Arranque
bindUI();
loadRestaurants();
