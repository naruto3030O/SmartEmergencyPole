export const AUTO_DISPATCH = 0.85;
export const NEEDS_CONFIRM = 0.6;
export const COOLDOWN_MS = 30000;

export const WEIGHTS = {
  overlap: 0.4,
  suddenStop: 0.3,
  orientation: 0.2,
  personDown: 0.1
};

// From a fixed camera even a hard crash rarely covers more than half of the
// smaller box, so half the smaller box counts as full overlap.
const FULL_OVERLAP = 0.5;
const HISTORY_S = 1.5;
// Speed lost inside a short window. A car here is ~64 px (about 4.5 m), so
// losing 120 px/s in 0.6 s is roughly 1.4 g: crash territory, not braking.
const STOP_WINDOW_S = 0.6;
const HARD_STOP_DROP = 120;
const NEAR_VEHICLE_PX = 60;

const clamp01 = v => Math.min(1, Math.max(0, v));

// Detectors give axis-aligned boxes, so a rotated vehicle gets a bigger box.
export function boxOf(obj) {
  const cos = Math.abs(Math.cos(obj.angle));
  const sin = Math.abs(Math.sin(obj.angle));
  const w = obj.w * cos + obj.h * sin;
  const h = obj.w * sin + obj.h * cos;
  return { x0: obj.x - w / 2, y0: obj.y - h / 2, x1: obj.x + w / 2, y1: obj.y + h / 2 };
}

function area(box) {
  return (box.x1 - box.x0) * (box.y1 - box.y0);
}

export function overlapRatio(a, b) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(area(a), area(b));
}

function boxGap(a, b) {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return Math.hypot(dx, dy);
}

function angleBetween(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

export function isLying(person) {
  return Math.abs(Math.sin(person.angle)) > 0.7;
}

function frameOverlap(objects) {
  let best = 0;
  for (let i = 0; i < objects.length; i++) {
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i];
      const b = objects[j];
      if (a.kind === 'person' && b.kind === 'person') continue;
      best = Math.max(best, overlapRatio(boxOf(a), boxOf(b)));
    }
  }
  return best;
}

function suddenStop(samples) {
  const recent = samples.filter(s => samples.at(-1).t - s.t <= STOP_WINDOW_S);
  const speeds = [];
  for (let i = 1; i < recent.length; i++) {
    const dt = recent[i].t - recent[i - 1].t;
    if (dt > 0) speeds.push(Math.hypot(recent[i].x - recent[i - 1].x, recent[i].y - recent[i - 1].y) / dt);
  }
  if (speeds.length < 2) return 0;
  return clamp01((Math.max(...speeds) - speeds.at(-1)) / HARD_STOP_DROP);
}

function orientationChange(samples) {
  const now = samples.at(-1).angle;
  const turned = Math.max(...samples.map(s => angleBetween(now, s.angle)));
  return clamp01(turned / (Math.PI / 2));
}

function personDownNearVehicle(objects) {
  const vehicles = objects.filter(o => o.kind === 'car');
  return objects.some(o =>
    o.kind === 'person' && isLying(o) &&
    vehicles.some(v => boxGap(boxOf(o), boxOf(v)) <= NEAR_VEHICLE_PX)
  );
}

export function createTracker() {
  return { tracks: new Map(), overlaps: [] };
}

// Feeds one frame of detections in and returns the four features, each 0..1.
export function trackFrame(tracker, objects, t) {
  const seen = new Set();
  for (const obj of objects) {
    seen.add(obj.id);
    const samples = tracker.tracks.get(obj.id) ?? [];
    samples.push({ t, x: obj.x, y: obj.y, angle: obj.angle });
    while (t - samples[0].t > HISTORY_S) samples.shift();
    tracker.tracks.set(obj.id, samples);
  }
  for (const id of tracker.tracks.keys()) {
    if (!seen.has(id)) tracker.tracks.delete(id);
  }

  tracker.overlaps.push({ t, value: frameOverlap(objects) });
  while (t - tracker.overlaps[0].t > HISTORY_S) tracker.overlaps.shift();

  let stop = 0;
  let turn = 0;
  for (const obj of objects) {
    const samples = tracker.tracks.get(obj.id);
    if (obj.kind === 'car') stop = Math.max(stop, suddenStop(samples));
    turn = Math.max(turn, orientationChange(samples));
  }

  return {
    overlap: clamp01(Math.max(...tracker.overlaps.map(o => o.value)) / FULL_OVERLAP),
    suddenStop: stop,
    orientation: turn,
    personDown: personDownNearVehicle(objects) ? 1 : 0
  };
}

export function crashScore(features) {
  const parts = {};
  let total = 0;
  for (const [key, weight] of Object.entries(WEIGHTS)) {
    parts[key] = weight * features[key];
    total += parts[key];
  }
  // Round once so the number on screen is the number the rules use.
  return { score: Math.round(total * 100) / 100, parts, features };
}

export function decide(score) {
  if (score >= AUTO_DISPATCH) return 'dispatch';
  if (score >= NEEDS_CONFIRM) return 'confirm';
  return 'log';
}

export function createCooldown(ms = COOLDOWN_MS) {
  const lastAlert = new Map();
  return {
    remaining(poleId, now) {
      const t = lastAlert.get(poleId);
      return t === undefined ? 0 : Math.max(0, t + ms - now);
    },
    start(poleId, now) {
      lastAlert.set(poleId, now);
    }
  };
}
