import { useState } from 'react'
import { Eye, EyeOff, Square, Circle, Triangle, PenLine, Type, Spline } from 'lucide-react'
import type { CanvasObjectInfo, StitchProperties, StitchType } from '../types/embroidery'

interface Props {
  objects: CanvasObjectInfo[]
  hasSelection: boolean
  stitchProps: StitchProperties
  onStitchChange: (p: StitchProperties) => void
  onSelectObject: (id: string) => void
  onToggleVisibility: (id: string) => void
}

type Tab = 'shapes' | 'properties'

const TYPE_ICONS: Record<string, React.ReactNode> = {
  rect:      <Square size={12} />,
  circle:    <Circle size={12} />,
  triangle:  <Triangle size={12} />,
  path:      <Spline size={12} />,
  'i-text':  <Type size={12} />,
  freehand:  <PenLine size={12} />,
}

const STITCH_TYPES: { type: StitchType; label: string; desc: string }[] = [
  { type: 'running', label: 'Running', desc: 'Outline' },
  { type: 'satin',   label: 'Satin',   desc: 'Columns' },
  { type: 'fill',    label: 'Fill',    desc: 'Dense area' },
]

export default function RightPanel({
  objects, hasSelection, stitchProps, onStitchChange, onSelectObject, onToggleVisibility,
}: Props) {
  const [tab, setTab] = useState<Tab>('shapes')
  const set = (patch: Partial<StitchProperties>) => onStitchChange({ ...stitchProps, ...patch })

  return (
    <aside
      style={{ background: 'var(--panel)', borderLeft: '1px solid var(--border)' }}
      className="w-56 flex flex-col shrink-0 overflow-hidden"
    >
      {/* Tab bar */}
      <div style={{ borderBottom: '1px solid var(--border)' }} className="flex shrink-0">
        {(['shapes', 'properties'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              color: tab === t ? 'var(--text)' : 'var(--text-dim)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              background: 'transparent',
            }}
            className="flex-1 py-2 text-xs font-medium capitalize tracking-wide transition-colors hover:text-white"
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Shapes tab ──────────────────────────────────────────────────── */}
      {tab === 'shapes' && (
        <div className="flex-1 overflow-y-auto py-1">
          {objects.length === 0 ? (
            <p style={{ color: 'var(--text-dim)' }} className="text-xs text-center p-4 leading-relaxed">
              Draw shapes on the canvas
            </p>
          ) : (
            objects.map(obj => (
              <div
                key={obj.id}
                onClick={() => onSelectObject(obj.id)}
                style={{
                  background: obj.selected ? 'var(--panel-hover)' : 'transparent',
                  borderLeft: obj.selected ? '2px solid var(--accent)' : '2px solid transparent',
                  color: 'var(--text)',
                  opacity: obj.visible ? 1 : 0.4,
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-white/5 transition-colors"
              >
                {/* Color swatch */}
                <span
                  style={{ background: obj.color, flexShrink: 0 }}
                  className="w-3 h-3 rounded-sm"
                />
                {/* Type icon */}
                <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>
                  {TYPE_ICONS[obj.type] ?? <Square size={12} />}
                </span>
                {/* Name */}
                <span className="text-xs truncate flex-1">{obj.name}</span>
                {/* Visibility */}
                <button
                  onClick={e => { e.stopPropagation(); onToggleVisibility(obj.id) }}
                  style={{ color: 'var(--text-dim)' }}
                  className="shrink-0 hover:text-white transition-colors p-0.5"
                >
                  {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Properties tab ───────────────────────────────────────────────── */}
      {tab === 'properties' && (
        <div className="flex-1 overflow-y-auto">
          {!hasSelection ? (
            <p style={{ color: 'var(--text-dim)' }} className="text-xs text-center p-4 leading-relaxed">
              Select a shape to edit its stitch properties
            </p>
          ) : (
            <div className="flex flex-col gap-5 p-3">

              {/* Stitch type */}
              <section>
                <label style={{ color: 'var(--text-dim)' }} className="text-xs uppercase tracking-widest mb-2 block font-medium">
                  Stitch Type
                </label>
                <div className="flex flex-col gap-1">
                  {STITCH_TYPES.map(({ type, label, desc }) => (
                    <button
                      key={type}
                      onClick={() => set({ stitchType: type })}
                      style={{
                        background: stitchProps.stitchType === type ? 'var(--accent-dim)' : 'transparent',
                        border: `1px solid ${stitchProps.stitchType === type ? 'var(--accent)' : 'var(--border)'}`,
                        color: stitchProps.stitchType === type ? '#fff' : 'var(--text)',
                      }}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-xs transition-all"
                    >
                      <span className="font-medium w-12">{label}</span>
                      <span style={{ color: stitchProps.stitchType === type ? 'rgba(255,255,255,0.6)' : 'var(--text-dim)' }}>
                        {desc}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Angle */}
              {stitchProps.stitchType !== 'running' && (
                <section>
                  <label style={{ color: 'var(--text-dim)' }} className="text-xs uppercase tracking-widest mb-1 flex justify-between font-medium">
                    <span>Angle</span>
                    <span style={{ color: 'var(--text)' }} className="font-mono">{stitchProps.angle}°</span>
                  </label>
                  <input type="range" min={0} max={180} value={stitchProps.angle}
                    onChange={e => set({ angle: +e.target.value })}
                    style={{ accentColor: 'var(--accent)' }} className="w-full" />
                </section>
              )}

              {/* Density */}
              <section>
                <label style={{ color: 'var(--text-dim)' }} className="text-xs uppercase tracking-widest mb-1 flex justify-between font-medium">
                  <span>Density</span>
                  <span style={{ color: 'var(--text)' }} className="font-mono">{stitchProps.density}</span>
                </label>
                <input type="range" min={3} max={20} value={stitchProps.density}
                  onChange={e => set({ density: +e.target.value })}
                  style={{ accentColor: 'var(--accent)' }} className="w-full" />
                <div style={{ color: 'var(--text-dim)' }} className="flex justify-between text-xs mt-0.5">
                  <span>Dense</span><span>Loose</span>
                </div>
              </section>

              {/* Color */}
              <section>
                <label style={{ color: 'var(--text-dim)' }} className="text-xs uppercase tracking-widest mb-2 block font-medium">
                  Thread Color
                </label>
                <div className="flex items-center gap-2.5">
                  <input type="color" value={stitchProps.color}
                    onChange={e => set({ color: e.target.value })}
                    className="w-8 h-8 rounded-md cursor-pointer" />
                  <span style={{ color: 'var(--text)' }} className="text-xs font-mono">{stitchProps.color.toUpperCase()}</span>
                </div>
              </section>

            </div>
          )}
        </div>
      )}
    </aside>
  )
}
