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
  [
    { tool: 'select',   icon: <MousePointer2 size={18} />, label: 'Select',    shortcut: 'V' },
  ],
  [
    { tool: 'rect',     icon: <Square size={18} />,        label: 'Rectangle', shortcut: 'R' },
    { tool: 'circle',   icon: <Circle size={18} />,        label: 'Ellipse',   shortcut: 'E' },
    { tool: 'triangle', icon: <Triangle size={18} />,      label: 'Triangle',  shortcut: 'G' },
    { tool: 'star',     icon: <Star size={18} />,          label: 'Star',      shortcut: 'S' },
  ],
  [
    { tool: 'freehand', icon: <PenLine size={18} />,       label: 'Freehand',  shortcut: 'F' },
    { tool: 'path',     icon: <Spline size={18} />,        label: 'Polygon',   shortcut: 'P' },
  ],
  [
    { tool: 'text',     icon: <Type size={18} />,          label: 'Text',      shortcut: 'T' },
  ],
]

export default function Toolbar({ activeTool, onToolChange, onDelete }: Props) {
  return (
    <aside className="w-12 flex flex-col items-center gap-1 py-2 bg-gray-900 border-r border-gray-800 shrink-0">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex flex-col items-center gap-1 w-full px-1.5">
          {gi > 0 && <div className="w-6 border-t border-gray-700 my-0.5" />}
          {group.map(({ tool, icon, label, shortcut }) => (
            <button
              key={tool}
              onClick={() => onToolChange(tool)}
              title={`${label} (${shortcut})`}
              className={`w-9 h-9 flex items-center justify-center rounded transition-colors ${
                activeTool === tool
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              {icon}
            </button>
          ))}
        </div>
      ))}

      <div className="mt-auto mb-1 px-1.5 w-full">
        <div className="w-6 border-t border-gray-700 mx-auto mb-1" />
        <button
          onClick={onDelete}
          title="Delete selected (Del)"
          className="w-9 h-9 flex items-center justify-center rounded text-gray-500 hover:bg-red-950 hover:text-red-400 transition-colors"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </aside>
  )
}
