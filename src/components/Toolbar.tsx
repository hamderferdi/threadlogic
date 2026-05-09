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
  [{ tool: 'select',   icon: <MousePointer2 size={15} />, label: 'Select',    shortcut: 'V' }],
  [
    { tool: 'rect',     icon: <Square size={15} />,        label: 'Rectangle', shortcut: 'R' },
    { tool: 'circle',   icon: <Circle size={15} />,        label: 'Ellipse',   shortcut: 'E' },
    { tool: 'triangle', icon: <Triangle size={15} />,      label: 'Triangle',  shortcut: 'G' },
    { tool: 'star',     icon: <Star size={15} />,          label: 'Star',      shortcut: 'S' },
  ],
  [
    { tool: 'freehand', icon: <PenLine size={15} />,       label: 'Freehand',  shortcut: 'F' },
    { tool: 'path',     icon: <Spline size={15} />,        label: 'Polygon',   shortcut: 'P' },
    { tool: 'text',     icon: <Type size={15} />,          label: 'Text',      shortcut: 'T' },
  ],
]

export default function Toolbar({ activeTool, onToolChange, onDelete }: Props) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 14,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        background: 'var(--surface)',
        border: '.5px solid var(--border-mid)',
        borderRadius: 'var(--radius-lg)',
        padding: 4,
        zIndex: 5,
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {gi > 0 && (
            <div style={{ width: .5, height: 20, background: 'var(--border-mid)', margin: '0 2px' }} />
          )}
          {group.map(({ tool, icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => onToolChange(tool)}
              title={`${label} (${shortcut})`}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 7,
                cursor: 'pointer',
                border: 'none',
                padding: 0,
                background: activeTool === tool ? 'var(--accent)' : 'transparent',
                color: activeTool === tool ? '#fff' : 'var(--text-muted)',
                transition: 'all .1s',
              }}
              onMouseEnter={e => {
                if (activeTool !== tool) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface2)'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'
                }
              }}
              onMouseLeave={e => {
                if (activeTool !== tool) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
                }
              }}
            >
              {icon}
            </button>
          ))}
        </div>
      ))}

      <div style={{ width: .5, height: 20, background: 'var(--border-mid)', margin: '0 2px' }} />
      <button
        onClick={onDelete}
        title="Delete selected (Del)"
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          cursor: 'pointer',
          border: 'none',
          padding: 0,
          background: 'transparent',
          color: 'var(--text-muted)',
          transition: 'all .1s',
        }}
        onMouseEnter={e => {
          ;(e.currentTarget as HTMLButtonElement).style.background = '#fce8e7'
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--red)'
        }}
        onMouseLeave={e => {
          ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
          ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
        }}
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}
