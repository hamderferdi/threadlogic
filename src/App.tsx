import { useState, useRef } from 'react'
import { Download, Maximize2 } from 'lucide-react'
import Toolbar from './components/Toolbar'
import EmbroideryCanvas, { type EmbroideryCanvasHandle } from './components/EmbroideryCanvas'
import PropertiesPanel from './components/PropertiesPanel'
import { type Tool, type StitchProperties, DEFAULT_STITCH_PROPS } from './types/embroidery'
import './App.css'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'

const HINTS: Partial<Record<Tool, string>> = {
  path:     'Click to add points · Double-click to close',
  text:     'Click to place text',
  freehand: 'Click and drag to draw',
  rect:     'Click and drag to draw',
  circle:   'Click and drag to draw',
  triangle: 'Click and drag to draw',
  star:     'Click and drag to draw',
}

export default function App() {
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [stitchProps, setStitchProps] = useState<StitchProperties>(DEFAULT_STITCH_PROPS)
  const [hasSelection, setHasSelection] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [exporting, setExporting] = useState(false)
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
      const a = document.createElement('a')
      a.href = url
      a.download = 'design.dst'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      alert('Export failed — is the backend running?\n\nStart it with:\ncd backend && python main.py')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-gray-100 overflow-hidden select-none">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-10 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <span className="font-semibold text-sm text-violet-400 tracking-wide">ThreadLogic</span>

        <div className="w-px h-4 bg-zinc-700" />

        {/* Zoom controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => canvasRef.current?.resetView()}
            title="Reset view"
            className="px-1.5 py-0.5 text-xs font-mono text-gray-400 hover:text-gray-200 hover:bg-zinc-800 rounded transition-colors min-w-[52px] text-center"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => canvasRef.current?.resetView()} title="Fit to view" className="p-1 text-gray-500 hover:text-gray-300 hover:bg-zinc-800 rounded transition-colors">
            <Maximize2 size={13} />
          </button>
        </div>

        <div className="w-px h-4 bg-zinc-700" />

        {/* Hint */}
        <span className="text-xs text-zinc-500 hidden sm:block">
          {HINTS[activeTool] ?? ''}
          {activeTool === 'select' ? 'Scroll to zoom · Alt+drag or Space+drag to pan' : ''}
        </span>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
        >
          <Download size={13} />
          {exporting ? 'Exporting…' : 'Export .dst'}
        </button>
      </header>

      <div className="flex flex-1 min-h-0">
        <Toolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onDelete={() => canvasRef.current?.deleteSelected()}
        />

        <main className="flex-1 overflow-hidden">
          <EmbroideryCanvas
            ref={canvasRef}
            activeTool={activeTool}
            stitchProps={stitchProps}
            onSelectionChange={handleSelectionChange}
            onZoomChange={setZoom}
          />
        </main>

        <PropertiesPanel
          stitchProps={stitchProps}
          onChange={handleStitchChange}
          hasSelection={hasSelection}
        />
      </div>
    </div>
  )
}
