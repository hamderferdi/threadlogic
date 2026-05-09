"""
main.py — ThreadLogic FastAPI backend

POST /export/dst  →  JSON { dst_b64, warnings, stats }
GET  /health      →  { status }
"""

import base64
import tempfile
import os
from typing import List, Optional

import pyembroidery
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from stitch_gen import (
    fill_rect, fill_circle, fill_triangle, fill_polygon,
    satin_rect, satin_circle, satin_triangle, satin_polygon,
    running_rect, running_circle, running_triangle, running_polygon,
    parse_svg_path, transform_to_canvas, filter_min_stitches,
    tsp_order, validate_shape,
    MIN_STITCH_MM,
)

app = FastAPI(title="ThreadLogic Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic models ────────────────────────────────────────────────────────

class StitchProps(BaseModel):
    stitchType: str
    angle: float
    density: float
    color: str


class Shape(BaseModel):
    type: str
    centerX: float
    centerY: float
    width: float
    height: float
    radius: Optional[float] = None
    angle: float
    pathData: Optional[str] = None
    stitchProps: StitchProps


class ExportRequest(BaseModel):
    shapes: List[Shape]
    hoopCenterX: float
    hoopCenterY: float
    hoopSize: float
    hoopPhysicalMM: float


# ── Helpers ────────────────────────────────────────────────────────────────

def hex_to_color_int(hex_str: str) -> int:
    h = hex_str.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r << 16) | (g << 8) | b


def _generate_pts(shape: Shape, sp: StitchProps, max_stitch_px: float, density_px: float):
    """
    Returns (pts, is_canvas_space).
    For rect/circle/triangle: pts in local object space centred at 0,0.
    For path: pts already in canvas space.
    """
    t = shape.type
    st = sp.stitchType
    hw, hh = shape.width / 2, shape.height / 2

    if t == 'rect':
        if st == 'running':  return running_rect(hw, hh, max_stitch_px), False
        if st == 'satin':    return satin_rect(hw, hh, sp.angle, density_px), False
        return fill_rect(hw, hh, sp.angle, density_px, max_stitch_px), False

    if t == 'triangle':
        if st == 'running':  return running_triangle(hw, hh, max_stitch_px), False
        if st == 'satin':    return satin_triangle(hw, hh, sp.angle, density_px), False
        return fill_triangle(hw, hh, sp.angle, density_px, max_stitch_px), False

    if t == 'circle':
        r = shape.radius or max(shape.width, shape.height) / 2
        if st == 'running':  return running_circle(r, max_stitch_px), False
        if st == 'satin':    return satin_circle(r, sp.angle, density_px), False
        return fill_circle(r, sp.angle, density_px, max_stitch_px), False

    if t == 'path' and shape.pathData:
        polygon = parse_svg_path(shape.pathData)
        if len(polygon) < 3:
            return [], True
        if st == 'running':  return running_polygon(polygon, max_stitch_px), True
        if st == 'satin':    return satin_polygon(polygon, sp.angle, density_px), True
        return fill_polygon(polygon, sp.angle, density_px, max_stitch_px), True

    return [], False


# ── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/export/dst")
async def export_dst(req: ExportRequest):
    px_per_mm     = req.hoopSize / req.hoopPhysicalMM
    px_to_dst     = req.hoopPhysicalMM * 10.0 / req.hoopSize
    max_stitch_px = 12.0 * px_per_mm
    min_stitch_px = MIN_STITCH_MM * px_per_mm

    all_warnings: List[str] = []
    shape_data: List[dict] = []

    # ── 1. Generate stitches per shape ───────────────────────────────────
    for idx, shape in enumerate(req.shapes):
        sp = shape.stitchProps
        label = f"Shape {idx + 1} ({shape.type})"
        density_px = max(2.0, sp.density)

        w_mm = shape.width / px_per_mm
        h_mm = shape.height / px_per_mm
        r_mm = (shape.radius / px_per_mm) if shape.radius else None
        for w in validate_shape(shape.type, w_mm, h_mm, r_mm):
            all_warnings.append(f"{label}: {w}")

        pts, is_canvas = _generate_pts(shape, sp, max_stitch_px, density_px)
        if not pts:
            all_warnings.append(f"{label}: no stitches generated (skipped).")
            continue

        if not is_canvas:
            pts = transform_to_canvas(pts, shape.centerX, shape.centerY, shape.angle)

        pts = filter_min_stitches(pts, min_stitch_px)
        if len(pts) < 2:
            all_warnings.append(f"{label}: fewer than 2 stitches after filtering (skipped).")
            continue

        shape_data.append({
            "pts":   pts,
            "color": sp.color,
            "start": pts[0],
            "end":   pts[-1],
        })

    if not shape_data:
        return JSONResponse(
            status_code=422,
            content={"error": "No exportable shapes.", "warnings": all_warnings},
        )

    # ── 2. TSP ordering ──────────────────────────────────────────────────
    order = tsp_order([(sd["start"], sd["end"]) for sd in shape_data])

    pattern = pyembroidery.EmbPattern()
    total_jump_mm = 0.0
    jump_count = 0
    prev_end: Optional[tuple] = None

    for shape_idx, reversed_pts in order:
        sd = shape_data[shape_idx]
        pts = list(reversed(sd["pts"])) if reversed_pts else sd["pts"]

        if prev_end is not None:
            jump_px = ((pts[0][0] - prev_end[0])**2 + (pts[0][1] - prev_end[1])**2) ** 0.5
            total_jump_mm += jump_px / px_per_mm
            jump_count += 1

        pattern.add_thread({"color": hex_to_color_int(sd["color"]), "name": sd["color"]})

        first = True
        for cx_px, cy_px in pts:
            dst_x = (cx_px - req.hoopCenterX) * px_to_dst
            dst_y = (cy_px - req.hoopCenterY) * px_to_dst
            cmd = pyembroidery.JUMP if first else pyembroidery.STITCH
            pattern.add_stitch_absolute(cmd, dst_x, dst_y)
            first = False

        pattern.add_command(pyembroidery.COLOR_BREAK)
        prev_end = pts[-1]

    pattern.end()

    # ── 3. Write DST ─────────────────────────────────────────────────────
    with tempfile.NamedTemporaryFile(suffix=".dst", delete=False) as f:
        tmp = f.name
    try:
        pyembroidery.write(pattern, tmp)
        with open(tmp, "rb") as f:
            dst_bytes = f.read()
    finally:
        os.unlink(tmp)

    # ── 4. Return JSON ───────────────────────────────────────────────────
    total_stitches = sum(len(sd["pts"]) for sd in shape_data)

    return JSONResponse(content={
        "dst_b64":  base64.b64encode(dst_bytes).decode(),
        "warnings": all_warnings,
        "stats": {
            "stitches":    total_stitches,
            "jumps":       jump_count,
            "jump_mm":     round(total_jump_mm, 1),
            "est_minutes": round(total_stitches / 500, 1),
            "shapes":      len(shape_data),
        },
    })


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
