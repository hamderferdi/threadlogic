"""
stitch_gen.py — ThreadLogic stitch generation engine

Produces canvas-space stitch point lists for:
  fill (tatami boustrophedon), satin, running stitch
  on rect, circle, triangle, and arbitrary polygons/paths.

Also provides:
  filter_min_stitches  — remove stitches too close together
  tsp_order            — nearest-neighbour + 2-opt shape ordering
"""

import math
import re
from typing import List, Tuple, Optional

Point = Tuple[float, float]

MIN_STITCH_MM = 0.4   # machine minimum — anything shorter risks needle jamming


# ── Helpers ────────────────────────────────────────────────────────────────

def filter_min_stitches(pts: List[Point], min_dist: float) -> List[Point]:
    """Drop any stitch that is closer than min_dist to the previous one."""
    if not pts:
        return pts
    result = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - result[-1][0], p[1] - result[-1][1]) >= min_dist:
            result.append(p)
    return result


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def transform_to_canvas(pts: List[Point], cx: float, cy: float, angle_deg: float) -> List[Point]:
    """Rotate local-space points and translate to canvas position."""
    a = math.radians(angle_deg)
    ca, sa = math.cos(a), math.sin(a)
    return [(cx + x * ca - y * sa, cy + x * sa + y * ca) for x, y in pts]


# ── SVG path parsing ───────────────────────────────────────────────────────

def parse_svg_path(d: str) -> List[Point]:
    """
    Parse an SVG path d-string into a flat list of canvas-space polygon points.
    Supports M, L, C (cubic bezier), Q (quadratic bezier), Z commands.
    Bezier curves are discretised into line segments.
    """
    tokens = re.findall(
        r'[MmLlCcQqZz]|[-+]?(?:\d*\.)?\d+(?:[eE][-+]?\d+)?', d
    )
    pts: List[Point] = []
    i = 0
    cx, cy = 0.0, 0.0
    start_x, start_y = 0.0, 0.0

    def take(n: int) -> List[float]:
        nonlocal i
        out: List[float] = []
        for _ in range(n):
            if i < len(tokens):
                try:
                    out.append(float(tokens[i])); i += 1
                except ValueError:
                    break
        return out

    while i < len(tokens):
        cmd = tokens[i]; i += 1
        if cmd in ('M', 'm'):
            xy = take(2)
            if len(xy) == 2:
                if cmd == 'm':
                    cx += xy[0]; cy += xy[1]
                else:
                    cx, cy = xy[0], xy[1]
                start_x, start_y = cx, cy
                pts.append((cx, cy))
        elif cmd in ('L', 'l'):
            xy = take(2)
            if len(xy) == 2:
                if cmd == 'l':
                    cx += xy[0]; cy += xy[1]
                else:
                    cx, cy = xy[0], xy[1]
                pts.append((cx, cy))
        elif cmd in ('C', 'c'):
            coords = take(6)
            if len(coords) == 6:
                if cmd == 'c':
                    x1, y1 = cx + coords[0], cy + coords[1]
                    x2, y2 = cx + coords[2], cy + coords[3]
                    ex, ey = cx + coords[4], cy + coords[5]
                else:
                    x1, y1 = coords[0], coords[1]
                    x2, y2 = coords[2], coords[3]
                    ex, ey = coords[4], coords[5]
                for step in range(1, 17):
                    t = step / 16.0; mt = 1 - t
                    pts.append((
                        mt**3 * cx + 3*mt**2*t*x1 + 3*mt*t**2*x2 + t**3*ex,
                        mt**3 * cy + 3*mt**2*t*y1 + 3*mt*t**2*y2 + t**3*ey,
                    ))
                cx, cy = ex, ey
        elif cmd in ('Q', 'q'):
            coords = take(4)
            if len(coords) == 4:
                if cmd == 'q':
                    x1, y1 = cx + coords[0], cy + coords[1]
                    ex, ey = cx + coords[2], cy + coords[3]
                else:
                    x1, y1 = coords[0], coords[1]
                    ex, ey = coords[2], coords[3]
                for step in range(1, 9):
                    t = step / 8.0; mt = 1 - t
                    pts.append((
                        mt**2 * cx + 2*mt*t*x1 + t**2*ex,
                        mt**2 * cy + 2*mt*t*y1 + t**2*ey,
                    ))
                cx, cy = ex, ey
        elif cmd in ('Z', 'z'):
            if pts:
                pts.append((start_x, start_y))
            cx, cy = start_x, start_y

    return pts


# ── Scanline polygon fill (generic) ───────────────────────────────────────

