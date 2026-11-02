import { poles, ambulances, hospitals } from './data.js';
import { WEIGHTS, COOLDOWN_MS, createTracker, trackFrame, crashScore, decide, createCooldown } from './detect.js';
import { formatTime } from './dispatch.js';
import { WIDTH, HEIGHT, scenarios, trafficAt, scenarioAt, drawFrame } from './camera.js';

const $ = id => document.getElementById(id);

const SIGNAL_NAMES = {
  overlap: 'Box overlap',
  suddenStop: 'Sudden stop',
  orientation: 'Orientation change',
  personDown: 'Person down near vehicle'
};

const state = {
  poleId: poles[0].id
};

const cooldown = createCooldown();
const camera = {
  scenario: null,
  poleId: null,
  start: 0,
  tracker: createTracker(),
  peak: null,
  finished: false,
  status: 'Monitoring',
  alert: false
};

const canvas = $('camera');
const ctx = canvas.getContext('2d');
const map = createMap();
const poleMarkers = {};

function createMap() {
  const el = $('map');
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

function poleById(id) {
  return poles.find(p => p.id === id);
}

function selectPole(id) {
  state.poleId = id;
  $('pole-select').value = id;
  for (const [poleId, marker] of Object.entries(poleMarkers)) {
    marker.getElement()?.querySelector('.marker').classList.toggle('selected', poleId === id);
  }
}

function fillPoleSelect() {
  $('pole-select').innerHTML = poles.map(p => `<option value="${p.id}">${p.id} - ${p.name}</option>`).join('');
  $('pole-select').addEventListener('change', e => selectPole(e.target.value));
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round((width * HEIGHT / WIDTH) * dpr);
  ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
}

function showScore(result, label) {
  $('score-label').textContent = label;
  $('score-value').textContent = result.score.toFixed(2);
  const bar = $('score-bar');
  bar.style.width = `${Math.min(100, result.score * 100)}%`;
  bar.dataset.level = decide(result.score);
  $('breakdown').innerHTML = Object.keys(WEIGHTS).map(key => `
    <tr>
      <td>${SIGNAL_NAMES[key]}</td>
      <td>${result.features[key].toFixed(2)}</td>
      <td>${WEIGHTS[key].toFixed(1)}</td>
      <td>${result.parts[key].toFixed(2)}</td>
    </tr>`).join('');
}

function setDecision(text, level) {
  const el = $('decision');
  el.textContent = text;
  el.dataset.level = level;
}

function setSimButtons(enabled) {
  $('btn-crash').disabled = !enabled;
  $('btn-person').disabled = !enabled;
}

function startScenario(name) {
  camera.scenario = name;
  camera.poleId = state.poleId;
  camera.start = performance.now() / 1000;
  camera.tracker = createTracker();
  camera.peak = null;
  camera.finished = false;
  camera.status = 'Analysing';
  camera.alert = false;
  setSimButtons(false);
  setDecision('Analysing clip...', 'busy');
}

function backToLive() {
  camera.scenario = null;
  camera.tracker = createTracker();
  camera.status = 'Monitoring';
  camera.alert = false;
  setSimButtons(true);
  setDecision('Watching traffic.', 'idle');
}

function raiseEvent(name, result) {
  const pole = poleById(camera.poleId);
  const type = scenarios[name].type;
  const now = Date.now();
  const decision = decide(result.score);
  const score = result.score.toFixed(2);
  const wait = cooldown.remaining(pole.id, now);

  if (decision !== 'log' && wait > 0) {
    camera.status = `${type} - blocked by cooldown`;
    setDecision(`${score}: ${pole.id} raised an alert ${Math.round((COOLDOWN_MS - wait) / 1000)} s ago, so this one is blocked for ${Math.ceil(wait / 1000)} s more.`, 'blocked');
    return;
  }
  if (decision === 'dispatch') {
    cooldown.start(pole.id, now);
    camera.status = `${type} - auto-dispatched`;
    camera.alert = true;
    setDecision(`${score} is 0.85 or more: dispatched automatically.`, 'dispatch');
  } else if (decision === 'confirm') {
    cooldown.start(pole.id, now);
    camera.status = `${type} - waiting for operator`;
    camera.alert = true;
    setDecision(`${score} is between 0.60 and 0.85: waiting for an operator to confirm.`, 'confirm');
  } else {
    camera.status = `${type} - below threshold`;
    setDecision(`${score} is below 0.60: logged only, nothing raised.`, 'log');
  }
}

let lastPanelUpdate = 0;

function tick(nowMs) {
  const clock = nowMs / 1000;
  let objects;
  let liveResult = null;

  if (camera.scenario) {
    const duration = scenarios[camera.scenario].duration;
    const t = Math.min(clock - camera.start, duration);
    objects = scenarioAt(camera.scenario, t);
    if (!camera.finished) {
      liveResult = crashScore(trackFrame(camera.tracker, objects, t));
      if (!camera.peak || liveResult.score > camera.peak.score) camera.peak = liveResult;
      if (t >= duration) {
        camera.finished = true;
        showScore(camera.peak, 'Peak score in clip');
        raiseEvent(camera.scenario, camera.peak);
        setSimButtons(true);
      }
    }
  } else {
    objects = trafficAt(clock);
    liveResult = crashScore(trackFrame(camera.tracker, objects, clock));
  }

  if (liveResult && !camera.finished && nowMs - lastPanelUpdate > 100) {
    showScore(liveResult, 'Live score');
    lastPanelUpdate = nowMs;
  }

  drawFrame(ctx, objects, {
    poleId: camera.scenario ? camera.poleId : state.poleId,
    time: formatTime(new Date()),
    clock,
    status: camera.status,
    alert: camera.alert
  });
  requestAnimationFrame(tick);
}

$('btn-crash').addEventListener('click', () => startScenario('crash'));
$('btn-person').addEventListener('click', () => startScenario('person'));
$('btn-live').addEventListener('click', backToLive);

fillPoleSelect();
addMarkers();
selectPole(state.poleId);
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();
requestAnimationFrame(tick);
