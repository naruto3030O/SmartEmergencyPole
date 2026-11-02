"""Run YOLOv8n on a video clip, score each frame with the same rules as the
web demo (js/detect.js) and write the alerts to events.json.

    pip install ultralytics
    python tools/detect_video.py clip.mp4 --pole SEP-01 --out events.json

Offline only. The hosted page does not use this.
"""

import argparse
import json
import math
from collections import defaultdict, deque

WEIGHTS = {"overlap": 0.4, "suddenStop": 0.3, "orientation": 0.2, "personDown": 0.1}
AUTO_DISPATCH = 0.85
NEEDS_CONFIRM = 0.60
COOLDOWN_S = 30

FULL_OVERLAP = 0.5
HISTORY_S = 1.5
STOP_WINDOW_S = 0.6
# The web demo uses 120 px/s for a 64 px car. Measuring speed in vehicle
# lengths per second makes that independent of the camera's zoom.
HARD_STOP_DROP = 120 / 64
NEAR_VEHICLE_LENGTHS = 1.0

PERSON = 0
VEHICLES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


def area(b):
    return (b[2] - b[0]) * (b[3] - b[1])


def overlap_ratio(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    return w * h / min(area(a), area(b))


def box_gap(a, b):
    dx = max(0, a[0] - b[2], b[0] - a[2])
    dy = max(0, a[1] - b[3], b[1] - a[3])
    return math.hypot(dx, dy)


def shape_angle(b):
    # YOLO boxes have no heading. The box going from tall to wide (or back)
    # is the closest thing we get, so that stands in for orientation.
    return math.atan2(b[3] - b[1], b[2] - b[0])


def is_lying(b):
    return (b[2] - b[0]) > 1.3 * (b[3] - b[1])


class Tracker:
    def __init__(self):
        self.tracks = defaultdict(deque)
        self.overlaps = deque()

    def update(self, detections, t):
        """detections: list of (track_id, kind, box) with box = (x0, y0, x1, y1)."""
        seen = set()
        for track_id, _, box in detections:
            seen.add(track_id)
            samples = self.tracks[track_id]
            samples.append((t, box))
            while t - samples[0][0] > HISTORY_S:
                samples.popleft()
        for track_id in list(self.tracks):
            if track_id not in seen:
                del self.tracks[track_id]

        best = 0.0
        for i, (_, kind_a, box_a) in enumerate(detections):
            for _, kind_b, box_b in detections[i + 1:]:
                if kind_a == "person" and kind_b == "person":
                    continue
                best = max(best, overlap_ratio(box_a, box_b))
        self.overlaps.append((t, best))
        while t - self.overlaps[0][0] > HISTORY_S:
            self.overlaps.popleft()

        stop = 0.0
        turn = 0.0
        for track_id, kind, _ in detections:
            samples = self.tracks[track_id]
            if kind != "person":
                stop = max(stop, sudden_stop(samples))
            turn = max(turn, orientation_change(samples))

        return {
            "overlap": min(1.0, max(v for _, v in self.overlaps) / FULL_OVERLAP),
            "suddenStop": stop,
            "orientation": turn,
            "personDown": 1.0 if person_down_near_vehicle(detections) else 0.0,
        }


def centre(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def sudden_stop(samples):
    last_t = samples[-1][0]
    recent = [s for s in samples if last_t - s[0] <= STOP_WINDOW_S]
    speeds = []
    for (t0, b0), (t1, b1) in zip(recent, recent[1:]):
        if t1 > t0:
            (x0, y0), (x1, y1) = centre(b0), centre(b1)
            length = max(b1[2] - b1[0], b1[3] - b1[1])
            speeds.append(math.hypot(x1 - x0, y1 - y0) / (t1 - t0) / length)
    if len(speeds) < 2:
        return 0.0
    return min(1.0, max(0.0, (max(speeds) - speeds[-1]) / HARD_STOP_DROP))


def orientation_change(samples):
    now = shape_angle(samples[-1][1])
    turned = max(abs(now - shape_angle(b)) for _, b in samples)
    # A full tall-to-wide flip of a person box is about 1 rad, so count that as full.
    return min(1.0, turned / 1.0)


def person_down_near_vehicle(detections):
    vehicles = [b for _, kind, b in detections if kind != "person"]
    for _, kind, box in detections:
        if kind == "person" and is_lying(box):
            for v in vehicles:
                if box_gap(box, v) <= NEAR_VEHICLE_LENGTHS * max(v[2] - v[0], v[3] - v[1]):
                    return True
    return False


def crash_score(features):
    parts = {k: w * features[k] for k, w in WEIGHTS.items()}
    return round(sum(parts.values()), 2), parts


def decide(score):
    if score >= AUTO_DISPATCH:
        return "dispatch"
    if score >= NEEDS_CONFIRM:
        return "confirm"
    return "log"


def score_stream(frames, pole):
    """frames: iterable of (t, detections). Returns the list of events."""
    tracker = Tracker()
    events = []
    last_alert = None
    for frame_no, (t, detections) in enumerate(frames):
        features = tracker.update(detections, t)
        score, parts = crash_score(features)
        decision = decide(score)
        if decision == "log":
            continue
        if last_alert is not None and t - last_alert < COOLDOWN_S:
            # Keep the strongest frame of the burst that opened the alert.
            if events and t - last_alert < 2 and score > events[-1]["score"]:
                events[-1].update(frame=frame_no, time_s=round(t, 2), score=score,
                                  decision=decision, features=features, parts=parts)
            continue
        last_alert = t
        events.append({
            "pole": pole,
            "frame": frame_no,
            "time_s": round(t, 2),
            "score": score,
            "decision": decision,
            "features": features,
            "parts": parts,
        })
    return events


def yolo_frames(video, model_name, conf):
    import cv2
    from ultralytics import YOLO

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    cap.release()

    model = YOLO(model_name)
    classes = [PERSON, *VEHICLES]
    for i, result in enumerate(model.track(video, stream=True, persist=True, conf=conf,
                                           classes=classes, verbose=False)):
        detections = []
        boxes = result.boxes
        if boxes.id is not None:
            for track_id, cls, xyxy in zip(boxes.id.tolist(), boxes.cls.tolist(), boxes.xyxy.tolist()):
                kind = "person" if int(cls) == PERSON else VEHICLES[int(cls)]
                detections.append((int(track_id), kind, tuple(xyxy)))
        yield i / fps, detections


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video")
    parser.add_argument("--pole", default="SEP-01")
    parser.add_argument("--out", default="events.json")
    parser.add_argument("--model", default="yolov8n.pt")
    parser.add_argument("--conf", type=float, default=0.35)
    args = parser.parse_args()

    events = score_stream(yolo_frames(args.video, args.model, args.conf), args.pole)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"video": args.video, "events": events}, f, indent=2)
    print(f"{len(events)} event(s) written to {args.out}")
    for e in events:
        print(f"  {e['time_s']:7.2f}s  score {e['score']:.2f}  {e['decision']}")


if __name__ == "__main__":
    main()