def _boustrophedon(rows: List[List[Point]], stitch_length: float) -> List[Point]:
    """Snake through scan rows, re-sampling each at stitch_length intervals."""
    result: List[Point] = []
    for i, row in enumerate(rows):
        if not row:
            continue
        pts = row if i % 2 == 0 else list(reversed(row))
        x0, y0 = pts[0]
        result.append((x0, y0))
        acc = 0.0
        for j in range(1, len(pts)):
            x1, y1 = pts[j]
            seg = math.hypot(x1 - x0, y1 - y0)
            if seg == 0:
                continue
            t = 0.0
            while t + (stitch_length - acc) <= seg + 1e-9:
                t += stitch_length - acc
                result.append((x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg))
                acc = 0.0
            acc += seg - t
            x0, y0 = x1, y1
        result.append(pts[-1])
    return result


def _boustrophedon_satin(rows: List[List[Point]]) -> List[Point]:
    """Snake through scan rows without re-sampling — each row is one long stitch."""
    result: List[Point] = []
    for i, row in enumerate(rows):
        if not row:
            continue
        pts = row if i % 2 == 0 else list(reversed(row))
        result.extend(pts)
    return result


def _scanline_rows(polygon: List[Point], angle_deg: float, density: float) -> List[List[Point]]:
    """
    Rotate polygon into angle-aligned space, scanline-intersect, rotate back.
    Returns list of row-pairs in original canvas space.
    """
    if len(polygon) < 3:
        return []

    a = math.radians(angle_deg)
    ca, sa = math.cos(-a), math.sin(-a)   # rotate into stitch-angle frame
    rot = [(x * ca - y * sa, x * sa + y * ca) for x, y in polygon]

    ys = [p[1] for p in rot]
    y_min, y_max = min(ys), max(ys)
    n = len(rot)
    rows: List[List[Point]] = []

    r = y_min + density / 2
    while r <= y_max:
        crossings: List[float] = []
        for k in range(n):
            ax, ay = rot[k]
            bx, by = rot[(k + 1) % n]
            if (ay <= r < by) or (by <= r < ay):
                t = (r - ay) / (by - ay)
                crossings.append(ax + t * (bx - ax))
        crossings.sort()
        # rotate intersection points back to canvas space
        cb, sb = math.cos(a), math.sin(a)
        for j in range(0, len(crossings) - 1, 2):
            xi0, xi1 = crossings[j], crossings[j + 1]
            p0 = (xi0 * cb - r * sb, xi0 * sb + r * cb)
            p1 = (xi1 * cb - r * sb, xi1 * sb + r * cb)
            rows.append([p0, p1])
        r += density

    return rows


def fill_polygon(polygon: List[Point], angle_deg: float, density: float, stitch_length: float) -> List[Point]:
    return _boustrophedon(_scanline_rows(polygon, angle_deg, density), stitch_length)


def satin_polygon(polygon: List[Point], angle_deg: float, density: float) -> List[Point]:
    return _boustrophedon_satin(_scanline_rows(polygon, angle_deg, density))


def running_polygon(polygon: List[Point], stitch_length: float) -> List[Point]:
    """Outline stitch around an arbitrary closed polygon."""
    if len(polygon) < 2:
        return polygon
    pts: List[Point] = []
    closed = list(polygon)
    if closed[0] != closed[-1]:
        closed.append(closed[0])
    x0, y0 = closed[0]
    pts.append((x0, y0))
    for k in range(1, len(closed)):
        x1, y1 = closed[k]
        seg = math.hypot(x1 - x0, y1 - y0)
        if seg == 0:
            continue
        n = max(2, math.ceil(seg / stitch_length))
        for j in range(1, n + 1):
            pts.append((x0 + (x1 - x0) * j / n, y0 + (y1 - y0) * j / n))
        x0, y0 = x1, y1
    return pts


# ── Rect ──────────────────────────────────────────────────────────────────

def _rect_polygon(hw: float, hh: float) -> List[Point]:
    return [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]


def fill_rect(hw: float, hh: float, angle_deg: float, density: float, stitch_length: float) -> List[Point]:
    return fill_polygon(_rect_polygon(hw, hh), angle_deg, density, stitch_length)


def satin_rect(hw: float, hh: float, angle_deg: float, density: float) -> List[Point]:
    return satin_polygon(_rect_polygon(hw, hh), angle_deg, density)


def running_rect(hw: float, hh: float, stitch_length: float) -> List[Point]:
    return running_polygon(_rect_polygon(hw, hh), stitch_length)


# ── Triangle ──────────────────────────────────────────────────────────────

def _triangle_polygon(hw: float, hh: float) -> List[Point]:
    return [(0, -hh), (hw, hh), (-hw, hh)]


def fill_triangle(hw: float, hh: float, angle_deg: float, density: float, stitch_length: float) -> List[Point]:
    return fill_polygon(_triangle_polygon(hw, hh), angle_deg, density, stitch_length)


