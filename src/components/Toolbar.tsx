import {
  MousePointer2, Square, Circle, Triangle, Star,
  PenLine, Spline, Type, Trash2,
} from 'lucide-react'
import type { Tool } from '../types/embroidery'

interface Props {
  activeTool: Tool
  onToolChange: (tool: Tool) => void
  onDelete: () => void
}

const GROUPS: { tool: Tool; icon: React.ReactNode; label: string; shortcut: string }[][] = [
  [{ tool: 'select',   icon: <MousePointer2 size={16} />, label: 'Select',    shortcut: 'V' }],
  [
    { tool: 'rect',     icon: <Square size={16} />,        label: 'Rectangle', shortcut: 'R' },
    { tool: 'circle',   icon: <Circle size={16} />,        label: 'Ellipse',   shortcut: 'E' },
    { tool: 'triangle', icon: <Triangle size={16} />,      label: 'Triangle',  shortcut: 'G' },
    { tool: 'star',     icon: <Star size={16} />,          label: 'Star',      shortcut: 'S' },
  ],
  [
    { tool: 'freehand', icon: <PenLine size={16} />,       label: 'Freehand',  shortcut: 'F' },
    { tool: 'path',     icon: <Spline size={16} />,        label: 'Polygon',   shortcut: 'P' },
    { tool: 'text',     icon: <Type size={16} />,          label: 'Text',      shortcut: 'T' },
  ],
]

export default function Toolbar({ activeTool, onToolChange, onDelete }: Props) {
  return (
    <div
      style={{
        background: 'var(--panel-dark)',
        borderTop: '1px solid var(--border)',
      }}
      className="flex items-center justify-center gap-1 h-12 shrink-0 px-3"
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-1">
          {gi > 0 && (
            <div style={{ background: 'var(--border)' }} className="w-px h-5 mx-1" />
          )}
          {group.map(({ tool, icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => onToolChange(tool)}
              title={`${label} (${shortcut})`}
              style={{
                background: activeTool === tool ? 'var(--accent-dim)' : 'transparent',
                border: `1px solid ${activeTool === tool ? 'var(--accent)' : 'transparent'}`,
                color: activeTool === tool ? '#fff' : 'var(--text-dim)',
              }}
              className="w-8 h-8 flex items-center justify-center rounded transition-all hover:text-white hover:bg-white/10"
            >
              {icon}
            </button>
          ))}
        </div>
      ))}

      {/* Separator + Delete */}
      <div style={{ background: 'var(--border)' }} className="w-px h-5 mx-2" />
      <button
        onClick={onDelete}
        title="Delete selected (Del)"
        style={{ color: 'var(--text-dim)', border: '1px solid transparent' }}
        className="w-8 h-8 flex items-center justify-center rounded transition-all hover:text-red-400 hover:bg-red-950/50 hover:border-red-900"
      >
        <Trash2 size={16} />
      </button>
    </div>
  )
}
