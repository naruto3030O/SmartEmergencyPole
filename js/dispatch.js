const EARTH_RADIUS_KM = 6371;
// Rough guess: roads are ~1.4x the straight line, ambulance averages 30 km/h in traffic.
const ROAD_FACTOR = 1.4;
const AVG_SPEED_KMH = 30;

const toRad = deg => (deg * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export function nearest(point, places) {
  let best = null;
  for (const place of places) {
    const km = haversineKm(point, place);
    if (!best || km < best.km) best = { place, km };
  }
  return best;
}

export function etaMinutes(km) {
  return Math.max(1, Math.round((km * ROAD_FACTOR / AVG_SPEED_KMH) * 60));
}

export function mapsLink(lat, lng) {
  return `https://www.google.com/maps?q=${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export function planDispatch(pole, ambulances, hospitals) {
  const unit = nearest(pole, ambulances);
  const hospital = nearest(pole, hospitals);
  return {
    ambulance: unit.place,
    ambulanceKm: unit.km,
    etaMin: etaMinutes(unit.km),
    hospital: hospital.place,
    hospitalKm: hospital.km
  };
}

export function formatTime(date) {
  return date.toLocaleTimeString('en-GB', { hour12: false });
}

export function alertMessage(incident, pole, plan) {
  const how = incident.confirmedBy === 'operator' ? 'confirmed by operator' : 'auto-dispatched';
  return [
    '[TEST] Smart Emergency Pole alert',
    `Type: ${incident.type}`,
    `Pole: ${pole.id}, ${pole.name}`,
    `Time: ${formatTime(incident.time)}`,
    `Detection score: ${incident.score.toFixed(2)} (${how})`,
    `Location: ${mapsLink(pole.lat, pole.lng)}`,
    `Assigned unit: ${plan.ambulance.id}, ${plan.ambulanceKm.toFixed(1)} km away, ETA about ${plan.etaMin} min`,
    `Nearest hospital: ${plan.hospital.name} (TEST), ${plan.hospitalKm.toFixed(1)} km from the pole`
  ].join('\n');
}
