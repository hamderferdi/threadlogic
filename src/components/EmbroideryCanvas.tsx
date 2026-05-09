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

function renderStitchPreview(ctx: CanvasRenderingContext2D, obj: fabric.Object) {
  const props = (obj as any).stitchProps as StitchProperties | undefined
  if (!props || !obj.visible) return

  const center = obj.getCenterPoint()
  const scaleX = obj.scaleX ?? 1
  const scaleY = obj.scaleY ?? 1
  const objRad = ((obj.angle ?? 0) * Math.PI) / 180
  const w = (obj.width ?? 0) * scaleX
  const h = (obj.height ?? 0) * scaleY

  ctx.save()
  ctx.translate(center.x, center.y)
  ctx.rotate(objRad)

  ctx.beginPath()
  if (obj.type === 'circle') {
    ctx.arc(0, 0, ((obj as fabric.Circle).radius ?? 0) * Math.max(scaleX, scaleY), 0, Math.PI * 2)
  } else if (obj.type === 'triangle') {
    ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath()
  } else {
    ctx.rect(-w / 2, -h / 2, w, h)
  }
  ctx.clip()

  const dw = obj.type === 'circle' ? ((obj as fabric.Circle).radius ?? 0) * 2 * Math.max(scaleX, scaleY) : w
  const dh = obj.type === 'circle' ? ((obj as fabric.Circle).radius ?? 0) * 2 * Math.max(scaleX, scaleY) : h
  const diag = Math.sqrt(dw * dw + dh * dh)

  ctx.globalAlpha = 0.75
  ctx.strokeStyle = props.color

  if (props.stitchType === 'running') {
    ctx.setLineDash([7, 5])
    ctx.lineWidth = 1.6
    ctx.beginPath()
    if (obj.type === 'circle') {
      ctx.arc(0, 0, ((obj as fabric.Circle).radius ?? 0) * Math.max(scaleX, scaleY), 0, Math.PI * 2)
    } else if (obj.type === 'triangle') {
      ctx.moveTo(0, -h / 2); ctx.lineTo(w / 2, h / 2); ctx.lineTo(-w / 2, h / 2); ctx.closePath()
    } else {
      ctx.rect(-w / 2, -h / 2, w, h)
    }
    ctx.stroke()
  } else {
    ctx.setLineDash([])
    ctx.lineWidth = 0.9
    ctx.rotate((props.angle * Math.PI) / 180)
    const n = Math.ceil((diag * 2) / props.density) + 2
    for (let i = -n; i <= n; i++) {
      const y = i * props.density
      ctx.beginPath(); ctx.moveTo(-diag, y); ctx.lineTo(diag, y); ctx.stroke()
    }
  }
  ctx.restore()
}

// ─── Component ─────────────────────────────────────────────────────────────

const EmbroideryCanvas = forwardRef<EmbroideryCanvasHandle, Props>(
  ({ activeTool, stitchProps, onSelectionChange, onObjectsChange, onZoomChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const canvasElRef = useRef<HTMLCanvasElement>(null)
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
          if (obj.type === 'rect')     shapes.push({ type: 'rect', ...base })
          else if (obj.type === 'triangle') shapes.push({ type: 'triangle', ...base })
          else if (obj.type === 'circle')
            shapes.push({ type: 'circle', ...base, radius: ((obj as fabric.Circle).radius ?? 0) * Math.max(sx, sy) })
          else if (obj.type === 'path') shapes.push({ type: 'path', ...base })
        })
        return { shapes, hoopCenterX: hoop.centerX, hoopCenterY: hoop.centerY, hoopSize: hoop.size, hoopPhysicalMM: 150 }
      },
    }))

    const initCanvas = useCallback(() => {
      const container = containerRef.current
      const el = canvasElRef.current
      if (!container || !el) return

      const fc = new fabric.Canvas(el, {
        backgroundColor: '#5c6475',
        selection: true,
        preserveObjectStacking: true,
      })
      fcRef.current = fc

      const resize = () => { fc.setWidth(container.clientWidth); fc.setHeight(container.clientHeight); fc.renderAll() }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(container)

      // ── Circular hoop ────────────────────────────────────────────────────
      const makeHoop = () => {
        const cw = container.clientWidth, ch = container.clientHeight
        const size = Math.min(cw, ch) * 0.78
        const cx = cw / 2, cy = ch / 2
        hoopRef.current = { centerX: cx, centerY: cy, size }

        const hoopData = { isHoop: true }
        const commonHoop = { selectable: false, evented: false, data: hoopData }

        // Outer brass ring
        const outerRing = new fabric.Circle({
          ...commonHoop,
          radius: size / 2, left: cx - size / 2, top: cy - size / 2,
          fill: '#b8955a', stroke: '#7a5c1e', strokeWidth: 2,
        })
        // Middle screw ring
        const innerRingR = size / 2 - 14
        const innerRing = new fabric.Circle({
          ...commonHoop,
          radius: innerRingR, left: cx - innerRingR, top: cy - innerRingR,
          fill: '#d4aa6e', stroke: '#9a6f28', strokeWidth: 1.5,
        })
        // Fabric (cream)
        const fabricR = size / 2 - 22
        const fabricCircle = new fabric.Circle({
          ...commonHoop,
          radius: fabricR, left: cx - fabricR, top: cy - fabricR,
          fill: '#f4ede0', stroke: '#e0d4be', strokeWidth: 1,
        })
        fc.add(outerRing, innerRing, fabricCircle)
        fc.sendObjectToBack(fabricCircle)
        fc.sendObjectToBack(innerRing)
        fc.sendObjectToBack(outerRing)
      }
      makeHoop()

      // ── Stitch preview ───────────────────────────────────────────────────
      fc.on('after:render', (e: any) => {
        const ctx: CanvasRenderingContext2D | undefined = e?.ctx ?? (fc as any).contextContainer
        if (!ctx) return
        fc.getObjects().forEach(obj => {
          if ((obj as any).data?.isHoop || (obj as any).data?.isPolyLine) return
          renderStitchPreview(ctx, obj)
        })
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
        ro.disconnect()
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
      <div ref={containerRef} className="w-full h-full">
        <canvas ref={canvasElRef} />
      </div>
    )
  }
)

EmbroideryCanvas.displayName = 'EmbroideryCanvas'
export default EmbroideryCanvas
