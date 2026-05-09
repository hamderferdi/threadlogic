import { useState, useRef } from 'react'
import {
  Undo2, Redo2, Upload, Download,
  Pencil, Eye, Sliders, Play,
  Folder, Star, BarChart2, Settings, Layers, ZoomIn, ZoomOut, Grid3x3,
} from 'lucide-react'
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

const modes = ['Hobbyist', 'Business', 'Industrial'] as const
type Mode = typeof modes[number]

const modeStyle: Record<Mode, React.CSSProperties> = {
  Hobbyist:   { background: 'var(--accent-light)', color: 'var(--accent-text)', borderColor: 'rgba(45,90,61,.2)' },
  Business:   { background: 'var(--amber-light)',  color: 'var(--amber)',       borderColor: 'rgba(196,123,26,.2)' },
  Industrial: { background: '#fce8e7',             color: 'var(--red)',         borderColor: 'rgba(176,58,46,.2)' },
}

const NAV_ITEMS = [
  { label: 'Design',   icon: <Pencil size={15} />,   group: 'Workspace' },
  { label: 'Import',   icon: <Upload size={15} />,    group: null },
  { label: 'Preview',  icon: <Eye size={15} />,       group: null },
  { label: 'Simulate', icon: <Play size={15} />,      group: null },
  { label: 'My designs', icon: <Folder size={15} />, group: 'Library' },
  { label: 'Presets',  icon: <Star size={15} />,      group: null },
]

const ADV_NAV = [
  { label: 'Stitch report',    icon: <BarChart2 size={15} /> },
  { label: 'Machine profiles', icon: <Settings size={15} /> },
]

