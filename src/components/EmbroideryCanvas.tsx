import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react'
import * as fabric from 'fabric'
import type {
  Tool,
  StitchProperties,
  ExportData,
  SerializedShape,
  CanvasObjectInfo,
} from '../types/embroidery'

interface Props {
  activeTool: Tool
  stitchProps: StitchProperties
  onSelectionChange: (hasSelection: boolean, props: StitchProperties | null) => void
  onObjectsChange?: (objects: CanvasObjectInfo[]) => void
  onZoomChange?: (zoom: number) => void
}

export interface EmbroideryCanvasHandle {
  updateSelectedObjectStitch: (props: StitchProperties) => void
  deleteSelected: () => void
  selectObjectById: (id: string) => void
  toggleObjectVisibility: (id: string) => void
  getExportData: () => ExportData | null
  resetView: () => void
}

// ─── Helpers ───────────────────────────────────────────────────────────────

let _counter: Record<string, number> = {}
function nextName(type: string) {
  const label =
    type === 'circle' ? 'Ellipse'
    : type === 'triangle' ? 'Triangle'
    : type === 'path' ? 'Path'
    : type === 'i-text' ? 'Text'
    : type.charAt(0).toUpperCase() + type.slice(1)
  _counter[label] = (_counter[label] ?? 0) + 1
  return `${label} ${_counter[label]}`
}

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function starPath(cx: number, cy: number, outerR: number, innerR: number, pts = 5): string {
  const parts: string[] = []
  for (let i = 0; i < pts * 2; i++) {
    const a = (Math.PI * i) / pts - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    parts.push(`${i === 0 ? 'M' : 'L'} ${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return parts.join(' ') + ' Z'
}

function getObjectsList(fc: fabric.Canvas): CanvasObjectInfo[] {
  const activeIds = new Set(fc.getActiveObjects().map(o => (o as any)._tl_id as string))
  return fc
    .getObjects()
    .filter(o => !(o as any).data?.isHoop && !(o as any).data?.isPolyLine)
    .map(o => ({
      id: (o as any)._tl_id ?? '',
      name: (o as any)._tl_name ?? o.type ?? 'Object',
      type: o.type ?? 'object',
      visible: o.visible ?? true,
      selected: activeIds.has((o as any)._tl_id),
      color: ((o as any).stitchProps?.color as string | undefined) ?? '#888',
    }))
    .reverse()
}

// ─── Stitch preview ────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function buildPath2D(cmds: any[], ox: number, oy: number): Path2D {
  const p = new Path2D()
  for (const c of cmds) {
    switch ((c[0] as string).toUpperCase()) {
      case 'M': p.moveTo(c[1] - ox, c[2] - oy); break
      case 'L': p.lineTo(c[1] - ox, c[2] - oy); break
      case 'C': p.bezierCurveTo(c[1]-ox,c[2]-oy,c[3]-ox,c[4]-oy,c[5]-ox,c[6]-oy); break
      case 'Q': p.quadraticCurveTo(c[1]-ox,c[2]-oy,c[3]-ox,c[4]-oy); break
      case 'Z': p.closePath(); break
    }
  }
  return p
}

// Draw a single row of stitches with 3-layer 3D thread look (shadow / main / highlight).
// Handles both segmented fill (lineDash) and continuous satin (no dash).
function drawThreadRow(
  ctx: CanvasRenderingContext2D,
  y: number,
  diag: number,
  color: string,
  rgb: [number, number, number],
  stitchLen: number,   // 0 = satin (continuous)
  dashOffset: number,
) {
  const [r, g, b] = rgb
  const gap = 1.8
  const dash: number[] = stitchLen > 0 ? [stitchLen, gap] : []

  ctx.lineCap = 'round'
  ctx.setLineDash(dash)
  ctx.lineDashOffset = dashOffset

  // Shadow
  ctx.strokeStyle = `rgb(${r * 0.28 | 0},${g * 0.28 | 0},${b * 0.28 | 0})`
  ctx.lineWidth = 3.6
  ctx.beginPath(); ctx.moveTo(-diag, y); ctx.lineTo(diag, y); ctx.stroke()
  // Main thread colour
  ctx.strokeStyle = color
  ctx.lineWidth = 2.3
  ctx.beginPath(); ctx.moveTo(-diag, y); ctx.lineTo(diag, y); ctx.stroke()
  // Highlight
  ctx.strokeStyle = `rgb(${Math.min(255, r + 80) | 0},${Math.min(255, g + 80) | 0},${Math.min(255, b + 80) | 0})`
  ctx.lineWidth = 0.7
  ctx.beginPath(); ctx.moveTo(-diag, y); ctx.lineTo(diag, y); ctx.stroke()
}

// Fill a clipped region with parallel embroidery thread rows.
function drawEmbroideryFill(
  ctx: CanvasRenderingContext2D,
  diag: number,
  props: StitchProperties,
) {
  const rgb = parseHex(props.color)
  const isSatin = props.stitchType === 'satin'
  // satin: denser rows, no segmentation; fill: brick-pattern short stitches
  const rowSpacing  = isSatin ? Math.max(3, props.density * 0.6) : props.density
  const stitchLen   = isSatin ? 0 : Math.max(8, props.density * 1.8)
  const brickCycle  = stitchLen > 0 ? stitchLen + 1.8 : 0

  ctx.save()
  ctx.rotate((props.angle * Math.PI) / 180)
  const n = Math.ceil((diag * 2) / rowSpacing) + 2
  for (let i = -n; i <= n; i++) {
    const brickOff = (brickCycle > 0 && i % 2 !== 0) ? brickCycle * 0.5 : 0
    drawThreadRow(ctx, i * rowSpacing, diag, props.color, rgb, stitchLen, brickOff)
  }
  ctx.restore()
}

// Stroke an outline path with a dashed 3D running stitch.
// `pathFn` should call ctx.beginPath() + shape commands (no stroke call).
function drawRunningStitch(
  ctx: CanvasRenderingContext2D,
  pathFn: () => void,
  props: StitchProperties,
) {
  const [r, g, b] = parseHex(props.color)
  ctx.lineCap = 'round'
  ctx.setLineDash([10, 6])
  ctx.lineDashOffset = 0

  ctx.strokeStyle = `rgb(${r * 0.28 | 0},${g * 0.28 | 0},${b * 0.28 | 0})`
  ctx.lineWidth = 3.6; pathFn(); ctx.stroke()
  ctx.strokeStyle = props.color
  ctx.lineWidth = 2.3; pathFn(); ctx.stroke()
  ctx.strokeStyle = `rgb(${Math.min(255, r + 80) | 0},${Math.min(255, g + 80) | 0},${Math.min(255, b + 80) | 0})`
  ctx.lineWidth = 0.7; pathFn(); ctx.stroke()
}

function renderTextStitch(
  ctx: CanvasRenderingContext2D,
  obj: fabric.IText,
  props: StitchProperties,
) {
  const mainCanvas = ctx.canvas
  const W = mainCanvas.width, H = mainCanvas.height
  const offEl = document.createElement('canvas')
  offEl.width = W; offEl.height = H
  const oc = offEl.getContext('2d')!

  // Mirror whatever transform ctx currently has (includes viewport zoom/pan)
  const vt = ctx.getTransform()
  oc.setTransform(vt)

  const center = obj.getCenterPoint()
  const sx = obj.scaleX ?? 1, sy = obj.scaleY ?? 1
  const w = (obj.width ?? 0) * sx, h = (obj.height ?? 0) * sy
  const diag = Math.sqrt(w * w + h * h)

  oc.save()
  oc.translate(center.x, center.y)
  oc.rotate(((obj.angle ?? 0) * Math.PI) / 180)
  if (props.stitchType === 'running') {
    drawRunningStitch(oc, () => { oc.beginPath(); oc.rect(-w / 2, -h / 2, w, h) }, props)
  } else {
    drawEmbroideryFill(oc, diag, props)
  }
  oc.restore()

  // Mask stitch lines to actual glyph outlines via destination-in compositing.
  // Use the same getCenterPoint()+rotate+scale as the stitch fill so origins match exactly.
  oc.globalCompositeOperation = 'destination-in'
  oc.setTransform(vt)
  oc.save()
  oc.translate(center.x, center.y)
  oc.rotate(((obj.angle ?? 0) * Math.PI) / 180)
  oc.scale(sx, sy)
  oc.fillStyle = 'white'
  const fSize = obj.fontSize ?? 28
  oc.font = `${obj.fontWeight ?? 'normal'} ${fSize}px "${obj.fontFamily ?? 'Arial'}"`
  oc.textAlign = 'center'
  oc.textBaseline = 'middle'
  const lines = (obj.text ?? '').split('\n')
  const lh = fSize * ((obj.lineHeight as number | undefined) ?? 1.16)
  const totalH = lines.length * lh
  lines.forEach((line, i) => {
    oc.fillText(line, 0, -totalH / 2 + (i + 0.5) * lh)
  })
  oc.restore()

  // Blit offscreen onto main canvas — reset to identity so pixel coords are direct
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.drawImage(offEl, 0, 0)
  ctx.restore()
}

function renderStitchPreview(ctx: CanvasRenderingContext2D, obj: fabric.Object) {
  const props = (obj as any).stitchProps as StitchProperties | undefined
  if (!props || !obj.visible) return

  if (obj.type === 'i-text') {
    renderTextStitch(ctx, obj as fabric.IText, props)
    return
  }

  ctx.save()

  if (obj.type === 'path') {
    // ── polygon / freehand / star ─────────────────────────────────────
    const cmds = (obj as any).path as any[] | undefined
    if (!cmds || cmds.length === 0) { ctx.restore(); return }
    const po = (obj as any).pathOffset as { x: number; y: number } | undefined
    const shape = buildPath2D(cmds, po?.x ?? 0, po?.y ?? 0)
    const m = obj.calcTransformMatrix()
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5])
    ctx.save(); ctx.clip(shape)
    const w = obj.width ?? 0, h = obj.height ?? 0
    const diag = Math.sqrt(w * w + h * h)
    if (props.stitchType === 'running') {
      const [rr, gg, bb] = parseHex(props.color)
      ctx.lineCap = 'round'
      ctx.setLineDash([10, 6])
      ctx.strokeStyle = `rgb(${rr * 0.28 | 0},${gg * 0.28 | 0},${bb * 0.28 | 0})`
      ctx.lineWidth = 3.6; ctx.stroke(shape)
      ctx.strokeStyle = props.color
      ctx.lineWidth = 2.3; ctx.stroke(shape)
      ctx.strokeStyle = `rgb(${Math.min(255, rr + 80) | 0},${Math.min(255, gg + 80) | 0},${Math.min(255, bb + 80) | 0})`
      ctx.lineWidth = 0.7; ctx.stroke(shape)
    } else {
      drawEmbroideryFill(ctx, diag, props)
    }
    ctx.restore()
  } else {
    // ── rect / circle / triangle ──────────────────────────────────────
    const sx = obj.scaleX ?? 1, sy = obj.scaleY ?? 1
    const w = (obj.width ?? 0) * sx, h = (obj.height ?? 0) * sy
    const isCircle   = obj.type === 'circle'
    const isTriangle = obj.type === 'triangle'
    const r    = isCircle ? ((obj as fabric.Circle).radius ?? 0) * Math.max(sx, sy) : 0
    const diag = Math.sqrt((isCircle ? r * 2 : w) ** 2 + (isCircle ? r * 2 : h) ** 2)

    const center = obj.getCenterPoint()
    ctx.translate(center.x, center.y)
    ctx.rotate(((obj.angle ?? 0) * Math.PI) / 180)

    const clipPath = () => {
      ctx.beginPath()
      if (isCircle)        ctx.arc(0, 0, r, 0, Math.PI * 2)
      else if (isTriangle) { ctx.moveTo(0,-h/2); ctx.lineTo(w/2,h/2); ctx.lineTo(-w/2,h/2); ctx.closePath() }
      else                 ctx.rect(-w/2, -h/2, w, h)
    }

    ctx.save(); clipPath(); ctx.clip()
    if (props.stitchType === 'running') {
      drawRunningStitch(ctx, clipPath, props)
    } else {
      drawEmbroideryFill(ctx, diag, props)
    }
    ctx.restore()
  }

  ctx.restore()
}

// ─── Component ─────────────────────────────────────────────────────────────

const EmbroideryCanvas = forwardRef<EmbroideryCanvasHandle, Props>(
  ({ activeTool, stitchProps, onSelectionChange, onObjectsChange, onZoomChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasElRef = useRef<HTMLCanvasElement>(null)
    const overlayRef = useRef<HTMLCanvasElement>(null)
    const fcRef = useRef<fabric.Canvas | null>(null)
    const hoopRef = useRef<{ centerX: number; centerY: number; size: number } | null>(null)

    const activeToolRef = useRef(activeTool)
    const stitchPropsRef = useRef(stitchProps)
    const onSelChangeRef = useRef(onSelectionChange)
    const onObjsChangeRef = useRef(onObjectsChange)
    const onZoomChangeRef = useRef(onZoomChange)
    activeToolRef.current = activeTool
    stitchPropsRef.current = stitchProps
    onSelChangeRef.current = onSelectionChange
    onObjsChangeRef.current = onObjectsChange
    onZoomChangeRef.current = onZoomChange

    const isDrawingRef = useRef(false)
    const startPtRef = useRef<fabric.Point | null>(null)
    const drawingShapeRef = useRef<fabric.Object | null>(null)
    const polyPointsRef = useRef<{ x: number; y: number }[]>([])
    const polyLinesRef = useRef<fabric.Line[]>([])
    const polyPreviewRef = useRef<fabric.Line | null>(null)
    const spaceHeldRef = useRef(false)
    const isPanningRef = useRef(false)
    const lastPanPtRef = useRef<{ x: number; y: number } | null>(null)

    const notifyObjects = useCallback(() => {
      const fc = fcRef.current
      if (!fc || !onObjsChangeRef.current) return
      onObjsChangeRef.current(getObjectsList(fc))
    }, [])

    useImperativeHandle(ref, () => ({
      updateSelectedObjectStitch(props) {
        const obj = fcRef.current?.getActiveObject()
        if (!obj) return
        ;(obj as any).stitchProps = props
        // update color indicator
        if (obj.type !== 'i-text') obj.set({ stroke: props.color })
        fcRef.current!.renderAll()
        notifyObjects()
      },
      deleteSelected() {
        const fc = fcRef.current
        if (!fc) return
        fc.getActiveObjects().forEach(o => fc.remove(o))
        fc.discardActiveObject()
        fc.renderAll()
        notifyObjects()
      },
      selectObjectById(id) {
        const fc = fcRef.current
        if (!fc) return
        const obj = fc.getObjects().find(o => (o as any)._tl_id === id)
        if (obj) { fc.setActiveObject(obj); fc.renderAll() }
      },
      toggleObjectVisibility(id) {
        const fc = fcRef.current
        if (!fc) return
        const obj = fc.getObjects().find(o => (o as any)._tl_id === id)
        if (obj) { obj.visible = !obj.visible; fc.renderAll(); notifyObjects() }
      },
      resetView() {
        const fc = fcRef.current
        if (!fc) return
        fc.setViewportTransform([1, 0, 0, 1, 0, 0])
        fc.renderAll()
        onZoomChangeRef.current?.(1)
      },
      getExportData(): ExportData | null {
        const fc = fcRef.current
        const hoop = hoopRef.current
        if (!fc || !hoop) return null
        const shapes: SerializedShape[] = []
        fc.getObjects().forEach(obj => {
          if ((obj as any).data?.isHoop || (obj as any).data?.isPolyLine) return
          const sp = (obj as any).stitchProps as StitchProperties | undefined
          if (!sp) return
          const center = obj.getCenterPoint()
          const sx = obj.scaleX ?? 1, sy = obj.scaleY ?? 1
          const base = {
            centerX: center.x, centerY: center.y,
            width: (obj.width ?? 0) * sx, height: (obj.height ?? 0) * sy,
            angle: obj.angle ?? 0, stitchProps: sp,
          }
          if (obj.type === 'rect') {
            shapes.push({ type: 'rect', ...base })
          } else if (obj.type === 'triangle') {
            shapes.push({ type: 'triangle', ...base })
          } else if (obj.type === 'circle') {
            shapes.push({ type: 'circle', ...base, radius: ((obj as fabric.Circle).radius ?? 0) * Math.max(sx, sy) })
          } else if (obj.type === 'path') {
            // Convert Fabric path commands to canvas-space SVG path string
            const rawPath = (obj as any).path as any[] | undefined
            const po = (obj as any).pathOffset as { x: number; y: number } | undefined
            if (rawPath) {
              const m = obj.calcTransformMatrix()
              const tx = (lx: number, ly: number) => {
                const ox = lx - (po?.x ?? 0), oy = ly - (po?.y ?? 0)
                return [m[0]*ox + m[2]*oy + m[4], m[1]*ox + m[3]*oy + m[5]] as [number, number]
              }
              const parts: string[] = []
              for (const cmd of rawPath) {
                const type = cmd[0] as string
                if (type === 'M' || type === 'L') {
                  const [cx, cy] = tx(cmd[1], cmd[2])
                  parts.push(`${type} ${cx.toFixed(2)} ${cy.toFixed(2)}`)
                } else if (type === 'C') {
                  const [x1, y1] = tx(cmd[1], cmd[2])
                  const [x2, y2] = tx(cmd[3], cmd[4])
                  const [ex, ey] = tx(cmd[5], cmd[6])
                  parts.push(`C ${x1.toFixed(2)} ${y1.toFixed(2)} ${x2.toFixed(2)} ${y2.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`)
                } else if (type === 'Q') {
                  const [x1, y1] = tx(cmd[1], cmd[2])
                  const [ex, ey] = tx(cmd[3], cmd[4])
                  parts.push(`Q ${x1.toFixed(2)} ${y1.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`)
                } else if (type === 'Z' || type === 'z') {
                  parts.push('Z')
                }
              }
              // Path is already in canvas space — send centerX/Y=0, angle=0 so backend
              // does not apply a second transform on top of the already-transformed coords.
              shapes.push({ type: 'path', ...base, centerX: 0, centerY: 0, angle: 0, pathData: parts.join(' ') })
            }
          }
        })
        return { shapes, hoopCenterX: hoop.centerX, hoopCenterY: hoop.centerY, hoopSize: hoop.size, hoopPhysicalMM: 150 }
      },
    }))

    const initCanvas = useCallback(() => {
      const container = containerRef.current
      const el = canvasElRef.current
      if (!container || !el) return

      // Compute canvas size from window dimensions + CSS variable offsets.
      // This is more reliable than container.clientWidth which can read as 0
      // if layout hasn't settled when the effect fires.
      const getCSSPx = (name: string, fallback: number) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
        const n = parseFloat(v)
        return isNaN(n) ? fallback : n
      }
      const getSize = () => ({
        w: Math.floor(window.innerWidth  - getCSSPx('--sidebar-w', 210) - getCSSPx('--params-w', 272)),
        h: Math.floor(window.innerHeight - getCSSPx('--topbar-h',  48)),
      })

      const { w: iw, h: ih } = getSize()
      el.width  = iw
      el.height = ih

      const fc = new fabric.Canvas(el, {
        selection: true,
        preserveObjectStacking: true,
        width: iw,
        height: ih,
      })
      fcRef.current = fc
      hoopRef.current = { centerX: iw / 2, centerY: ih / 2, size: Math.min(iw, ih) * 0.8 }

      const resize = () => {
        const { w, h } = getSize()
        if (w <= 0 || h <= 0) return
        fc.setWidth(w); fc.setHeight(h)
        const ov = overlayRef.current
        if (ov) { ov.width = w; ov.height = h }
        hoopRef.current = { centerX: w / 2, centerY: h / 2, size: Math.min(w, h) * 0.8 }
        fc.renderAll()
      }
      resize() // sync call so Fabric dimensions match the CSS immediately
      let rafId = requestAnimationFrame(resize)
      const ro = new ResizeObserver(() => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(resize) })
      ro.observe(container)
      window.addEventListener('resize', resize)

      // ── Grid overlay — draws on top of CSS background, zooms/pans with objects ──
      fc.on('before:render', ({ ctx }: any) => {
        const vpt = (fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]) as number[]
        const zoom = vpt[0]
        const W = fc.width ?? 0, H = fc.height ?? 0

        // Clear to transparent so the CSS background on <main> shows through
        ctx.save()
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
        ctx.restore()

        // Grid lines in world space — these zoom and pan with the canvas
        const invZ = 1 / zoom
        const ox = -vpt[4] * invZ, oy = -vpt[5] * invZ
        const ex = ox + W * invZ, ey = oy + H * invZ
        const grid = 25
        const x0 = Math.floor(ox / grid) * grid
        const y0 = Math.floor(oy / grid) * grid

        ctx.save()
        ctx.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5])
        ctx.strokeStyle = '#e0e0e0'
        ctx.lineWidth = 1 / zoom
        ctx.setLineDash([])
        ctx.beginPath()
        for (let x = x0; x <= ex + grid; x += grid) { ctx.moveTo(x, oy); ctx.lineTo(x, ey) }
        for (let y = y0; y <= ey + grid; y += grid) { ctx.moveTo(ox, y); ctx.lineTo(ex, y) }
        ctx.stroke()
        ctx.restore()
      })

      // ── Stitch preview (separate overlay canvas — avoids Fabric ctx transform ambiguity) ──
      fc.on('after:render', () => {
        const ov = overlayRef.current
        if (!ov) return
        const oc = ov.getContext('2d')!
        oc.clearRect(0, 0, ov.width, ov.height)
        // ctx is at identity in after:render (Fabric restores it before firing the event)
        // so we apply the viewport transform ourselves on our own overlay canvas
        const vpt = (fc.viewportTransform ?? [1, 0, 0, 1, 0, 0]) as number[]
        oc.save()
        oc.setTransform(vpt[0], vpt[1], vpt[2], vpt[3], vpt[4], vpt[5])
        fc.getObjects().forEach(obj => {
          if ((obj as any).data?.isHoop || (obj as any).data?.isPolyLine) return
          renderStitchPreview(oc, obj)
        })
        oc.restore()
      })

      // ── Zoom ─────────────────────────────────────────────────────────────
      fc.on('mouse:wheel', (opt) => {
        opt.e.preventDefault(); opt.e.stopPropagation()
        let z = fc.getZoom() * (0.999 ** opt.e.deltaY)
        z = Math.max(0.15, Math.min(5, z))
        fc.zoomToPoint(opt.pointer, z)
        onZoomChangeRef.current?.(z)
      })

      // ── Mouse down ───────────────────────────────────────────────────────
      fc.on('mouse:down', (e) => {
        if (!e.pointer) return
        const tool = activeToolRef.current
        const me = e.e as MouseEvent

        if (spaceHeldRef.current || me.altKey || me.button === 1) {
          isPanningRef.current = true
          lastPanPtRef.current = { x: me.clientX, y: me.clientY }
          fc.defaultCursor = 'grabbing'; fc.selection = false; return
        }

        if (tool === 'path') {
          const pt = { x: e.pointer.x, y: e.pointer.y }
          if (polyPointsRef.current.length > 0) {
            const prev = polyPointsRef.current[polyPointsRef.current.length - 1]
            const seg = new fabric.Line([prev.x, prev.y, pt.x, pt.y], {
              stroke: '#aaa', strokeWidth: 1, selectable: false, evented: false, data: { isPolyLine: true },
            })
            fc.add(seg); polyLinesRef.current.push(seg)
          }
          polyPointsRef.current.push(pt); fc.renderAll(); return
        }

        if (tool === 'select') return
        if (e.target && !(e.target as any).data?.isHoop) return

        isDrawingRef.current = true; startPtRef.current = e.pointer; fc.selection = false
        const props = { ...stitchPropsRef.current }

        if (tool === 'text') {
          const txt = new fabric.IText('Text', {
            left: e.pointer.x, top: e.pointer.y,
            fontSize: 28, fill: '#ffffff', fontFamily: 'Inter, Arial', fontWeight: '600',
          })
          ;(txt as any).stitchProps = props
          ;(txt as any)._tl_id = uid()
          ;(txt as any)._tl_name = nextName('i-text')
          fc.add(txt); fc.setActiveObject(txt); txt.enterEditing(); txt.selectAll()
          isDrawingRef.current = false
          onSelChangeRef.current(true, props); notifyObjects(); fc.renderAll(); return
        }

        const common = { fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1, selectable: false, evented: false }
        let shape: fabric.Object | null = null

        if      (tool === 'rect')     shape = new fabric.Rect({ ...common, left: e.pointer.x, top: e.pointer.y, width: 1, height: 1 })
        else if (tool === 'circle')   shape = new fabric.Circle({ ...common, left: e.pointer.x, top: e.pointer.y, radius: 1 })
        else if (tool === 'triangle') shape = new fabric.Triangle({ ...common, left: e.pointer.x, top: e.pointer.y, width: 1, height: 1 })
        else if (tool === 'star')     shape = new fabric.Path(starPath(e.pointer.x, e.pointer.y, 1, 0.4), { ...common })

        if (shape) {
          ;(shape as any).stitchProps = props
          ;(shape as any)._tl_id = uid()
          ;(shape as any)._tl_name = nextName(tool === 'star' ? 'path' : tool)
          fc.add(shape); drawingShapeRef.current = shape
        }
      })

      // ── Mouse move ───────────────────────────────────────────────────────
      fc.on('mouse:move', (e) => {
        if (!e.pointer) return
        const tool = activeToolRef.current
        const me2 = e.e as MouseEvent

        if (isPanningRef.current && lastPanPtRef.current) {
          const dx = me2.clientX - lastPanPtRef.current.x
          const dy = me2.clientY - lastPanPtRef.current.y
          fc.relativePan(new fabric.Point(dx, dy))
          lastPanPtRef.current = { x: me2.clientX, y: me2.clientY }; return
        }

        if (tool === 'path' && polyPointsRef.current.length > 0) {
          if (polyPreviewRef.current) fc.remove(polyPreviewRef.current)
          const prev = polyPointsRef.current[polyPointsRef.current.length - 1]
          const line = new fabric.Line([prev.x, prev.y, e.pointer.x, e.pointer.y], {
            stroke: '#666', strokeWidth: 1, strokeDashArray: [4, 3],
            selectable: false, evented: false, data: { isPolyLine: true },
          })
          fc.add(line); polyPreviewRef.current = line; fc.renderAll(); return
        }

        if (!isDrawingRef.current || !startPtRef.current || !drawingShapeRef.current) return
        const p = e.pointer, s = startPtRef.current

        if (tool === 'rect' || tool === 'triangle') {
          ;(drawingShapeRef.current as fabric.Rect).set({
            left: Math.min(s.x, p.x), top: Math.min(s.y, p.y),
            width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y),
          })
        } else if (tool === 'circle') {
          const dx = p.x - s.x, dy = p.y - s.y, r = Math.sqrt(dx * dx + dy * dy) / 2
          ;(drawingShapeRef.current as fabric.Circle).set({ left: (s.x + p.x) / 2 - r, top: (s.y + p.y) / 2 - r, radius: r })
        } else if (tool === 'star') {
          const cx = (s.x + p.x) / 2, cy = (s.y + p.y) / 2
          const outerR = Math.min(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) / 2
          const prev = drawingShapeRef.current; const prevProps = (prev as any).stitchProps; const prevId = (prev as any)._tl_id; const prevName = (prev as any)._tl_name
          fc.remove(prev)
          const shape = new fabric.Path(starPath(cx, cy, outerR, outerR * 0.42), {
            fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1,
            selectable: false, evented: false,
          })
          ;(shape as any).stitchProps = prevProps; (shape as any)._tl_id = prevId; (shape as any)._tl_name = prevName
          fc.add(shape); drawingShapeRef.current = shape
        }
        fc.renderAll()
      })

      // ── Mouse up ─────────────────────────────────────────────────────────
      fc.on('mouse:up', () => {
        if (isPanningRef.current) {
          isPanningRef.current = false; lastPanPtRef.current = null
          const tool = activeToolRef.current
          fc.defaultCursor = spaceHeldRef.current ? 'grab' : tool === 'select' ? 'default' : 'crosshair'
          if (!spaceHeldRef.current) fc.selection = tool === 'select'; return
        }
        if (!isDrawingRef.current) return
        isDrawingRef.current = false
        const shape = drawingShapeRef.current; drawingShapeRef.current = null; startPtRef.current = null

        if (shape) {
          const tooSmall = shape.type === 'circle'
            ? ((shape as fabric.Circle).radius ?? 0) < 5
            : (shape.width ?? 0) < 5 || (shape.height ?? 0) < 5
          if (tooSmall) { fc.remove(shape) }
          else {
            shape.set({ selectable: true, evented: true })
            fc.setActiveObject(shape)
            onSelChangeRef.current(true, (shape as any).stitchProps)
            notifyObjects()
          }
        }
        fc.selection = true; fc.renderAll()
      })

      // ── Double-click: close polygon ───────────────────────────────────────
      fc.on('mouse:dblclick', () => {
        if (activeToolRef.current !== 'path' || polyPointsRef.current.length < 3) return
        polyLinesRef.current.forEach(l => fc.remove(l))
        if (polyPreviewRef.current) fc.remove(polyPreviewRef.current)
        polyLinesRef.current = []; polyPreviewRef.current = null
        const pts = [...polyPointsRef.current]; polyPointsRef.current = []
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
        const props = { ...stitchPropsRef.current }
        const shape = new fabric.Path(d, { fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(255,255,255,0.3)', strokeWidth: 1 })
        ;(shape as any).stitchProps = props
        ;(shape as any)._tl_id = uid()
        ;(shape as any)._tl_name = nextName('path')
        fc.add(shape); fc.setActiveObject(shape); fc.renderAll()
        onSelChangeRef.current(true, props); notifyObjects()
      })

      // ── Freehand path created ─────────────────────────────────────────────
      fc.on('path:created', (e: any) => {
        const path: fabric.Path = e.path
        ;(path as any).stitchProps = { ...stitchPropsRef.current }
        ;(path as any)._tl_id = uid()
        ;(path as any)._tl_name = nextName('path')
        path.set({ fill: 'transparent', stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1.5 })
        fc.setActiveObject(path); fc.renderAll()
        onSelChangeRef.current(true, stitchPropsRef.current); notifyObjects()
      })

      // ── Selection ─────────────────────────────────────────────────────────
      const onSel = (e: any) => {
        const obj = e?.selected?.[0]
        onSelChangeRef.current(true, (obj as any)?.stitchProps ?? null)
        notifyObjects()
      }
      fc.on('selection:created', onSel)
      fc.on('selection:updated', onSel)
      fc.on('selection:cleared', () => { onSelChangeRef.current(false, null); notifyObjects() })

      // ── Keyboard ──────────────────────────────────────────────────────────
      const onKeyDown = (ev: KeyboardEvent) => {
        const inInput = (ev.target as HTMLElement).tagName === 'INPUT' || (ev.target as HTMLElement).tagName === 'TEXTAREA' || (ev.target as HTMLElement).isContentEditable
        if (ev.key === ' ' && !inInput) {
          ev.preventDefault()
          if (!spaceHeldRef.current) { spaceHeldRef.current = true; fc.defaultCursor = 'grab' }
        }
        if ((ev.key === 'Delete' || ev.key === 'Backspace') && !inInput) {
          fc.getActiveObjects().forEach(o => fc.remove(o)); fc.discardActiveObject(); fc.renderAll(); notifyObjects()
        }
      }
      const onKeyUp = (ev: KeyboardEvent) => {
        if (ev.key === ' ') {
          spaceHeldRef.current = false
          fc.defaultCursor = activeToolRef.current === 'select' ? 'default' : 'crosshair'
        }
      }
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)

      return () => {
        cancelAnimationFrame(rafId)
        ro.disconnect()
        window.removeEventListener('resize', resize)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        fc.dispose(); fcRef.current = null
      }
    }, [notifyObjects])

    useEffect(() => { const cleanup = initCanvas(); return () => { cleanup?.() } }, [initCanvas])

    useEffect(() => {
      const fc = fcRef.current
      if (!fc) return
      if (activeTool !== 'path' && polyPointsRef.current.length > 0) {
        polyLinesRef.current.forEach(l => fc.remove(l))
        if (polyPreviewRef.current) fc.remove(polyPreviewRef.current)
        polyLinesRef.current = []; polyPreviewRef.current = null; polyPointsRef.current = []; fc.renderAll()
      }
      if (activeTool === 'freehand') {
        fc.isDrawingMode = true
        const b = fc.freeDrawingBrush
        if (b) { b.color = stitchProps.color; b.width = 2 }
        fc.defaultCursor = 'crosshair'; fc.selection = false
      } else if (activeTool === 'select') {
        fc.isDrawingMode = false; fc.defaultCursor = 'default'; fc.selection = true
        fc.getObjects().forEach(o => { if (!(o as any).data?.isHoop) { o.selectable = true; o.evented = true } })
      } else {
        fc.isDrawingMode = false; fc.defaultCursor = 'crosshair'; fc.selection = false
        fc.getObjects().forEach(o => {
          if (!(o as any).data?.isHoop && !(o as any).data?.isPolyLine) { o.selectable = false; o.evented = false }
        })
      }
    }, [activeTool, stitchProps.color])

    return (
      <div ref={containerRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
        <canvas ref={canvasElRef} />
        <canvas ref={overlayRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
      </div>
    )
  }
)

EmbroideryCanvas.displayName = 'EmbroideryCanvas'
export default EmbroideryCanvas
