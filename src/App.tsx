import { useState, useRef } from 'react'
import { Download, Maximize2 } from 'lucide-react'
import Toolbar from './components/Toolbar'
import EmbroideryCanvas, { type EmbroideryCanvasHandle } from './components/EmbroideryCanvas'
import RightPanel from './components/RightPanel'
import {
  type Tool,
  type StitchProperties,
  type CanvasObjectInfo,
  DEFAULT_STITCH_PROPS,
} from './types/embroidery'
import './App.css'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

const HINTS: Partial<Record<Tool, string>> = {
  path:     'Click points · Double-click to close',
  text:     'Click to place',
  select:   'Scroll to zoom · Space+drag or Alt+drag to pan',
}

export default function App() {
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [stitchProps, setStitchProps] = useState<StitchProperties>(DEFAULT_STITCH_PROPS)
  const [hasSelection, setHasSelection] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [objects, setObjects] = useState<CanvasObjectInfo[]>([])
  const [projectName, setProjectName] = useState('Untitled Design')
  const canvasRef = useRef<EmbroideryCanvasHandle>(null)

  const handleSelectionChange = (selected: boolean, props: StitchProperties | null) => {
    setHasSelection(selected)
    if (props) setStitchProps(props)
  }

  const handleStitchChange = (newProps: StitchProperties) => {
    setStitchProps(newProps)
    canvasRef.current?.updateSelectedObjectStitch(newProps)
  }

  const handleExport = async () => {
    const data = canvasRef.current?.getExportData()
    if (!data || data.shapes.length === 0) {
      alert('Add some shapes to the canvas first.')
      return
    }
    setExporting(true)
    try {
      const res = await fetch(`${BACKEND}/export/dst`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), { href: url, download: `${projectName}.dst` })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed — is the backend running?\n\ncd embroidery-app/backend && python3 main.py')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      style={{ background: 'var(--panel-dark)', color: 'var(--text)' }}
      className="flex flex-col h-screen overflow-hidden select-none"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        style={{ background: 'var(--panel-dark)', borderBottom: '1px solid var(--border)' }}
        className="flex items-center gap-3 px-4 h-9 shrink-0"
      >
        {/* Logo */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            style={{ background: 'linear-gradient(135deg, #e8734a, #c44a1a)' }}
            className="w-5 h-5 rounded flex items-center justify-center text-white text-xs font-bold"
          >
            T
          </div>
          <span style={{ color: 'var(--text-dim)' }} className="text-xs font-medium hidden sm:block">
            ThreadLogic
          </span>
        </div>

        <div style={{ background: 'var(--border)' }} className="w-px h-4 shrink-0" />

        {/* Editable project name */}
        <input
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          style={{
            background: 'transparent',
            color: 'var(--text)',
            border: '1px solid transparent',
          }}
          className="text-xs font-medium px-1.5 py-0.5 rounded outline-none hover:border-[var(--border)] focus:border-[var(--accent)] transition-colors min-w-0 w-36"
        />

        {/* Zoom badge */}
        <button
          onClick={() => canvasRef.current?.resetView()}
          title="Reset zoom"
          style={{ color: 'var(--text-dim)', background: 'var(--panel-mid)', border: '1px solid var(--border)' }}
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono hover:text-white transition-colors ml-1"
        >
          <Maximize2 size={11} />
          {Math.round(zoom * 100)}%
        </button>

        {/* Hint */}
        <span style={{ color: 'var(--text-dim)' }} className="text-xs hidden md:block flex-1 text-center truncate px-2">
          {HINTS[activeTool] ?? (activeTool !== 'select' ? 'Drag to draw' : '')}
        </span>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{
            background: exporting ? 'var(--panel-mid)' : 'var(--accent)',
            border: '1px solid transparent',
          }}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:opacity-90 text-white shrink-0"
        >
          <Download size={12} />
          {exporting ? 'Exporting…' : 'Export .dst'}
        </button>
      </header>

      {/* ── Main area ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <main className="flex-1 overflow-hidden">
          <EmbroideryCanvas
            ref={canvasRef}
            activeTool={activeTool}
            stitchProps={stitchProps}
            onSelectionChange={handleSelectionChange}
            onObjectsChange={setObjects}
            onZoomChange={setZoom}
          />
        </main>

        {/* Right panel */}
        <RightPanel
          objects={objects}
          hasSelection={hasSelection}
          stitchProps={stitchProps}
          onStitchChange={handleStitchChange}
          onSelectObject={id => canvasRef.current?.selectObjectById(id)}
          onToggleVisibility={id => canvasRef.current?.toggleObjectVisibility(id)}
        />
      </div>

      {/* ── Bottom toolbar ─────────────────────────────────────────────── */}
      <Toolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        onDelete={() => canvasRef.current?.deleteSelected()}
      />
    </div>
  )
}
