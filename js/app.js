import { poles, ambulances, hospitals } from './data.js';
import { WEIGHTS, COOLDOWN_MS, createTracker, trackFrame, crashScore, decide, createCooldown } from './detect.js';
import { nearest, planDispatch, alertMessage, restockMessage, mapsLink, formatTime } from './dispatch.js';
import { WIDTH, HEIGHT, scenarios, trafficAt, scenarioAt, drawFrame } from './camera.js';
import { createFirstAid } from './firstaid.js';
import { createBoxAnimation } from './aidbox.js';

const $ = id => document.getElementById(id);

const SIGNAL_NAMES = {
  overlap: 'Box overlap',
  suddenStop: 'Sudden stop',
  orientation: 'Orientation change',
  personDown: 'Person down near vehicle'
};

const STATUS_TEXT = {
  awaiting: 'Waiting for operator',
  dismissed: 'Dismissed by operator',
  blocked: 'Blocked by cooldown',
  logged: 'Logged, below 0.60',
  restock: 'Restock requested'
};

const incidents = [];
const cooldown = createCooldown();
let selectedPoleId = poles[0].id;
let nextIncidentId = 1;
const restockRequests = new Map();

const camera = {
  scenario: null,
  poleId: null,
  start: 0,
  tracker: createTracker(),
  peak: null,
  finished: false,
  incidentId: null,
  status: 'Monitoring',
  alert: false
};

const canvas = $('camera');
const ctx = canvas.getContext('2d');
const map = createMap();
const poleMarkers = {};
const routeLayer = map ? L.layerGroup().addTo(map) : null;

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

function poleMarkerEl(poleId) {
  return poleMarkers[poleId]?.getElement()?.querySelector('.marker');
}

function drawRoute(pole, plan) {
  if (!map) return;
  routeLayer.clearLayers();
  const note = 'Straight line, not a road route';
  L.polyline([[plan.ambulance.lat, plan.ambulance.lng], [pole.lat, pole.lng]], { color: '#0d6b66', weight: 4, dashArray: '8 6' })
    .bindTooltip(`${plan.ambulance.id} to ${pole.id}: ${note}`)
    .addTo(routeLayer);
  L.polyline([[pole.lat, pole.lng], [plan.hospital.lat, plan.hospital.lng]], { color: '#c0392b', weight: 3, dashArray: '2 6' })
    .bindTooltip(`${pole.id} to ${plan.hospital.name}: ${note}`)
    .addTo(routeLayer);
  map.fitBounds([[plan.ambulance.lat, plan.ambulance.lng], [pole.lat, pole.lng], [plan.hospital.lat, plan.hospital.lng]], { padding: [40, 40] });
}

function poleById(id) {
  return poles.find(p => p.id === id);
}

function selectPole(id) {
  selectedPoleId = id;
  $('pole-select').value = id;
  $('box-pole-select').value = id;
  for (const poleId of Object.keys(poleMarkers)) {
    poleMarkerEl(poleId)?.classList.toggle('selected', poleId === id);
  }
}

function fillPoleSelect() {
  const options = poles.map(p => `<option value="${p.id}">${p.id} - ${p.name}</option>`).join('');
  for (const id of ['pole-select', 'box-pole-select']) {
    $(id).innerHTML = options;
    $(id).addEventListener('change', e => selectPole(e.target.value));
  }
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

function setCameraStatus(incident, text, alert) {
  if (camera.incidentId !== incident.id) return;
  camera.status = `${incident.type} - ${text}`;
  camera.alert = alert;
}

function startScenario(name) {
  Object.assign(camera, {
    scenario: name,
    poleId: selectedPoleId,
    start: performance.now() / 1000,
    tracker: createTracker(),
    peak: null,
    finished: false,
    incidentId: null,
    status: 'Analysing',
    alert: false
  });
  setSimButtons(false);
  setDecision('Analysing clip...', 'busy');
}

function backToLive() {
  Object.assign(camera, {
    scenario: null,
    tracker: createTracker(),
    incidentId: null,
    status: 'Monitoring',
    alert: false
  });
  setSimButtons(true);
  setDecision('Watching traffic.', 'idle');
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
        raiseEvent(scenarios[camera.scenario].type, camera.peak);
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
    poleId: camera.scenario ? camera.poleId : selectedPoleId,
    time: formatTime(new Date()),
    clock,
    status: camera.status,
    alert: camera.alert
  });
  requestAnimationFrame(tick);
}

