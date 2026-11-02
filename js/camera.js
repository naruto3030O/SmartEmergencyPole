import { boxOf, overlapRatio } from './detect.js';

export const WIDTH = 640;
export const HEIGHT = 360;

const ROAD_TOP = 122;
const ROAD_BOTTOM = 258;
const WEST_Y = 156;
const EAST_Y = 224;
const CAR_SIZE = { w: 64, h: 30 };
const PERSON_SIZE = { w: 12, h: 26 };
const LIGHT_CAR = '#d9d6cc';
const DARK_CAR = '#a9844f';

export const scenarios = {
  crash: { type: 'Vehicle collision', duration: 4.2 },
  person: { type: 'Person down', duration: 4.6 }
};

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = u => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeOut = u => 1 - (1 - clamp01(u)) ** 2;

function car(id, x, y, angle, color) {
  return { id, kind: 'car', x, y, angle, color, ...CAR_SIZE };
}

function person(id, x, y, angle) {
  return { id, kind: 'person', x, y, angle, ...PERSON_SIZE };
}

// Normal traffic. A car that leaves the frame comes back as a new track.
export function trafficAt(clock) {
  const span = WIDTH + 120;
  const a = clock * 120;
  const b = clock * 95 + 380;
  return [
    car(`a${Math.floor(a / span)}`, -60 + (a % span), EAST_Y, 0, LIGHT_CAR),
    car(`b${Math.floor(b / span)}`, WIDTH + 60 - (b % span), WEST_Y, Math.PI, DARK_CAR),
    person('walker', 470, 270, 0)
  ];
}

// Westbound car drifts into the eastbound lane and hits an oncoming car head on.
function crashAt(t) {
  const speed = 150;
  const swerveStart = 1.2;
  const impact = 2.3;
  const ti = Math.min(t, impact);
  const drift = EAST_Y - 8 - WEST_Y;
  const u = clamp01((ti - swerveStart) / (impact - swerveStart));
  const driftSpeed = drift * 6 * u * (1 - u) / (impact - swerveStart);

  let ax = -40 + speed * ti;
  let ay = EAST_Y;
  let aAngle = 0;
  let bx = WIDTH + 40 - speed * ti;
  let by = WEST_Y + drift * smooth(u);
  let bAngle = Math.atan2(driftSpeed, -speed);

  if (t > impact) {
    const k = easeOut((t - impact) / 0.35);
    ax += 14 * k;
    ay += 16 * k;
    aAngle += 0.9 * k;
    bx -= 8 * k;
    by -= 14 * k;
    bAngle -= 1.75 * k;
  }
  return [car('crash-a', ax, ay, aAngle, LIGHT_CAR), car('crash-b', bx, by, bAngle, DARK_CAR)];
}

// A pedestrian freezes in the lane, a car brakes late, nudges them and they fall.
function personDownAt(t) {
  const speed = 140;
  const brakeAt = 1.75;
  const decel = 140;
  const tb = clamp01((t - brakeAt) / (speed / decel)) * (speed / decel);
  const ax = t < brakeAt ? -40 + speed * t : -40 + speed * brakeAt + speed * tb - (decel * tb * tb) / 2;

  const walk = clamp01((t - 0.4) / 1.1);
  const fall = smooth((t - 2.4) / 0.45);
  return [
    car('ped-car', ax, EAST_Y, 0, LIGHT_CAR),
    car('ped-b', WIDTH + 40 - 95 * t, WEST_Y, Math.PI, DARK_CAR),
    person('ped', 302 + 16 * fall, 270 - 40 * walk + 4 * fall, (Math.PI / 2) * fall)
  ];
}

export function scenarioAt(name, t) {
  return name === 'crash' ? crashAt(t) : personDownAt(t);
}

