import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from 'react'
import * as fabric from 'fabric'
import type { Tool, StitchProperties, ExportData, SerializedShape } from '../types/embroidery'

interface Props {
  activeTool: Tool
  stitchProps: StitchProperties
  onSelectionChange: (hasSelection: boolean, props: StitchProperties | null) => void
  onZoomChange?: (zoom: number) => void
}

export interface EmbroideryCanvasHandle {
  updateSelectedObjectStitch: (props: StitchProperties) => void
  deleteSelected: () => void
  getExportData: () => ExportData | null
  resetView: () => void
}

// ─── Star path helper ──────────────────────────────────────────────────────

function starPath(cx: number, cy: number, outerR: number, innerR: number, pts = 5): string {
  const parts: string[] = []
  for (let i = 0; i < pts * 2; i++) {
    const a = (Math.PI * i) / pts - Math.PI / 2
    const r = i % 2 === 0 ? outerR : innerR
    parts.push(`${i === 0 ? 'M' : 'L'} ${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`)
  }
  return parts.join(' ') + ' Z'
}

// ─── Stitch preview renderer ───────────────────────────────────────────────

function renderStitchPreview(ctx: CanvasRenderingContext2D, obj: fabric.Object) {
  const props = (obj as any).stitchProps as StitchProperties | undefined
  if (!props) return

  const center = obj.getCenterPoint()
  const scaleX = obj.scaleX ?? 1
  const scaleY = obj.scaleY ?? 1
  const objAngleRad = ((obj.angle ?? 0) * Math.PI) / 180
  const w = (obj.width ?? 0) * scaleX
  const h = (obj.height ?? 0) * scaleY

  ctx.save()
  ctx.translate(center.x, center.y)
  ctx.rotate(objAngleRad)

  ctx.beginPath()
  if (obj.type === 'circle') {
    const r = ((obj as fabric.Circle).radius ?? 0) * Math.max(scaleX, scaleY)
    ctx.arc(0, 0, r, 0, Math.PI * 2)
  } else if (obj.type === 'triangle') {
    ctx.moveTo(0, -h / 2)
    ctx.lineTo(w / 2, h / 2)
    ctx.lineTo(-w / 2, h / 2)
    ctx.closePath()
  } else {
    ctx.rect(-w / 2, -h / 2, w, h)
  }
  ctx.clip()

  const extW = obj.type === 'circle'
    ? ((obj as fabric.Circle).radius ?? 0) * 2 * Math.max(scaleX, scaleY)
    : w
  const extH = obj.type === 'circle'
    ? ((obj as fabric.Circle).radius ?? 0) * 2 * Math.max(scaleX, scaleY)
    : h
  const diag = Math.sqrt(extW * extW + extH * extH)

  ctx.globalAlpha = 0.72
  ctx.strokeStyle = props.color

  if (props.stitchType === 'running') {
    ctx.setLineDash([7, 5])
    ctx.lineWidth = 1.6
    ctx.beginPath()
    if (obj.type === 'circle') {
      const r = ((obj as fabric.Circle).radius ?? 0) * Math.max(scaleX, scaleY)
      ctx.arc(0, 0, r, 0, Math.PI * 2)
    } else if (obj.type === 'triangle') {
      ctx.moveTo(0, -h / 2)
      ctx.lineTo(w / 2, h / 2)
      ctx.lineTo(-w / 2, h / 2)
      ctx.closePath()
    } else {
      ctx.rect(-w / 2, -h / 2, w, h)
    }
    ctx.stroke()
  } else {
    ctx.setLineDash([])
    ctx.lineWidth = 0.9
    const stitchAngleRad = (props.angle * Math.PI) / 180
    ctx.rotate(stitchAngleRad)
    const numLines = Math.ceil((diag * 2) / props.density) + 2
    for (let i = -numLines; i <= numLines; i++) {
      const y = i * props.density
      ctx.beginPath()
      ctx.moveTo(-diag, y)
      ctx.lineTo(diag, y)
      ctx.stroke()
    }
  }

  ctx.restore()
}

// ─── Component ─────────────────────────────────────────────────────────────