function raiseEvent(type, result) {
  const pole = poleById(camera.poleId);
  const now = Date.now();
  const decision = decide(result.score);
  const score = result.score.toFixed(2);
  const wait = cooldown.remaining(pole.id, now);
  const incident = { id: nextIncidentId++, time: new Date(now), poleId: pole.id, type, score: result.score };
  incidents.unshift(incident);
  camera.incidentId = incident.id;

  if (decision !== 'log' && wait > 0) {
    incident.status = 'blocked';
    setCameraStatus(incident, 'blocked by cooldown', false);
    setDecision(`${score}: ${pole.id} raised an alert ${Math.round((COOLDOWN_MS - wait) / 1000)} s ago, so this one is blocked for ${Math.ceil(wait / 1000)} s more.`, 'blocked');
  } else if (decision === 'dispatch') {
    cooldown.start(pole.id, now);
    dispatch(incident, 'auto');
    setDecision(`${score} is 0.85 or more: dispatched automatically.`, 'dispatch');
  } else if (decision === 'confirm') {
    cooldown.start(pole.id, now);
    incident.status = 'awaiting';
    setCameraStatus(incident, 'waiting for operator', true);
    setDecision(`${score} is between 0.60 and 0.85: waiting for an operator (see Operator check below).`, 'confirm');
  } else {
    incident.status = 'logged';
    setCameraStatus(incident, 'below threshold', false);
    setDecision(`${score} is below 0.60: logged only, nothing raised.`, 'log');
  }
  renderAll();
}

function dispatch(incident, by) {
  const pole = poleById(incident.poleId);
  incident.status = 'dispatched';
  incident.confirmedBy = by;
  incident.plan = planDispatch(pole, ambulances, hospitals);
  setCameraStatus(incident, by === 'auto' ? 'auto-dispatched' : 'dispatched by operator', true);
  renderAlert(incident, pole);
  drawRoute(pole, incident.plan);
}

function statusText(incident) {
  if (incident.status === 'dispatched') return `Dispatched (${incident.confirmedBy})`;
  return STATUS_TEXT[incident.status];
}

function oldestAwaiting() {
  return incidents.findLast(i => i.status === 'awaiting');
}

function resolveAwaiting(confirmed) {
  const incident = oldestAwaiting();
  if (!incident) return;
  if (confirmed) {
    dispatch(incident, 'operator');
    setDecision(`Operator confirmed ${incident.poleId}: dispatched.`, 'dispatch');
  } else {
    incident.status = 'dismissed';
    setCameraStatus(incident, 'dismissed by operator', false);
    setDecision(`Operator dismissed the alert from ${incident.poleId}.`, 'log');
  }
  renderAll();
}

function renderAlert(incident, pole) {
  const plan = incident.plan;
  const body = $('alert-body');
  body.innerHTML = `
    <dl class="facts">
      <div><dt>Ambulance</dt><dd>${plan.ambulance.id} (${plan.ambulance.crew})<span>${plan.ambulanceKm.toFixed(1)} km straight line, ETA about ${plan.etaMin} min</span></dd></div>
      <div><dt>Hospital</dt><dd>${plan.hospital.name} (TEST)<span>${plan.hospitalKm.toFixed(1)} km from the pole</span></dd></div>
    </dl>
    <pre class="message"></pre>
    <p class="muted">Lines on the map are straight lines between points, not road routes. The ETA assumes the road is about 1.4 times the straight line, driven at 30 km/h.</p>
    <a class="maps-link" href="${mapsLink(pole.lat, pole.lng)}" target="_blank" rel="noopener">Open the pole location in Google Maps</a>`;
  body.querySelector('.message').textContent = alertMessage(incident, pole, plan);
}

function renderConfirm() {
  const incident = oldestAwaiting();
  const panel = $('confirm-panel');
  panel.hidden = !incident;
  if (!incident) return;
  const pole = poleById(incident.poleId);
  $('confirm-text').textContent =
    `${pole.id} (${pole.name}) reports "${incident.type}" with score ${incident.score.toFixed(2)} at ${formatTime(incident.time)}. ` +
    'Check the camera, then confirm to send the nearest ambulance or dismiss it as a false alarm.';
}

function renderFeed() {
  $('feed-empty').hidden = incidents.length > 0;
  $('feed-body').innerHTML = incidents.map(i => `
    <tr>
      <td>${formatTime(i.time)}</td>
      <td>${i.poleId}</td>
      <td>${i.type}</td>
      <td>${i.score === null ? '-' : i.score.toFixed(2)}</td>
      <td><span class="badge badge-${i.status}">${statusText(i)}</span></td>
    </tr>`).join('');
}

function poleLights(poleId, now) {
  const latest = incidents.find(i => i.poleId === poleId && ['awaiting', 'dispatched', 'dismissed'].includes(i.status));
  const left = Math.ceil(cooldown.remaining(poleId, now) / 1000);
  if (latest?.status === 'awaiting') return { green: false, red: 'blink', text: 'Waiting for operator' };
  if (latest?.status === 'dispatched' && left > 0) return { green: false, red: 'on', text: `Help dispatched, cooldown ${left} s` };
  return { green: true, red: 'off', text: left > 0 ? `Watching, cooldown ${left} s` : 'Watching' };
}

function buildStrip() {
  $('pole-strip').innerHTML = poles.map(pole => `
    <li data-pole="${pole.id}">
      <span class="led led-green" aria-hidden="true"></span>
      <span class="led led-red" aria-hidden="true"></span>
      <strong>${pole.id}</strong>
      <span class="muted strip-text"></span>
    </li>`).join('');
}

