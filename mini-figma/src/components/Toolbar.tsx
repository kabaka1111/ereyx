import { TOOLS } from '../constants/tools'
import type { Tool } from '../types/shape'

interface ToolbarProps {
  activeTool: Tool
  onSelectTool: (tool: Tool) => void
}

/** Иконки инструментов: простые SVG, чтобы не тянуть библиотеку. */
function ToolIcon({ tool }: { tool: Tool }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 18 18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (tool === 'rectangle') {
    return (
      <svg {...common}>
        <rect x="3" y="4" width="12" height="10" rx="1" />
      </svg>
    )
  }

  if (tool === 'ellipse') {
    return (
      <svg {...common}>
        <ellipse cx="9" cy="9" rx="6" ry="5" />
      </svg>
    )
  }

  // select — курсор
  return (
    <svg {...common}>
      <path d="M5 3l9 6-4 1-1.5 4z" />
    </svg>
  )
}

/**
 * Панель инструментов слева.
 *
 * Список инструментов и клавиши приходят из constants/tools —
 * здесь нет ни одного зашитого названия.
 */
export default function Toolbar({ activeTool, onSelectTool }: ToolbarProps) {
  return (
    <aside className="z-10 flex w-14 shrink-0 flex-col items-center gap-1 border-r border-neutral-200 bg-white py-3">
      {TOOLS.map((definition) => {
        const isActive = definition.id === activeTool

        return (
          <button
            key={definition.id}
            type="button"
            title={`${definition.description} (${definition.key.toUpperCase()})`}
            aria-label={definition.description}
            aria-pressed={isActive}
            onClick={() => onSelectTool(definition.id)}
            className={`relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
              isActive
                ? 'bg-blue-50 text-blue-600'
                : 'text-neutral-600 hover:bg-neutral-100'
            }`}
          >
            <ToolIcon tool={definition.id} />
            <span className="absolute right-1 bottom-0.5 text-[9px] leading-none text-neutral-400">
              {definition.key.toUpperCase()}
            </span>
          </button>
        )
      })}
    </aside>
  )
}
