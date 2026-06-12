var state = {
  restaurants: [],
  filters: { cuisine: '', district: '', price: '', terrace: false, quality: true }
};

var map = L.map('map').setView([40.4168, -3.7038], 13);
L.tileLayer('[%7Bs%7D.tile.openstreetmap.org](https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png)', {
  attribution: '© OpenStreetMap',
  maxZoom: 19
}).addTo(map);

var cluster = L.markerClusterGroup({ maxClusterRadius: 50 });
map.addLayer(cluster);

var OVERPASS_SERVERS = [
  '[overpass-api.de](https://overpass-api.de/api/interpreter)',
  '[overpass.kumi.systems](https://overpass.kumi.systems/api/interpreter)',
  '[overpass.private.coffee](https://overpass.private.coffee/api/interpreter)'
];

var QUERY = '[out:json][timeout:60];area["name"="Madrid"]["admin_level"="8"]->.madrid;(node["amenity"="restaurant"](area.madrid);way["amenity"="restaurant"](area.madrid););out center tags;';

function setStatus(msg) {
  var el = document.getElementById('status');
  if (el) el.textContent = msg;
}

async function loadRestaurants() {
  setStatus('Cargando restaurantes…');

  var cached = localStorage.getItem('madrid-restaurants');
  var cachedTime = localStorage.getItem('madrid-restaurants-time');
  var ONE_DAY = 86400000;

  if (cached && cachedTime && Date.now() - parseInt(cachedTime) < ONE_DAY) {
    try {
      state.restaurants = JSON.parse(cached);
      setStatus('Desde caché: ' + state.restaurants.length + ' restaurantes');
      render();
      return;
    } catch (e) {}
  }

  for (var i = 0; i < OVERPASS_SERVERS.length; i++) {
    var url = OVERPASS_SERVERS[i];
    try {
      setStatus('Conectando (servidor ' + (i+1) + ')…');
      var res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(QUERY),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      state.restaurants = (data.elements || []).map(parseElement).filter(Boolean);
      try {
        localStorage.setItem('madrid-restaurants', JSON.stringify(state.restaurants));
        localStorage.setItem('madrid-restaurants-time', Date.now().toString());
      } catch (e) {}
      setStatus('✅ ' + state.restaurants.length + ' restaurantes cargados');
      render();
      return;
    } catch (err) {
      console.warn('Falló servidor', url, err);
    }
  }
  setStatus('❌ No se pudo conectar. Espera 1 minuto y pulsa Recargar.');
}

function parseElement(el) {
  var lat = el.lat != null ? el.lat : (el.center && el.center.lat);
  var lon = el.lon != null ? el.lon : (el.center && el.center.lon);
  if (!lat || !lon) return null;
  var t = el.tags || {};
  if (!t.name) return null;

  return {
    id: el.id,
    name: t.name,
    lat: lat,
    lon: lon,
    cuisine: (t.cuisine || '').toLowerCase(),
    district: t['addr:district'] || t['addr:suburb'] || t['addr:city'] || '',
    street: [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' '),
    phone: t.phone || t['contact:phone'] || '',
    website: t.website || t['contact:website'] || '',
    hours: t.opening_hours || '',
    priceRange: parsePrice(t),
    terrace: t.outdoor_seating === 'yes'
  };
}

function parsePrice(t) {
  if (t.price_range) {
    var n = parseInt(t.price_range);
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
  var groups = {
    spanish: ['spanish', 'tapas', 'castilian', 'andalusian'],
    italian: ['italian', 'pizza', 'pasta'],
    asian: ['asian', 'chinese', 'japanese', 'thai', 'vietnamese', 'korean'],
    seafood: ['seafood', 'fish'],
    vegetarian: ['vegetarian', 'vegan'],
    tapas: ['tapas'],
    pizza: ['pizza'],
    burger: ['burger', 'american']
  };
  var accepted = groups[value] || [value];
  for (var i = 0; i < accepted.length; i++) {
    if (r.cuisine.indexOf(accepted[i]) !== -1) return true;
  }
  return false;
}

function render() {
  cluster.clearLayers();
  var f = state.filters;
  var filtered = state.restaurants.filter(function(r) {
    if (f.quality && !isQuality(r)) return false;
    if (f.terrace && !r.terrace) return false;
    if (f.district && r.district.toLowerCase().indexOf(f.district.toLowerCase()) === -1) return false;
    if (f.price && r.priceRange !== parseInt(f.price)) return false;
    if (!matchesCuisine(r, f.cuisine)) return false;
    return true;
  });

  filtered.forEach(function(r) {
    var marker = L.marker([r.lat, r.lon]);
    marker.bindPopup(popupHtml(r), { maxWidth: 280 });
    cluster.addLayer(marker);
  });

  document.getElementById('count').textContent = filtered.length + ' restaurantes mostrados';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
  });
}

function popupHtml(r) {
  var query = encodeURIComponent(r.name + ' ' + (r.street || 'Madrid'));
  var gmaps = '[google.com](https://www.google.com/maps/search/?api=1&query=)' + query;
  var photos = '[google.com](https://www.google.com/search?tbm=isch&q=)' + encodeURIComponent(r.name + ' Madrid restaurante');

  var html = '<div class="popup-card">';
  html += '<h3>' + escapeHtml(r.name) + '</h3>';
  if (r.cuisine) html += '<div class="meta">🍴 ' + escapeHtml(r.cuisine) + '</div>';
  if (r.street) html += '<div class="meta">📍 ' + escapeHtml(r.street) + '</div>';
  if (r.hours) html += '<div class="meta">🕐 ' + escapeHtml(r.hours) + '</div>';

  html += '<div class="badges">';
  if (r.terrace) html += '<span class="badge terrace">Terraza 🌿</span>';
  if (r.priceRange) {
    var euros = '';
    for (var i = 0; i < r.priceRange; i++) euros += '€';
    html += '<span class="badge">' + euros + '</span>';
  }
  html += '</div>';

  html += '<div class="actions">';
  if (r.website) html += '<a href="' + r.website + '" target="_blank" rel="noopener">🌐 Web</a>';
  if (r.phone) html += '<a href="tel:' + r.phone + '">📞 Llamar</a>';
  html += '<a href="' + gmaps + '" target="_blank" rel="noopener">🗺️ Maps</a>';
  html += '<a href="' + photos + '" target="_blank" rel="noopener">📸 Fotos</a>';
  html += '</div></div>';

  return html;
}

// Eventos UI
document.getElementById('filter-cuisine').addEventListener('change', function(e) {
  state.filters.cuisine = e.target.value; render();
});
document.getElementById('filter-district').addEventListener('change', function(e) {
  state.filters.district = e.target.value; render();
});
document.getElementById('filter-terrace').addEventListener('change', function(e) {
  state.filters.terrace = e.target.checked; render();
});
document.getElementById('filter-quality').addEventListener('change', function(e) {
  state.filters.quality = e.target.checked; render();
});

var priceButtons = document.querySelectorAll('#filter-price button');
for (var i = 0; i < priceButtons.length; i++) {
  priceButtons[i].addEventListener('click', function(e) {
    for (var j = 0; j < priceButtons.length; j++) priceButtons[j].classList.remove('active');
    e.target.classList.add('active');
    state.filters.price = e.target.getAttribute('data-value');
    render();
  });
}

document.getElementById('reload').addEventListener('click', function() {
  localStorage.removeItem('madrid-restaurants');
  localStorage.removeItem('madrid-restaurants-time');
  loadRestaurants();
});

loadRestaurants();