function renderStrip() {
  const now = Date.now();
  for (const pole of poles) {
    const lights = poleLights(pole.id, now);
    const item = document.querySelector(`[data-pole="${pole.id}"]`);
    item.querySelector('.led-green').classList.toggle('on', lights.green);
    item.querySelector('.led-red').classList.toggle('on', lights.red === 'on');
    item.querySelector('.led-red').classList.toggle('blink', lights.red === 'blink');
    item.querySelector('.strip-text').textContent = lights.text;
    poleMarkerEl(pole.id)?.classList.toggle('alerting', lights.red !== 'off');
  }
}

function boxOpened(poleId) {
  const pole = poleById(poleId);
  const existing = restockRequests.get(poleId);
  if (existing) {
    $('restock-note').textContent = `${pole.id} already asked ${existing.hospital.name} at ${formatTime(existing.time)}, so no second request was sent.`;
    return;
  }
  const time = new Date();
  const { place: hospital, km } = nearest(pole, hospitals);
  restockRequests.set(poleId, { hospital, time });
  incidents.unshift({ id: nextIncidentId++, time, poleId, type: 'First aid box opened', score: null, status: 'restock' });
  $('restock-body').innerHTML = `
    <pre class="message"></pre>
    <p class="muted" id="restock-note">Sent to the nearest hospital by straight-line distance. One request per opening until the box is marked restocked.</p>`;
  $('restock-body').querySelector('.message').textContent = restockMessage(pole, hospital, km, time);
  renderAll();
}

function renderBoxStatus() {
  $('box-status').innerHTML = poles.map(pole => {
    const request = restockRequests.get(pole.id);
    if (!request) return `<li><strong>${pole.id}</strong><span class="badge badge-logged">Stocked</span></li>`;
    return `
      <li>
        <strong>${pole.id}</strong>
        <span class="badge badge-restock">Restock requested, ${formatTime(request.time)}</span>
        <button type="button" class="btn btn-quiet btn-small" data-restocked="${pole.id}">Mark restocked</button>
      </li>`;
  }).join('');
}

function renderAll() {
  renderConfirm();
  renderFeed();
  renderStrip();
  renderBoxStatus();
}

let aidLang = 'en';
let aidPlaying = false;

const firstAid = createFirstAid({
  onStep(index, total, text) {
    $('aid-progress').textContent = `Step ${index + 1} of ${total}`;
    $('aid-caption').textContent = text;
  },
  onNote(text) {
    $('aid-note').textContent = text;
  },
  onDone() {
    setAidPlaying(false);
    $('aid-progress').textContent = 'Finished';
  }
});

let boxPoleId = selectedPoleId;

const boxAnimation = createBoxAnimation($('box-scene'), {
  onStep(index, total, text) {
    $('box-progress').textContent = `Step ${index + 1} of ${total} (${boxPoleId})`;
    $('box-caption').textContent = text;
    if (index === 0) boxOpened(boxPoleId);
  },
  onDone() {
    $('btn-box').disabled = false;
    $('box-progress').textContent = 'Finished';
  }
});

function setAidPlaying(playing) {
  aidPlaying = playing;
  const button = $('btn-aid');
  button.textContent = playing ? 'Stop' : 'Play First Aid';
  button.classList.toggle('btn-ok', !playing);
  button.classList.toggle('btn-quiet', playing);
}

function toggleFirstAid() {
  if (aidPlaying) {
    firstAid.stop();
    setAidPlaying(false);
    $('aid-progress').textContent = 'Stopped';
    return;
  }
  setAidPlaying(true);
  firstAid.play(aidLang, $('aid-captions-only').checked);
}

function setAidLang(lang) {
  aidLang = lang;
  for (const button of document.querySelectorAll('.seg')) {
    button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
  }
  if (aidPlaying) toggleFirstAid();
}

$('btn-crash').addEventListener('click', () => startScenario('crash'));
$('btn-person').addEventListener('click', () => startScenario('person'));
$('btn-live').addEventListener('click', backToLive);
$('btn-confirm').addEventListener('click', () => resolveAwaiting(true));
$('btn-dismiss').addEventListener('click', () => resolveAwaiting(false));
$('btn-aid').addEventListener('click', toggleFirstAid);
$('btn-box').addEventListener('click', () => {
  boxPoleId = selectedPoleId;
  $('btn-box').disabled = true;
  boxAnimation.play();
});
$('box-status').addEventListener('click', e => {
  const poleId = e.target.dataset.restocked;
  if (!poleId) return;
  restockRequests.delete(poleId);
  renderBoxStatus();
});
for (const button of document.querySelectorAll('.seg')) {
  button.addEventListener('click', () => setAidLang(button.dataset.lang));
}

fillPoleSelect();
buildStrip();
addMarkers();
selectPole(selectedPoleId);
renderAll();
setInterval(renderStrip, 1000);
new ResizeObserver(resizeCanvas).observe(canvas);
resizeCanvas();
requestAnimationFrame(tick);
