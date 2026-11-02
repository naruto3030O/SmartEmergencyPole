# Smart Emergency Pole

Team **DoomScrollers**, Tech Eximius 2.0.

A roadside pole that watches the existing CCTV feed for road accidents and people
collapsing, then alerts the nearest ambulance and hospital with a GPS pin. The
pole also has a First Aid button that talks bystanders through basic first aid
until help arrives.

This repository is the **simulated web demo** we are submitting for the online
round. The real pole hardware will be shown at the offline round.

## The problem

After a road crash, the first few minutes matter most, and they are often lost
because nobody calls, or the caller can't say exactly where they are. Many
roads already have CCTV, but nobody watches every feed live. People who stop
to help usually don't know what to do until the ambulance gets there.

## What the demo does

Open the page and you get a control-room view of four test poles along NH-48
(Delhi - Gurugram):

- **Map** (Leaflet + OpenStreetMap) with the poles, three test ambulances and
  two test hospitals.
- **Pole camera**: a simple top-down road drawn on a canvas, with moving
  vehicles and detection boxes. Two buttons play short clips:
  - *Simulate crash*: a car drifts into the oncoming lane and hits another car.
  - *Simulate person down*: a car brakes late, nudges a pedestrian and they fall.
- **Scoring**: every frame, the tracked positions, speeds and angles of the
  objects in the clip are turned into four signals, and the score is

  `0.4 * overlap + 0.3 * sudden_stop + 0.2 * orientation_change + 0.1 * person_down_near_vehicle`

  The breakdown is shown under the camera. None of these values is typed in by
  hand: they come from the animation. Right now the crash clip peaks around
  0.90 and the person-down clip around 0.75.
- **Rules**: 0.85 or more dispatches automatically. 0.60 to 0.85 shows an
  operator panel with Confirm and Dismiss. Each pole raises at most one alert
  every 30 seconds, and a second event inside that window is logged as blocked.
- **Dispatch**: the nearest ambulance and hospital by haversine distance, with
  a rough ETA. The route on the map is a straight line, and the page says so.
- **Alert preview**: the exact text the ambulance crew would get on Telegram,
  including a Google Maps link to the pole. Nothing is actually sent.
- **First Aid station** (its own green section, also linked from the top bar):
  - *Voice-guided First Aid button*: speaks a short English script with the
    browser's `speechSynthesis` and shows each step as a caption. If the
    browser has no voice (or you tick *Captions only*), it shows captions on
    their own.
  - *Using the first aid box*: a simple SVG animation of a bystander opening
    the green box on the pole, taking out a dressing and pressing it on an
    injured person's wound, with a caption for each step.
  - *Restock*: opening the box (the first step of the animation) stands in for
    the door switch. The pole logs "First aid box opened" in the incident feed
    and sends a restock request with its GPS pin to the nearest test hospital.
    Each pole sends one request per opening until someone presses *Mark
    restocked*.
- **Incident feed** and a **pole status strip** that copies what the pole's two
  LEDs will do: green on while watching, red blinking while waiting for an
  operator, red on once help is dispatched (held through the cooldown).

## What is simulated and what is real

| Part | In this demo |
| --- | --- |
| Camera feed | Simulated. A canvas animation, not video. |
| Object detection | Simulated. Boxes come from the animation, and the confidence numbers are made up. |
| Scoring and the 0.85 / 0.60 / 30 s rules | Real code (`js/detect.js`), running on the simulated tracks. |
| Nearest ambulance and hospital | Real haversine lookup (`js/dispatch.js`) over test data. |
| Ambulances and hospitals | Invented TEST entries. Not real services. |
| Pole locations | Approximate points on NH-48, picked by us. No poles exist there. |
| Telegram alert | Text preview only. No message is sent and no API is called. |
| Route and ETA | Straight line. The ETA assumes the road is about 1.4x the straight line, driven at 30 km/h. |
| First Aid audio | Real browser speech synthesis. The voice depends on your browser and OS. |
| First aid box, door switch, restock request | Planned. The animation and the request message are simulated, and nothing is sent. The nearest-hospital pick is the same haversine lookup. |

