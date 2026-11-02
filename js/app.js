import { poles, ambulances, hospitals } from './data.js';

const state = {
  poleId: poles[0].id
};

const map = createMap();
const poleMarkers = {};

function createMap() {
  const el = document.getElementById('map');
  // Leaflet comes from a CDN; the rest of the demo still works without it.
  if (!window.L) {
    el.innerHTML = '<div class="map-fallback">Map tiles could not load (no internet?). Detection and dispatch still work.</div>';
    return null;
  }
  const m = L.map(el, { scrollWheelZoom: false });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(m);
  return m;
}

function markerIcon(kind, text) {
  return L.divIcon({
    className: '',
    html: `<span class="marker marker-${kind}">${text}</span>`,
    iconSize: kind === 'pole' ? [26, 18] : [20, 20]
  });
}

function addMarkers() {
  if (!map) return;
  const all = [];
  for (const pole of poles) {
    const marker = L.marker([pole.lat, pole.lng], { icon: markerIcon('pole', pole.id.slice(-2)), keyboard: true, title: pole.id })
      .bindTooltip(`${pole.id} - ${pole.name}`)
      .on('click', () => selectPole(pole.id))
      .addTo(map);
    poleMarkers[pole.id] = marker;
    all.push([pole.lat, pole.lng]);
  }
  for (const amb of ambulances) {
    L.marker([amb.lat, amb.lng], { icon: markerIcon('amb', amb.id.slice(-1)), title: amb.id })
      .bindTooltip(`${amb.id} (TEST) - ${amb.crew}`)
      .addTo(map);
    all.push([amb.lat, amb.lng]);
  }
  for (const hosp of hospitals) {
    L.marker([hosp.lat, hosp.lng], { icon: markerIcon('hosp', 'H'), title: hosp.name })
      .bindTooltip(`${hosp.name} (TEST)`)
      .addTo(map);
    all.push([hosp.lat, hosp.lng]);
  }
  map.fitBounds(all, { padding: [24, 24] });
}

function selectPole(id) {
  state.poleId = id;
  for (const [poleId, marker] of Object.entries(poleMarkers)) {
    marker.getElement()?.querySelector('.marker').classList.toggle('selected', poleId === id);
  }
}

addMarkers();
selectPole(state.poleId);
