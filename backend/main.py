from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from typing import List, Optional
import pyembroidery
import tempfile, os

from stitch_gen import (
    fill_rect, fill_circle,
    running_rect, running_circle,
    transform_to_canvas,
)

app = FastAPI(title="ThreadLogic Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class StitchProps(BaseModel):
    stitchType: str   # 'running' | 'satin' | 'fill'
    angle: float
    density: float    # canvas pixel spacing
    color: str        # hex e.g. '#3b5bdb'


class Shape(BaseModel):
    type: str          # 'rect' | 'circle' | 'triangle' | 'path'
    centerX: float
    centerY: float
    width: float
    height: float
    radius: Optional[float] = None
    angle: float       # object rotation in degrees
    pathData: Optional[str] = None
    stitchProps: StitchProps


class ExportRequest(BaseModel):
    shapes: List[Shape]
    hoopCenterX: float
    hoopCenterY: float
    hoopSize: float        # pixels (square hoop)
    hoopPhysicalMM: float  # default 150


def hex_to_color_int(hex_str: str) -> int:
    h = hex_str.lstrip('#')
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (r << 16) | (g << 8) | b


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/export/dst")
async def export_dst(req: ExportRequest):
    # 1 canvas pixel → N DST units (1 DST unit = 0.1 mm)
    px_to_dst = (req.hoopPhysicalMM * 10.0) / req.hoopSize
    # Max stitch length: 12 mm = 120 DST units → in canvas pixels
    max_stitch_px = 12.0 / (req.hoopPhysicalMM / req.hoopSize)

    pattern = pyembroidery.EmbPattern()
    any_shape = False

    for shape in req.shapes:
        sp = shape.stitchProps

        # Generate stitches in local object coords (canvas pixels, centered at 0,0)
        local_pts = []

        if shape.type in ('rect', 'triangle'):
            hw, hh = shape.width / 2, shape.height / 2
            if sp.stitchType == 'running':
                local_pts = running_rect(hw, hh, max_stitch_px)
            else:
                local_pts = fill_rect(hw, hh, sp.angle, sp.density, max_stitch_px)

        elif shape.type == 'circle':
            r = shape.radius or max(shape.width, shape.height) / 2
            if sp.stitchType == 'running':
                local_pts = running_circle(r, max_stitch_px)
            else:
                local_pts = fill_circle(r, sp.angle, sp.density, max_stitch_px)

        else:
            # path / star / text: skip for now
            continue

        if not local_pts:
            continue

        # Transform local → canvas coords
        canvas_pts = transform_to_canvas(local_pts, shape.centerX, shape.centerY, shape.angle)

        # Add thread colour
        pattern.add_thread({"color": hex_to_color_int(sp.color), "name": sp.color})

        first = True
        for cx, cy in canvas_pts:
            # Canvas → relative to hoop centre → DST units
            dst_x = (cx - req.hoopCenterX) * px_to_dst
            dst_y = (cy - req.hoopCenterY) * px_to_dst
            cmd = pyembroidery.JUMP if first else pyembroidery.STITCH
            pattern.add_stitch_absolute(cmd, dst_x, dst_y)
            first = False

        pattern.add_command(pyembroidery.COLOR_BREAK)
        any_shape = True

    if not any_shape:
        return Response(status_code=422, content=b"No exportable shapes (paths/text not yet supported)")

    pattern.end()

    # Write to temp .dst file and read back
    with tempfile.NamedTemporaryFile(suffix=".dst", delete=False) as f:
        tmp = f.name
    try:
        pyembroidery.write(pattern, tmp)
        with open(tmp, "rb") as f:
            dst_bytes = f.read()
    finally:
        os.unlink(tmp)

    return Response(
        content=dst_bytes,
        media_type="application/octet-stream",
        headers={"Content-Disposition": 'attachment; filename="design.dst"'},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
