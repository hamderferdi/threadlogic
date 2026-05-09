import { useState } from 'react'
import { Eye, EyeOff, Square, Circle, Triangle, PenLine, Type, Spline, Plus, Star } from 'lucide-react'
import type { CanvasObjectInfo, StitchProperties, StitchType } from '../types/embroidery'

interface Props {
  objects: CanvasObjectInfo[]
  hasSelection: boolean
  stitchProps: StitchProperties
  onStitchChange: (p: StitchProperties) => void
  onSelectObject: (id: string) => void
  onToggleVisibility: (id: string) => void
}

type Tab = 'simple' | 'full'

const TYPE_ICONS: Record<string, React.ReactNode> = {
  rect:      <Square size={12} />,
  circle:    <Circle size={12} />,
  triangle:  <Triangle size={12} />,
  star:      <Star size={12} />,
  path:      <Spline size={12} />,
  'i-text':  <Type size={12} />,
  freehand:  <PenLine size={12} />,
}

const STITCH_TYPES: { type: StitchType; label: string }[] = [
  { type: 'fill',    label: 'Fill' },
  { type: 'satin',   label: 'Satin' },
  { type: 'running', label: 'Running' },
]

const label = (text: string, value: string) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{text}</span>
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, color: 'var(--text)' }}>{value}</span>
  </div>
)

export default function RightPanel({
  objects, hasSelection, stitchProps, onStitchChange, onSelectObject, onToggleVisibility,
}: Props) {
  const [tab, setTab] = useState<Tab>('simple')
  const set = (patch: Partial<StitchProperties>) => onStitchChange({ ...stitchProps, ...patch })

  return (
    <aside style={{
      width: 'var(--params-w)',
      background: 'var(--surface)',
      borderLeft: '.5px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      <div style={{ padding: 14, flex: 1, overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 500 }}>Parameters</span>
          <div style={{ display: 'flex', background: 'var(--surface2)', borderRadius: 6, padding: 2, gap: 1 }}>
            {(['simple', 'full'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 5,
                  cursor: 'pointer',
                  border: 'none',
                  background: tab === t ? 'var(--surface)' : 'transparent',
                  color: tab === t ? 'var(--text)' : 'var(--text-muted)',
                  boxShadow: tab === t ? '0 .5px 2px rgba(0,0,0,.1)' : 'none',
                  transition: 'all .12s',
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Stitch type chips */}
        <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '.5px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>
            Stitch type
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {STITCH_TYPES.map(({ type, label: lbl }) => (
              <button
                key={type}
                onClick={() => set({ stitchType: type })}
                style={{
                  fontSize: 12,
                  padding: '4px 10px',
                  borderRadius: 99,
                  border: '.5px solid var(--border-mid)',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  transition: 'all .12s',
                  background: stitchProps.stitchType === type ? 'var(--accent)' : 'transparent',
                  color: stitchProps.stitchType === type ? '#fff' : 'var(--text-muted)',
                  borderColor: stitchProps.stitchType === type ? 'var(--accent)' : 'var(--border-mid)',
                }}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Fill / angle settings */}
        {(stitchProps.stitchType === 'fill' || stitchProps.stitchType === 'satin') && (
          <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '.5px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>
              {stitchProps.stitchType === 'fill' ? 'Fill settings' : 'Satin settings'}
            </div>
            <div style={{ marginBottom: 11 }}>
              {label('Density', `${stitchProps.density} st/mm`)}
              <input type="range" min={1} max={20} value={stitchProps.density} step={1}
                onChange={e => set({ density: +e.target.value })} />
            </div>
            <div>
              {label('Angle', `${stitchProps.angle}°`)}
              <input type="range" min={0} max={180} value={stitchProps.angle} step={1}
                onChange={e => set({ angle: +e.target.value })} />
            </div>
          </div>
        )}

        {/* Thread color */}
        <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '.5px solid var(--border)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>
            Thread color
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 'var(--radius)', cursor: 'pointer', margin: '0 -6px' }}>
            <input
              type="color"
              value={stitchProps.color}
              onChange={e => set({ color: e.target.value })}
              style={{ width: 18, height: 18, borderRadius: 4, border: '.5px solid rgba(0,0,0,.12)', flexShrink: 0, cursor: 'pointer', padding: 0 }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: 'var(--text)' }}>Custom</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-faint)' }}>{stitchProps.color.toUpperCase()}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-faint)', cursor: 'pointer', border: '.5px dashed var(--border-mid)', borderRadius: 'var(--radius)', padding: '6px 10px', marginTop: 4, transition: 'all .12s' }}>
            <Plus size={13} /> Add color
          </div>
        </div>

        {/* Shapes list */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>
            Layers
          </div>
          {objects.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.5 }}>Draw shapes on the canvas</p>
          ) : (
            objects.map(obj => (
              <div
                key={obj.id}
                onClick={() => onSelectObject(obj.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '5px 6px',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  margin: '0 -6px',
                  background: obj.selected ? 'var(--accent-light)' : 'transparent',
                  opacity: obj.visible ? 1 : 0.4,
                  transition: 'background .1s',
                }}
              >
                <span style={{ width: 14, height: 14, borderRadius: 3, background: obj.color, border: '.5px solid rgba(0,0,0,.12)', flexShrink: 0 }} />
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{TYPE_ICONS[obj.type] ?? <Square size={12} />}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.name}</span>
                <button
                  onClick={e => { e.stopPropagation(); onToggleVisibility(obj.id) }}
                  style={{ color: 'var(--text-faint)', background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
                >
                  {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Advanced (full tab only) */}
        {tab === 'full' && (
          <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: '.5px solid var(--border)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 500, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 10 }}>
              Advanced
            </div>
            <div style={{ marginBottom: 11 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 5 }}>Underlay</div>
              <select style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-body)', padding: '6px 26px 6px 8px', border: '.5px solid var(--border-mid)', borderRadius: 'var(--radius)', background: 'var(--surface)', color: 'var(--text)', outline: 'none', cursor: 'pointer', appearance: 'none' }}>
                <option>Zigzag</option><option>Edge walk</option><option>Center run</option><option>None</option>
              </select>
            </div>
            <div style={{ marginBottom: 11 }}>
              {label('Pull compensation', '0.3 mm')}
              <input type="range" min={0} max={10} defaultValue={3} step={1} />
            </div>
          </div>
        )}

      </div>
    </aside>
  )
}