export default function App() {
  const [activeTool, setActiveTool]   = useState<Tool>('select')
  const [stitchProps, setStitchProps] = useState<StitchProperties>(DEFAULT_STITCH_PROPS)
  const [hasSelection, setHasSelection] = useState(false)
  const [zoom, setZoom]               = useState(1)
  const [exporting, setExporting]     = useState(false)
  const [objects, setObjects]         = useState<CanvasObjectInfo[]>([])
  const [projectName, setProjectName] = useState('untitled.dst')
  const [toast, setToast]             = useState<{ msg: string; type: 'ok' | 'warn' | 'err' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [mode, setMode]               = useState<Mode>('Hobbyist')
  const [activeNav, setActiveNav]     = useState('Design')
  const [gridOn, setGridOn]           = useState(false)
  const canvasRef = useRef<EmbroideryCanvasHandle>(null)

  const showToast = (msg: string, type: 'ok' | 'warn' | 'err' = 'ok') => {
    setToast({ msg, type })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }

  const cycleMode = () => {
    const i = (modes.indexOf(mode) + 1) % modes.length
    setMode(modes[i])
  }

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
      showToast('Add some shapes to the canvas first.', 'warn')
      return
    }
    setExporting(true)
    try {
      const res = await fetch(`${BACKEND}/export/dst`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) {
        showToast(json.error ?? 'Export failed.', 'err')
        return
      }

      // Decode base64 DST and trigger download
      const bytes = Uint8Array.from(atob(json.dst_b64), c => c.charCodeAt(0))
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: projectName.endsWith('.dst') ? projectName : `${projectName}.dst`,
      })
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)

      // Show stats / warnings
      const s = json.stats
      const hasWarnings = json.warnings?.length > 0
      const statsMsg = `Exported — ${s.stitches.toLocaleString()} stitches · ${s.jumps} jump${s.jumps !== 1 ? 's' : ''} · ~${s.est_minutes} min`
      showToast(statsMsg, hasWarnings ? 'warn' : 'ok')

      // Log warnings to console for now
      if (hasWarnings) {
        console.warn('Export warnings:', json.warnings)
      }
    } catch {
      showToast('Export failed — is the backend running? (python3 main.py)', 'err')
    } finally {
      setExporting(false)
    }
  }

  const showAdv = mode !== 'Hobbyist'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg)', color: 'var(--text)' }}>

      {/* ── Topbar ── */}
      <header style={{
        height: 'var(--topbar-h)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        background: 'var(--surface)',
        borderBottom: '.5px solid var(--border-mid)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        {/* Logo */}
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 18, letterSpacing: '-.02em' }}>
          Thread<em style={{ fontStyle: 'italic', fontWeight: 300, color: 'var(--accent)' }}>Logic</em>
        </span>

        {/* Mode badge */}
        <button
          onClick={cycleMode}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            padding: '2px 8px',
            borderRadius: 99,
            border: '.5px solid',
            cursor: 'pointer',
            userSelect: 'none',
            transition: 'all .15s',
            ...modeStyle[mode],
          }}
        >
          {mode}
        </button>

        {/* Filename */}
        <input
          value={projectName}
          onChange={e => setProjectName(e.target.value)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 12,
            color: 'var(--text-muted)',
            background: 'transparent',
            border: '1px solid transparent',
            borderRadius: 'var(--radius)',
            padding: '2px 6px',
            outline: 'none',
          }}
          onFocus={e => (e.currentTarget.style.borderColor = 'var(--border-mid)')}
          onBlur={e => (e.currentTarget.style.borderColor = 'transparent')}
        />

        <div style={{ flex: 1 }} />

        {/* Undo / Redo */}
        {[<Undo2 size={15} />, <Redo2 size={15} />].map((icon, i) => (
          <button key={i} style={iconBtnStyle} title={i === 0 ? 'Undo' : 'Redo'}>
            {icon}
          </button>
        ))}

        {/* Import */}
        <button style={tbBtnStyle}>
          <Upload size={14} /> Import
        </button>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={exporting}
          style={{ ...tbBtnStyle, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }}
        >
          <Download size={14} />
          {exporting ? 'Exporting…' : 'Export'}
        </button>
      </header>

      {/* ── Workspace ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'var(--sidebar-w) 1fr var(--params-w)', gridTemplateRows: '1fr', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Sidebar */}
        <aside style={{ background: 'var(--surface)', borderRight: '.5px solid var(--border)', display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '8px 0' }}>
          {NAV_ITEMS.map((item, i) => {
            const prevGroup = i > 0 ? NAV_ITEMS[i - 1].group : null
            const showGroupLabel = item.group && item.group !== prevGroup
            const showDivider = showGroupLabel && i > 0
            return (
              <div key={item.label}>
                {showDivider && <div style={{ height: .5, background: 'var(--border)', margin: '8px 14px' }} />}
                {showGroupLabel && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', padding: '10px 14px 4px' }}>
                    {item.group}
                  </div>
                )}
                <div
                  onClick={() => setActiveNav(item.label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 14px',
                    fontSize: 13,
                    color: activeNav === item.label ? 'var(--accent-text)' : 'var(--text-muted)',
                    background: activeNav === item.label ? 'var(--accent-light)' : 'transparent',
                    borderRight: activeNav === item.label ? '2px solid var(--accent)' : '2px solid transparent',
                    fontWeight: activeNav === item.label ? 500 : 400,
                    cursor: 'pointer',
                    transition: 'all .1s',
                    userSelect: 'none',
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              </div>
            )
          })}

          {showAdv && (
            <>
              <div style={{ height: .5, background: 'var(--border)', margin: '8px 14px' }} />
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-faint)', padding: '10px 14px 4px' }}>Advanced</div>
              {ADV_NAV.map(item => (
                <div
                  key={item.label}
                  onClick={() => setActiveNav(item.label)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 9,
                    padding: '7px 14px',
                    fontSize: 13,
                    color: activeNav === item.label ? 'var(--accent-text)' : 'var(--text-muted)',
                    background: activeNav === item.label ? 'var(--accent-light)' : 'transparent',
                    borderRight: activeNav === item.label ? '2px solid var(--accent)' : '2px solid transparent',
                    cursor: 'pointer',
                    transition: 'all .1s',
                  }}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              ))}
            </>
          )}
        </aside>

        {/* Canvas area */}
        <main style={{ background: 'var(--bg)', position: 'relative', overflow: 'hidden' }}>

          {/* Floating toolbar */}
          <Toolbar activeTool={activeTool} onToolChange={setActiveTool} onDelete={() => canvasRef.current?.deleteSelected()} />

          {/* Left side buttons */}
          <div style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 4, zIndex: 5 }}>
            {[
              { icon: <Grid3x3 size={14} />, label: 'Grid', action: () => setGridOn(g => !g), active: gridOn },
              { icon: <Sliders size={14} />, label: 'Rulers', action: () => {}, active: false },
              { icon: <Layers size={14} />,  label: 'Layers', action: () => {}, active: false },
            ].map(btn => (
              <button key={btn.label} title={btn.label} onClick={btn.action} style={{
                width: 30, height: 30,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: btn.active ? 'var(--accent-light)' : 'var(--surface)',
                border: '.5px solid var(--border-mid)',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                color: btn.active ? 'var(--accent-text)' : 'var(--text-muted)',
                transition: 'all .1s',
                padding: 0,
              }}>
                {btn.icon}
              </button>
            ))}
          </div>

          {/* Canvas — fills the entire main grid cell */}
          <EmbroideryCanvas
            ref={canvasRef}
            activeTool={activeTool}
            stitchProps={stitchProps}
            onSelectionChange={handleSelectionChange}
            onObjectsChange={setObjects}
            onZoomChange={setZoom}
          />

          {/* Toast notification */}
          {toast && (
            <div style={{
              position: 'absolute',
              top: 14,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 30,
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              padding: '7px 16px',
              borderRadius: 99,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              background: toast.type === 'err' ? 'var(--red)' : toast.type === 'warn' ? 'var(--amber)' : 'var(--accent)',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,.15)',
            }}>
              {toast.msg}
            </div>
          )}

          {/* Zoom controls */}
          <div style={{ position: 'absolute', bottom: 14, right: 14, display: 'flex', alignItems: 'center', gap: 6, zIndex: 5 }}>
            <div style={{ display: 'flex', background: 'var(--surface)', border: '.5px solid var(--border-mid)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
              <button onClick={() => canvasRef.current?.resetView()} style={{ ...zoomBtnStyle }}>
                <ZoomOut size={13} />
              </button>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', padding: '0 8px', display: 'flex', alignItems: 'center', borderLeft: '.5px solid var(--border)', borderRight: '.5px solid var(--border)' }}>
                {Math.round(zoom * 100)}%
              </div>
              <button style={{ ...zoomBtnStyle }}>
                <ZoomIn size={13} />
              </button>
            </div>
          </div>
        </main>

        {/* Params panel */}
        <RightPanel
          objects={objects}
          hasSelection={hasSelection}
          stitchProps={stitchProps}
          onStitchChange={handleStitchChange}
          onSelectObject={id => canvasRef.current?.selectObjectById(id)}
          onToggleVisibility={id => canvasRef.current?.toggleObjectVisibility(id)}
        />
      </div>
    </div>
  )
}

const iconBtnStyle: React.CSSProperties = {
  width: 32, height: 32,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: '.5px solid var(--border-mid)',
  borderRadius: 'var(--radius)',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  transition: 'all .12s',
  padding: 0,
}

const tbBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5,
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  color: 'var(--text)',
  background: 'transparent',
  border: '.5px solid var(--border-mid)',
  borderRadius: 'var(--radius)',
  padding: '5px 11px',
  cursor: 'pointer',
  transition: 'all .12s',
  whiteSpace: 'nowrap',
}

const zoomBtnStyle: React.CSSProperties = {
  width: 28, height: 28,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  color: 'var(--text-muted)',
  border: 'none',
  background: 'transparent',
  transition: 'background .1s',
  padding: 0,
}