const EmbroideryCanvas = forwardRef<EmbroideryCanvasHandle, Props>(
  ({ activeTool, stitchProps, onSelectionChange, onZoomChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasElRef = useRef<HTMLCanvasElement>(null)
    const fcRef = useRef<fabric.Canvas | null>(null)
    const hoopRef = useRef<{ centerX: number; centerY: number; size: number } | null>(null)

    // Mutable refs so event handlers always see current values
    const activeToolRef = useRef(activeTool)
    const stitchPropsRef = useRef(stitchProps)
    const onSelectionChangeRef = useRef(onSelectionChange)
    const onZoomChangeRef = useRef(onZoomChange)
    activeToolRef.current = activeTool
    stitchPropsRef.current = stitchProps
    onSelectionChangeRef.current = onSelectionChange
    onZoomChangeRef.current = onZoomChange

    // Drawing state
    const isDrawingRef = useRef(false)
    const startPtRef = useRef<fabric.Point | null>(null)
    const drawingShapeRef = useRef<fabric.Object | null>(null)
    // Polygon state
    const polyPointsRef = useRef<{ x: number; y: number }[]>([])
    const polyLinesRef = useRef<fabric.Line[]>([])
    const polyPreviewRef = useRef<fabric.Line | null>(null)
    // Pan state
    const spaceHeldRef = useRef(false)
    const isPanningRef = useRef(false)
    const lastPanPtRef = useRef<{ x: number; y: number } | null>(null)

    useImperativeHandle(ref, () => ({
      updateSelectedObjectStitch(props) {
        const obj = fcRef.current?.getActiveObject()
        if (!obj) return
        ;(obj as any).stitchProps = props
        fcRef.current!.renderAll()
      },
      deleteSelected() {
        const fc = fcRef.current
        if (!fc) return
        fc.getActiveObjects().forEach(o => fc.remove(o))
        fc.discardActiveObject()
        fc.renderAll()
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
          const sx = obj.scaleX ?? 1
          const sy = obj.scaleY ?? 1
          const base = {
            centerX: center.x,
            centerY: center.y,
            width: (obj.width ?? 0) * sx,
            height: (obj.height ?? 0) * sy,
            angle: obj.angle ?? 0,
            stitchProps: sp,
          }

          if (obj.type === 'rect')     shapes.push({ type: 'rect', ...base })
          else if (obj.type === 'triangle') shapes.push({ type: 'triangle', ...base })
          else if (obj.type === 'circle') {
            shapes.push({
              type: 'circle', ...base,
              radius: ((obj as fabric.Circle).radius ?? 0) * Math.max(sx, sy),
            })
          } else if (obj.type === 'path') {
            shapes.push({ type: 'path', ...base })
          }
        })

        return {
          shapes,
          hoopCenterX: hoop.centerX,
          hoopCenterY: hoop.centerY,
          hoopSize: hoop.size,
          hoopPhysicalMM: 150,
        }
      },
    }))

    const initCanvas = useCallback(() => {
      const container = containerRef.current
      const el = canvasElRef.current
      if (!container || !el) return

      const fc = new fabric.Canvas(el, {
        backgroundColor: '#18181b',
        selection: true,
        preserveObjectStacking: true,
      })
      fcRef.current = fc

      // ── Resize ──────────────────────────────────────────────────────────
      const resize = () => {
        fc.setWidth(container.clientWidth)
        fc.setHeight(container.clientHeight)
        fc.renderAll()
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(container)

      // ── Hoop ────────────────────────────────────────────────────────────
      const cw = container.clientWidth
      const ch = container.clientHeight
      const size = Math.min(cw, ch) * 0.82
      const hx = (cw - size) / 2
      const hy = (ch - size) / 2
      hoopRef.current = { centerX: hx + size / 2, centerY: hy + size / 2, size }

      const hoop = new fabric.Rect({
        left: hx, top: hy, width: size, height: size,
        fill: '#f5f0e8', stroke: '#7a6a5a', strokeWidth: 3,
        rx: 16, ry: 16,
        selectable: false, evented: false,
        data: { isHoop: true },
      })
      fc.add(hoop)
      fc.sendObjectToBack(hoop)

      // ── Stitch preview ───────────────────────────────────────────────────
      fc.on('after:render', (e: any) => {
        const ctx: CanvasRenderingContext2D | undefined =
          e?.ctx ?? (fc as any).contextContainer
        if (!ctx) return
        fc.getObjects().forEach(obj => {
          if ((obj as any).data?.isHoop || (obj as any).data?.isPolyLine) return
          renderStitchPreview(ctx, obj)
        })
      })

      // ── Zoom (mouse wheel) ───────────────────────────────────────────────
      fc.on('mouse:wheel', (opt) => {
        opt.e.preventDefault()
        opt.e.stopPropagation()
        let zoom = fc.getZoom() * (0.999 ** opt.e.deltaY)
        zoom = Math.max(0.1, Math.min(5, zoom))
        fc.zoomToPoint(opt.pointer, zoom)
        onZoomChangeRef.current?.(zoom)
      })

      // ── Mouse down ───────────────────────────────────────────────────────
      fc.on('mouse:down', (e) => {
        if (!e.pointer) return
        const tool = activeToolRef.current

        // Pan: space held or alt held or middle mouse
        const me = e.e as MouseEvent
        if (spaceHeldRef.current || me.altKey || me.button === 1) {
          isPanningRef.current = true
          lastPanPtRef.current = { x: me.clientX, y: me.clientY }
          fc.defaultCursor = 'grabbing'
          fc.selection = false
          return
        }

        // ── Polygon: click to add points ─────────────────────────────────
        if (tool === 'path') {
          const pt = { x: e.pointer.x, y: e.pointer.y }
          if (polyPointsRef.current.length > 0) {
            const prev = polyPointsRef.current[polyPointsRef.current.length - 1]
            const seg = new fabric.Line([prev.x, prev.y, pt.x, pt.y], {
              stroke: '#aaa', strokeWidth: 1,
              selectable: false, evented: false,
              data: { isPolyLine: true },
            })
            fc.add(seg)
            polyLinesRef.current.push(seg)
          }
          polyPointsRef.current.push(pt)
          fc.renderAll()
          return
        }

        if (tool === 'select') return
        if (e.target && !(e.target as any).data?.isHoop) return

        isDrawingRef.current = true
        startPtRef.current = e.pointer
        fc.selection = false
        const props = { ...stitchPropsRef.current }

        // ── Text: place on click ─────────────────────────────────────────
        if (tool === 'text') {
          const txt = new fabric.IText('Text', {
            left: e.pointer.x, top: e.pointer.y,
            fontSize: 28, fill: props.color,
            fontFamily: 'Arial', fontWeight: 'bold',
          })
          ;(txt as any).stitchProps = props
          fc.add(txt)
          fc.setActiveObject(txt)
          txt.enterEditing()
          txt.selectAll()
          isDrawingRef.current = false
          onSelectionChangeRef.current(true, props)
          fc.renderAll()
          return
        }

        let shape: fabric.Object | null = null
        const common = {
          fill: 'rgba(255,255,255,0.05)',
          stroke: '#aaa', strokeWidth: 1,
          selectable: false, evented: false,
        }

        if (tool === 'rect') {
          shape = new fabric.Rect({ ...common, left: e.pointer.x, top: e.pointer.y, width: 1, height: 1 })
        } else if (tool === 'circle') {
          shape = new fabric.Circle({ ...common, left: e.pointer.x, top: e.pointer.y, radius: 1 })
        } else if (tool === 'triangle') {
          shape = new fabric.Triangle({ ...common, left: e.pointer.x, top: e.pointer.y, width: 1, height: 1 })
        } else if (tool === 'star') {
          shape = new fabric.Path(starPath(e.pointer.x, e.pointer.y, 1, 0.4), { ...common })
        }

        if (shape) {
          ;(shape as any).stitchProps = props
          fc.add(shape)
          drawingShapeRef.current = shape
        }
      })

      // ── Mouse move ───────────────────────────────────────────────────────
      fc.on('mouse:move', (e) => {
        if (!e.pointer) return
        const tool = activeToolRef.current

        // Pan
        if (isPanningRef.current && lastPanPtRef.current) {
          const me2 = e.e as MouseEvent
          const dx = me2.clientX - lastPanPtRef.current.x
          const dy = me2.clientY - lastPanPtRef.current.y
          fc.relativePan(new fabric.Point(dx, dy))
          lastPanPtRef.current = { x: me2.clientX, y: me2.clientY }
          return
        }

        // Polygon preview
        if (tool === 'path' && polyPointsRef.current.length > 0) {
          if (polyPreviewRef.current) fc.remove(polyPreviewRef.current)
          const prev = polyPointsRef.current[polyPointsRef.current.length - 1]
          const line = new fabric.Line([prev.x, prev.y, e.pointer.x, e.pointer.y], {
            stroke: '#777', strokeWidth: 1, strokeDashArray: [4, 3],
            selectable: false, evented: false,
            data: { isPolyLine: true },
          })
          fc.add(line)
          polyPreviewRef.current = line
          fc.renderAll()
          return
        }

        if (!isDrawingRef.current || !startPtRef.current || !drawingShapeRef.current) return
        const p = e.pointer
        const s = startPtRef.current

        if (tool === 'rect' || tool === 'triangle') {
          const shape = drawingShapeRef.current as fabric.Rect | fabric.Triangle
          shape.set({
            left: Math.min(s.x, p.x), top: Math.min(s.y, p.y),
            width: Math.abs(p.x - s.x), height: Math.abs(p.y - s.y),
          })
        } else if (tool === 'circle') {
          const dx = p.x - s.x, dy = p.y - s.y
          const radius = Math.sqrt(dx * dx + dy * dy) / 2
          const cx = (s.x + p.x) / 2, cy = (s.y + p.y) / 2
          ;(drawingShapeRef.current as fabric.Circle).set({ left: cx - radius, top: cy - radius, radius })
        } else if (tool === 'star') {
          const cx = (s.x + p.x) / 2, cy = (s.y + p.y) / 2
          const outerR = Math.min(Math.abs(p.x - s.x), Math.abs(p.y - s.y)) / 2
          fc.remove(drawingShapeRef.current)
          const props = { ...stitchPropsRef.current }
          const shape = new fabric.Path(starPath(cx, cy, outerR, outerR * 0.42), {
            fill: 'rgba(255,255,255,0.05)',
            stroke: '#aaa', strokeWidth: 1,
            selectable: false, evented: false,
          })
          ;(shape as any).stitchProps = props
          fc.add(shape)
          drawingShapeRef.current = shape
        }
        fc.renderAll()
      })

      // ── Mouse up ─────────────────────────────────────────────────────────
      fc.on('mouse:up', () => {
        if (isPanningRef.current) {
          isPanningRef.current = false
          lastPanPtRef.current = null
          const tool = activeToolRef.current
          fc.defaultCursor = spaceHeldRef.current ? 'grab'
            : tool === 'select' ? 'default' : 'crosshair'
          if (!spaceHeldRef.current) fc.selection = tool === 'select'
          return
        }

        if (!isDrawingRef.current) return
        isDrawingRef.current = false
        const shape = drawingShapeRef.current
        drawingShapeRef.current = null
        startPtRef.current = null

        if (shape) {
          const tooSmall = shape.type === 'circle'
            ? ((shape as fabric.Circle).radius ?? 0) < 5
            : (shape.width ?? 0) < 5 || (shape.height ?? 0) < 5

          if (tooSmall) {
            fc.remove(shape)
          } else {
            shape.set({ selectable: true, evented: true })
            fc.setActiveObject(shape)
            onSelectionChangeRef.current(true, (shape as any).stitchProps)
          }
        }
        fc.selection = true
        fc.renderAll()
      })

      // ── Double-click: close polygon ───────────────────────────────────────
      fc.on('mouse:dblclick', () => {
        if (activeToolRef.current !== 'path' || polyPointsRef.current.length < 3) return

        polyLinesRef.current.forEach(l => fc.remove(l))
        if (polyPreviewRef.current) fc.remove(polyPreviewRef.current)
        polyLinesRef.current = []
        polyPreviewRef.current = null

        const pts = [...polyPointsRef.current]
        polyPointsRef.current = []

        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ') + ' Z'
        const props = { ...stitchPropsRef.current }
        const shape = new fabric.Path(d, {
          fill: 'rgba(255,255,255,0.05)',
          stroke: '#aaa', strokeWidth: 1,
        })
        ;(shape as any).stitchProps = props
        fc.add(shape)
        fc.setActiveObject(shape)
        fc.renderAll()
        onSelectionChangeRef.current(true, props)
      })

      // ── Freehand path created ─────────────────────────────────────────────
      fc.on('path:created', (e: any) => {
        const path: fabric.Path = e.path
        ;(path as any).stitchProps = { ...stitchPropsRef.current }
        path.set({ fill: 'transparent', stroke: '#bbb', strokeWidth: 1 })
        fc.setActiveObject(path)
        fc.renderAll()
        onSelectionChangeRef.current(true, stitchPropsRef.current)
      })

      // ── Selection ─────────────────────────────────────────────────────────
      const onSelect = (e: any) => {
        const obj = e?.selected?.[0]
        onSelectionChangeRef.current(true, (obj as any)?.stitchProps ?? null)
      }
      fc.on('selection:created', onSelect)
      fc.on('selection:updated', onSelect)
      fc.on('selection:cleared', () => onSelectionChangeRef.current(false, null))

      // ── Keyboard ──────────────────────────────────────────────────────────
      const onKeyDown = (ev: KeyboardEvent) => {
        const target = ev.target as HTMLElement
        const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

        if (ev.key === ' ' && !inInput) {
          ev.preventDefault()
          if (!spaceHeldRef.current) {
            spaceHeldRef.current = true
            fc.defaultCursor = 'grab'
          }
        }

        if ((ev.key === 'Delete' || ev.key === 'Backspace') && !inInput) {
          fc.getActiveObjects().forEach(o => fc.remove(o))
          fc.discardActiveObject()
          fc.renderAll()
        }
      }
      const onKeyUp = (ev: KeyboardEvent) => {
        if (ev.key === ' ') {
          spaceHeldRef.current = false
          const tool = activeToolRef.current
          fc.defaultCursor = tool === 'select' ? 'default' : 'crosshair'
        }
      }
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)

      return () => {
        ro.disconnect()
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        fc.dispose()
        fcRef.current = null
      }
    }, [])

    useEffect(() => {
      const cleanup = initCanvas()
      return () => { cleanup?.() }
    }, [initCanvas])

    // Sync tool → canvas cursor / mode
    useEffect(() => {
      const fc = fcRef.current
      if (!fc) return

      // Cancel in-progress polygon when switching away
      if (activeTool !== 'path' && polyPointsRef.current.length > 0) {
        polyLinesRef.current.forEach(l => fc.remove(l))
        if (polyPreviewRef.current) fc.remove(polyPreviewRef.current)
        polyLinesRef.current = []
        polyPreviewRef.current = null
        polyPointsRef.current = []
        fc.renderAll()
      }

      if (activeTool === 'freehand') {
        fc.isDrawingMode = true
        const brush = fc.freeDrawingBrush
        if (brush) { brush.color = stitchProps.color; brush.width = 2 }
        fc.defaultCursor = 'crosshair'
        fc.selection = false
      } else if (activeTool === 'select') {
        fc.isDrawingMode = false
        fc.defaultCursor = 'default'
        fc.selection = true
        fc.getObjects().forEach(o => {
          if (!(o as any).data?.isHoop) { o.selectable = true; o.evented = true }
        })
      } else {
        fc.isDrawingMode = false
        fc.defaultCursor = 'crosshair'
        fc.selection = false
        fc.getObjects().forEach(o => {
          if (!(o as any).data?.isHoop && !(o as any).data?.isPolyLine) {
            o.selectable = false; o.evented = false
          }
        })
      }
    }, [activeTool, stitchProps.color])

    return (
      <div ref={containerRef} className="w-full h-full">
        <canvas ref={canvasElRef} />
      </div>
    )
  }
)

EmbroideryCanvas.displayName = 'EmbroideryCanvas'
export default EmbroideryCanvas
