import math
from typing import List, Tuple, Optional

Point = Tuple[float, float]


def _clip_line_rect(r: float, cos_a: float, sin_a: float, hw: float, hh: float) -> Optional[Tuple[float, float]]:
    """Find t range where p(t) = r*(-sin_a, cos_a) + t*(cos_a, sin_a) is inside the rect."""
    EPS = 1e-10
    t_min = -1e18
    t_max = 1e18
    bx = r * (-sin_a)
    by = r * cos_a

    if abs(cos_a) > EPS:
        t1, t2 = (-hw - bx) / cos_a, (hw - bx) / cos_a
        t_min = max(t_min, min(t1, t2))
        t_max = min(t_max, max(t1, t2))
    elif not (-hw - EPS <= bx <= hw + EPS):
        return None

    if abs(sin_a) > EPS:
        t1, t2 = (-hh - by) / sin_a, (hh - by) / sin_a
        t_min = max(t_min, min(t1, t2))
        t_max = min(t_max, max(t1, t2))
    elif not (-hh - EPS <= by <= hh + EPS):
        return None

    return (t_min, t_max) if t_max > t_min + EPS else None


def _boustrophedon(rows: List[List[Point]], stitch_length: float) -> List[Point]:
    """Interleave scan rows in alternating directions with stitch spacing."""
    result: List[Point] = []
    for i, row in enumerate(rows):
        if not row:
            continue
        pts = row if i % 2 == 0 else list(reversed(row))
        # Re-sample at stitch_length intervals
        if len(pts) < 2:
            result.extend(pts)
            continue
        x0, y0 = pts[0]
        result.append((x0, y0))
        accumulated = 0.0
        for j in range(1, len(pts)):
            x1, y1 = pts[j]
            dx, dy = x1 - x0, y1 - y0
            seg_len = math.hypot(dx, dy)
            if seg_len == 0:
                continue
            t = 0.0
            while t + (stitch_length - accumulated) <= seg_len + 1e-9:
                t += stitch_length - accumulated
                result.append((x0 + dx * t / seg_len, y0 + dy * t / seg_len))
                accumulated = 0.0
            accumulated += seg_len - t
            x0, y0 = x1, y1
        result.append(pts[-1])
    return result


def fill_rect(hw: float, hh: float, stitch_angle_deg: float, density: float, stitch_length: float) -> List[Point]:
    """Fill a rect (half-dims hw, hh) with boustrophedon stitches in local coords."""
    angle = math.radians(stitch_angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    diag = math.hypot(hw, hh)

    rows: List[List[Point]] = []
    r = -diag
    while r <= diag:
        seg = _clip_line_rect(r, cos_a, sin_a, hw, hh)
        if seg:
            t0, t1 = seg
            bx, by = r * (-sin_a), r * cos_a
            rows.append([
                (bx + t0 * cos_a, by + t0 * sin_a),
                (bx + t1 * cos_a, by + t1 * sin_a),
            ])
        r += density

    return _boustrophedon(rows, stitch_length)


def fill_circle(radius: float, stitch_angle_deg: float, density: float, stitch_length: float) -> List[Point]:
    """Fill a circle with boustrophedon stitches in local coords."""
    angle = math.radians(stitch_angle_deg)
    cos_a, sin_a = math.cos(angle), math.sin(angle)

    rows: List[List[Point]] = []
    r = -radius
    while r <= radius:
        bx, by = r * (-sin_a), r * cos_a
        b = bx * cos_a + by * sin_a
        c = bx * bx + by * by - radius * radius
        disc = b * b - c
        if disc >= 0:
            sd = math.sqrt(disc)
            t0, t1 = -b - sd, -b + sd
            rows.append([
                (bx + t0 * cos_a, by + t0 * sin_a),
                (bx + t1 * cos_a, by + t1 * sin_a),
            ])
        r += density

    return _boustrophedon(rows, stitch_length)


def running_rect(hw: float, hh: float, stitch_length: float) -> List[Point]:
    corners = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh), (-hw, -hh)]
    pts: List[Point] = []
    for i in range(len(corners) - 1):
        x0, y0 = corners[i]
        x1, y1 = corners[i + 1]
        dx, dy = x1 - x0, y1 - y0
        length = math.hypot(dx, dy)
        n = max(2, math.ceil(length / stitch_length))
        for j in range(n):
            pts.append((x0 + dx * j / n, y0 + dy * j / n))
    pts.append(corners[-1])
    return pts


def running_circle(radius: float, stitch_length: float) -> List[Point]:
    n = max(8, math.ceil(2 * math.pi * radius / stitch_length))
    return [(radius * math.cos(2 * math.pi * i / n), radius * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]


def transform_to_canvas(pts: List[Point], cx: float, cy: float, angle_deg: float) -> List[Point]:
    """Rotate local points and translate to canvas center."""
    a = math.radians(angle_deg)
    cos_a, sin_a = math.cos(a), math.sin(a)
    return [
        (cx + x * cos_a - y * sin_a, cy + x * sin_a + y * cos_a)
        for x, y in pts
    ]
