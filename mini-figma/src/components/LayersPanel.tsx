import type { Shape } from '../types/shape'

interface LayersPanelProps {
  shapes: readonly Shape[]
  selectedId: string | null
  onSelectShape: (id: string | null) => void
}

/**
 * Панель слоёв справа.
 *
 * Список фигур сверху вниз — как Figma: верхний слой рисуется поверх
 * остальных и показывается первым. Клик по строке выделяет фигуру на канвасе,
 * повторный клик по уже выделенному слою снимает выделение.
 */
export default function LayersPanel({ shapes, selectedId, onSelectShape }: LayersPanelProps) {
  // Показываем в обратном порядке: последняя фигура = верхний слой.
  const ordered = [...shapes].reverse()

  return (
    <section className="flex min-h-0 flex-1 flex-col p-3">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        Слои
      </h2>

      {ordered.length === 0 ? (
        <p className="text-xs leading-relaxed text-neutral-400">
          Пока пусто. Выберите инструмент «Прямоугольник» (R) или «Эллипс» (O)
          и нарисуйте фигуру — она появится здесь.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {ordered.map((shape) => {
            const isSelected = shape.id === selectedId

            return (
              <li key={shape.id}>
                <button
                  type="button"
                  onClick={() => onSelectShape(isSelected ? null : shape.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-neutral-600 hover:bg-neutral-100'
                  }`}
                >
                  {/* Миниатюра слоя: тот же тип фигуры, что на канвасе. */}
                  <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
                    {shape.type === 'rectangle' ? (
                      <rect x="2" y="3" width="10" height="8" rx="1" fill="currentColor" opacity="0.4" />
                    ) : (
                      <ellipse cx="7" cy="7" rx="5" ry="4" fill="currentColor" opacity="0.4" />
                    )}
                  </svg>
                  <span className="truncate capitalize">
                    {shape.type === 'rectangle' ? 'Прямоугольник' : 'Эллипс'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
