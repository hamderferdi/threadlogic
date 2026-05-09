import type { StitchProperties, StitchType } from '../types/embroidery'

interface Props {
  stitchProps: StitchProperties
  onChange: (props: StitchProperties) => void
  hasSelection: boolean
}

const STITCH_TYPES: { type: StitchType; label: string; desc: string }[] = [
  { type: 'running', label: 'Running', desc: 'Outline path' },
  { type: 'satin',   label: 'Satin',   desc: 'Smooth columns' },
  { type: 'fill',    label: 'Fill',    desc: 'Dense area fill' },
]

export default function PropertiesPanel({ stitchProps, onChange, hasSelection }: Props) {
  const set = (patch: Partial<StitchProperties>) => onChange({ ...stitchProps, ...patch })

  return (
    <aside className="w-56 flex flex-col bg-gray-900 border-l border-gray-800 shrink-0 overflow-y-auto">
      <div className="px-3 py-2 border-b border-gray-800">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Properties</h2>
      </div>

      {!hasSelection ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-gray-600 text-center leading-relaxed">
            Select a shape to edit its stitch properties
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-3">
          {/* Stitch type */}
          <section>
            <label className="text-xs text-gray-500 uppercase tracking-widest mb-2 block">Stitch Type</label>
            <div className="flex flex-col gap-1">
              {STITCH_TYPES.map(({ type, label, desc }) => (
                <button
                  key={type}
                  onClick={() => set({ stitchType: type })}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-colors ${
                    stitchProps.stitchType === type
                      ? 'bg-violet-700 text-white'
                      : 'text-gray-300 hover:bg-gray-800'
                  }`}
                >
                  <span className="w-12 font-medium">{label}</span>
                  <span className={stitchProps.stitchType === type ? 'text-violet-300' : 'text-gray-500'}>{desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Angle — not shown for running stitch */}
          {stitchProps.stitchType !== 'running' && (
            <section>
              <label className="text-xs text-gray-500 uppercase tracking-widest mb-1 flex justify-between">
                <span>Angle</span>
                <span className="text-gray-300 font-mono">{stitchProps.angle}°</span>
              </label>
              <input
                type="range"
                min={0}
                max={180}
                value={stitchProps.angle}
                onChange={e => set({ angle: Number(e.target.value) })}
                className="w-full accent-violet-500"
              />
            </section>
          )}

          {/* Density */}
          <section>
            <label className="text-xs text-gray-500 uppercase tracking-widest mb-1 flex justify-between">
              <span>Density</span>
              <span className="text-gray-300 font-mono">{stitchProps.density}</span>
            </label>
            <input
              type="range"
              min={3}
              max={20}
              value={stitchProps.density}
              onChange={e => set({ density: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-gray-600 mt-0.5">
              <span>Dense</span>
              <span>Loose</span>
            </div>
          </section>

          {/* Thread color */}
          <section>
            <label className="text-xs text-gray-500 uppercase tracking-widest mb-2 block">Thread Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={stitchProps.color}
                onChange={e => set({ color: e.target.value })}
                className="w-9 h-9 rounded cursor-pointer"
              />
              <span className="text-xs text-gray-300 font-mono">{stitchProps.color.toUpperCase()}</span>
            </div>
          </section>
        </div>
      )}
    </aside>
  )
}