function confidence(obj, objects, clock) {
  const base = obj.kind === 'car' ? 0.93 : 0.82;
  let hidden = 0;
  for (const other of objects) {
    if (other !== obj) hidden = Math.max(hidden, overlapRatio(boxOf(obj), boxOf(other)));
  }
  const wobble = 0.02 * Math.sin(clock * 3 + obj.x * 0.05);
  return Math.min(0.99, base - 0.25 * hidden + wobble);
}

function drawRoad(ctx) {
  ctx.fillStyle = '#2b302d';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#4b504c';
  ctx.fillRect(0, ROAD_TOP - 22, WIDTH, 22);
  ctx.fillRect(0, ROAD_BOTTOM, WIDTH, 24);
  ctx.fillStyle = '#3b3f43';
  ctx.fillRect(0, ROAD_TOP, WIDTH, ROAD_BOTTOM - ROAD_TOP);

  ctx.strokeStyle = '#cfcfc4';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, ROAD_TOP + 3);
  ctx.lineTo(WIDTH, ROAD_TOP + 3);
  ctx.moveTo(0, ROAD_BOTTOM - 3);
  ctx.lineTo(WIDTH, ROAD_BOTTOM - 3);
  ctx.stroke();

  ctx.setLineDash([22, 18]);
  ctx.beginPath();
  ctx.moveTo(0, (ROAD_TOP + ROAD_BOTTOM) / 2);
  ctx.lineTo(WIDTH, (ROAD_TOP + ROAD_BOTTOM) / 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCar(ctx, obj) {
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.angle);
  ctx.fillStyle = obj.color;
  ctx.beginPath();
  ctx.roundRect(-obj.w / 2, -obj.h / 2, obj.w, obj.h, 6);
  ctx.fill();
  ctx.fillStyle = '#26292c';
  ctx.fillRect(obj.w / 2 - 22, -obj.h / 2 + 4, 9, obj.h - 8);
  ctx.fillRect(-obj.w / 2 + 8, -obj.h / 2 + 5, 7, obj.h - 10);
  ctx.restore();
}

function drawPerson(ctx, obj) {
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.angle);
  ctx.fillStyle = '#d7c9a6';
  ctx.beginPath();
  ctx.roundRect(-obj.w / 2 + 1, -obj.h / 2 + 8, obj.w - 2, obj.h - 8, 4);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -obj.h / 2 + 4, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBox(ctx, obj, conf, alert) {
  const box = boxOf(obj);
  const color = alert ? '#ff6b57' : obj.kind === 'car' ? '#6fd3c8' : '#f2c14e';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);

  const text = `${obj.kind} ${conf.toFixed(2)}`;
  ctx.font = '11px ui-monospace, Consolas, monospace';
  const width = ctx.measureText(text).width + 8;
  ctx.fillStyle = color;
  ctx.fillRect(box.x0, box.y0 - 15, width, 14);
  ctx.fillStyle = '#111';
  ctx.fillText(text, box.x0 + 4, box.y0 - 4);
}

function drawHud(ctx, hud) {
  ctx.font = '12px ui-monospace, Consolas, monospace';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, WIDTH, 22);
  ctx.fillStyle = '#e8e8e0';
  ctx.fillText(`CAM ${hud.poleId}  SIMULATED`, 8, 15);
  const clock = hud.time;
  ctx.fillText(clock, WIDTH - ctx.measureText(clock).width - 8, 15);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, HEIGHT - 22, WIDTH, 22);
  ctx.fillStyle = hud.alert ? '#ff8a7a' : '#e8e8e0';
  ctx.fillText(hud.status, 8, HEIGHT - 7);
}

export function drawFrame(ctx, objects, hud) {
  drawRoad(ctx);
  for (const obj of objects.filter(o => o.kind === 'car')) drawCar(ctx, obj);
  for (const obj of objects.filter(o => o.kind === 'person')) drawPerson(ctx, obj);
  for (const obj of objects) drawBox(ctx, obj, confidence(obj, objects, hud.clock), hud.alert);
  drawHud(ctx, hud);
}
