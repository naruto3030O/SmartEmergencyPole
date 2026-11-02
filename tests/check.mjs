// Quick checks for the pure logic. Run with: node tests/check.mjs
import assert from 'node:assert/strict';
import { haversineKm, nearest, etaMinutes, mapsLink, planDispatch } from '../js/dispatch.js';
import { boxOf, overlapRatio, crashScore, decide, createCooldown, createTracker, trackFrame } from '../js/detect.js';
import { poles, ambulances, hospitals } from '../js/data.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  process.stdout.write(`ok  ${name}\n`);
}

check('one degree of latitude is about 111.2 km', () => {
  assert.ok(Math.abs(haversineKm({ lat: 28, lng: 77 }, { lat: 29, lng: 77 }) - 111.19) < 0.05);
});

check('Delhi to Mumbai is about 1150 km', () => {
  const km = haversineKm({ lat: 28.6139, lng: 77.209 }, { lat: 19.076, lng: 72.8777 });
  assert.ok(km > 1140 && km < 1160, `got ${km}`);
});

check('nearest picks the closest of a list', () => {
  const list = [{ id: 'far', lat: 29, lng: 77 }, { id: 'near', lat: 28.01, lng: 77 }];
  assert.equal(nearest({ lat: 28, lng: 77 }, list).place.id, 'near');
});

check('every pole gets the same unit as a brute-force flat-earth check', () => {
  // Over a few km an equirectangular estimate ranks places the same way.
  const flat = (a, b) => Math.hypot(b.lat - a.lat, (b.lng - a.lng) * Math.cos(a.lat * Math.PI / 180));
  for (const pole of poles) {
    const expectAmb = [...ambulances].sort((a, b) => flat(pole, a) - flat(pole, b))[0];
    const expectHosp = [...hospitals].sort((a, b) => flat(pole, a) - flat(pole, b))[0];
    const plan = planDispatch(pole, ambulances, hospitals);
    assert.equal(plan.ambulance.id, expectAmb.id, pole.id);
    assert.equal(plan.hospital.id, expectHosp.id, pole.id);
  }
});

check('ETA is never below one minute', () => {
  assert.equal(etaMinutes(0), 1);
  assert.equal(etaMinutes(5), 14);
});

check('maps link uses 5 decimals', () => {
  assert.equal(mapsLink(28.503, 77.0885), 'https://www.google.com/maps?q=28.50300,77.08850');
});

check('rotated box grows to contain the rotated object', () => {
  const box = boxOf({ x: 0, y: 0, w: 70, h: 34, angle: Math.PI / 2 });
  assert.ok(Math.abs(box.x1 - box.x0 - 34) < 1e-9 && Math.abs(box.y1 - box.y0 - 70) < 1e-9);
});

check('overlap is measured against the smaller box', () => {
  const big = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const small = { x0: 90, y0: 0, x1: 110, y1: 10 };
  assert.equal(overlapRatio(big, small), 0.5);
  assert.equal(overlapRatio(big, { x0: 200, y0: 0, x1: 210, y1: 10 }), 0);
});

check('score uses the 0.4 / 0.3 / 0.2 / 0.1 weights', () => {
  assert.equal(crashScore({ overlap: 1, suddenStop: 1, orientation: 1, personDown: 1 }).score, 1);
  assert.equal(crashScore({ overlap: 1, suddenStop: 0, orientation: 0, personDown: 0 }).score, 0.4);
  assert.equal(crashScore({ overlap: 0.5, suddenStop: 1, orientation: 0.5, personDown: 0 }).score, 0.6);
});

check('thresholds: >= 0.85 dispatch, 0.60-0.85 confirm, below logs', () => {
  assert.equal(decide(0.85), 'dispatch');
  assert.equal(decide(0.84), 'confirm');
  assert.equal(decide(0.6), 'confirm');
  assert.equal(decide(0.59), 'log');
});

check('cooldown is 30 s per pole', () => {
  const cooldown = createCooldown();
  cooldown.start('SEP-01', 1000);
  assert.equal(cooldown.remaining('SEP-01', 11000), 20000);
  assert.equal(cooldown.remaining('SEP-01', 31000), 0);
  assert.equal(cooldown.remaining('SEP-02', 11000), 0);
});

check('a car braking from speed to zero reads as a sudden stop', () => {
  const tracker = createTracker();
  let features;
  for (let i = 0; i <= 30; i++) {
    const t = i / 30;
    const x = t < 0.6 ? 150 * t : 90;
    features = trackFrame(tracker, [{ id: 'a', kind: 'car', x, y: 0, w: 70, h: 34, angle: 0 }], t);
  }
  assert.equal(features.suddenStop, 1);
  assert.equal(features.overlap, 0);
});

process.stdout.write(`\n${passed} checks passed\n`);