## Running it

The page uses ES modules, and browsers don't load those from a file opened
straight from disk. So run any small local server from the project folder:

```
python -m http.server 8000
```

Then open http://localhost:8000. (`npx serve` works too.) If you double-click
`index.html` anyway, the page shows a red banner explaining this.

There is no build step, no backend, no API key and no login. Leaflet loads from
unpkg with a pinned version (1.9.4) and an integrity hash, and map tiles come
from OpenStreetMap. Without internet the map stays blank, but detection,
dispatch and First Aid still work.

### Quick checks

```
node tests/check.mjs
```

This checks the haversine maths (1 degree of latitude, Delhi to Mumbai), the
nearest-unit pick against a brute-force check, the score weights, the
thresholds and the cooldown. It also replays both clips at 24 and 60 fps and
checks that the crash lands in the auto-dispatch band, the person-down clip
lands in the confirm band, and a minute of normal traffic raises nothing. Node
18 or newer.

## Offline part: running the rules on real video

`tools/detect_video.py` is the offline half. It is **not part of the hosted
page** and GitHub Pages never runs it. It runs a pretrained YOLOv8n
(Ultralytics) with tracking on a video clip, applies the same score, thresholds
and 30 s cooldown as `js/detect.js`, and writes `events.json`:

```
pip install ultralytics
python tools/detect_video.py path/to/clip.mp4 --pole SEP-01 --out events.json
```

Two differences from the browser version, because a detector gives less than
our animation does. YOLO boxes have no heading, so *orientation change* uses
the box going from tall to wide as a stand-in. Speeds are measured in vehicle
lengths per second, so the sudden-stop threshold doesn't depend on camera zoom.
We have only tested the scoring part on synthetic tracks, not on real crash
footage, so treat any numbers it prints as untested.

## Files

```
index.html
css/style.css
js/app.js        UI wiring
js/detect.js     scoring rules, tracker, cooldown
js/dispatch.js   haversine, nearest unit, ETA, alert text
js/data.js       poles, test ambulances, test hospitals
js/camera.js     the simulated camera clips and drawing
js/firstaid.js   first-aid script and speech
js/aidbox.js     first aid box animation steps
tests/check.mjs  quick logic checks
tools/           offline YOLOv8n script (not used by the page)
docs/            diagrams
```

## Hardware plan

The pole would take the feed from an existing CCTV camera into a small edge
computer (a Raspberry Pi class board) running a
YOLO-style detector and the same scoring rules as this page. It sends alerts
over a 4G module, has a GPS module for its own position, a green and a red LED
on top, a large First Aid push button with a speaker, and an unlocked first
aid box with a door switch, so that opening it triggers a restock request. Power would come from
the street-light supply with a battery backup. This is our plan for the offline
round. It is not built or tested at the scale described here.

## Known limits

- Everything in the browser is simulated. We are not claiming any detection
  accuracy, and we haven't measured any.
- The score formula is centred on vehicles. A person collapsing on the
  pavement with no vehicle nearby scores low with these weights, so the real
  pole needs a separate person-down rule.
- The `sudden_stop` threshold is in pixels per second, tuned to this drawing's
  scale. A real camera needs calibrating so pixels map to metres.
- Overlap counts as full at half of the smaller box, because from a fixed
  camera even a bad crash rarely covers more than that. This is a judgement
  call and still needs checking on real footage.
- Straight-line distance can pick the wrong ambulance when roads, flyovers or
  one-way streets get in the way. A real system needs a road router and live
  ambulance positions.
- The Hindi First Aid script is a placeholder. We didn't want to publish
  medical instructions in Hindi until a native speaker with first-aid training
  has written and checked them.
- The box contents listed on the page are our plan, not a checked kit list.
  We would confirm them with a doctor or a first-aid trainer before building.
- The First Aid script is short and generic. It is not a substitute for
  trained help or the 112 call-taker's instructions.

## Team DoomScrollers

- Member name [Sanjay Kumar] - role [Software work]
- Member name [Subhash Kumar] - role [Hardware work]