def satin_triangle(hw: float, hh: float, angle_deg: float, density: float) -> List[Point]:
    return satin_polygon(_triangle_polygon(hw, hh), angle_deg, density)


def running_triangle(hw: float, hh: float, stitch_length: float) -> List[Point]:
    return running_polygon(_triangle_polygon(hw, hh), stitch_length)


# ── Circle ────────────────────────────────────────────────────────────────

def _circle_polygon(radius: float, n_pts: int = 64) -> List[Point]:
    return [(radius * math.cos(2 * math.pi * i / n_pts),
             radius * math.sin(2 * math.pi * i / n_pts)) for i in range(n_pts)]


def fill_circle(radius: float, angle_deg: float, density: float, stitch_length: float) -> List[Point]:
    return fill_polygon(_circle_polygon(radius), angle_deg, density, stitch_length)


def satin_circle(radius: float, angle_deg: float, density: float) -> List[Point]:
    return satin_polygon(_circle_polygon(radius), angle_deg, density)


def running_circle(radius: float, stitch_length: float) -> List[Point]:
    n = max(8, math.ceil(2 * math.pi * radius / stitch_length))
    return [(radius * math.cos(2 * math.pi * i / n),
             radius * math.sin(2 * math.pi * i / n)) for i in range(n + 1)]


# ── TSP ordering ──────────────────────────────────────────────────────────

def tsp_order(endpoints: List[Tuple[Point, Point]]) -> List[Tuple[int, bool]]:
    """
    Given a list of (start, end) point pairs for each shape, return an
    ordered list of (index, reversed) so that the total jump distance
    between consecutive shapes is minimised.

    Uses greedy nearest-neighbour then a 2-opt pass.
    """
    n = len(endpoints)
    if n == 0:
        return []
    if n == 1:
        return [(0, False)]

    visited = [False] * n
    order: List[Tuple[int, bool]] = []

    # Start at shape 0 forward
    current_end: Point = endpoints[0][1]
    visited[0] = True
    order.append((0, False))

    for _ in range(n - 1):
        best_dist = float('inf')
        best_idx = -1
        best_rev = False

        for j in range(n):
            if visited[j]:
                continue
            s, e = endpoints[j]
            d_fwd = _dist(current_end, s)
            d_rev = _dist(current_end, e)
            if d_fwd <= d_rev and d_fwd < best_dist:
                best_dist = d_fwd; best_idx = j; best_rev = False
            elif d_rev < d_fwd and d_rev < best_dist:
                best_dist = d_rev; best_idx = j; best_rev = True

        if best_idx == -1:
            break
        visited[best_idx] = True
        order.append((best_idx, best_rev))
        s, e = endpoints[best_idx]
        current_end = e if not best_rev else s

    # 2-opt improvement
    improved = True
    while improved:
        improved = False
        for i in range(len(order) - 1):
            for j in range(i + 1, len(order)):
                # Cost before: end of [i-1] → start of [i], end of [j] → start of [j+1]
                # Cost after:  end of [i-1] → start of [j], end of [i] → start of [j+1]
                end_prev = endpoints[order[i - 1][0]][1 if not order[i - 1][1] else 0] if i > 0 else (0.0, 0.0)
                si, ei = endpoints[order[i][0]]
                if order[i][1]: si, ei = ei, si
                sj, ej = endpoints[order[j][0]]
                if order[j][1]: sj, ej = ej, sj
                start_next = endpoints[order[j + 1][0]][0 if not order[j + 1][1] else 1] if j + 1 < len(order) else (0.0, 0.0)

                cost_before = _dist(end_prev, si) + _dist(ej, start_next)
                cost_after  = _dist(end_prev, sj) + _dist(ei, start_next)

                if cost_after < cost_before - 1e-9:
                    # Reverse the slice [i..j] and flip reversed flags
                    segment = order[i:j + 1]
                    segment.reverse()
                    segment = [(idx, not rev) for idx, rev in segment]
                    order[i:j + 1] = segment
                    improved = True

    return order


# ── Validation ────────────────────────────────────────────────────────────

def validate_shape(shape_type: str, width_mm: float, height_mm: float,
                   radius_mm: Optional[float] = None) -> List[str]:
    """Return list of warning strings for a shape, empty if all ok."""
    warnings: List[str] = []
    min_dim = radius_mm * 2 if radius_mm is not None else min(width_mm, height_mm)
    if min_dim < 2.0:
        warnings.append(
            f"{shape_type.capitalize()} is very small ({min_dim:.1f} mm) — "
            "stitches may be too short for most machines."
        )
    if min_dim < 1.0:
        warnings.append(
            f"{shape_type.capitalize()} ({min_dim:.1f} mm) is below the recommended "
            "minimum stitch area — consider removing it."
        )
    return warnings
