import type { Shape, ShapeDraft } from '../types/shape'

interface PropertiesPanelProps {
  shape: Shape | null
  /** Обновляет фигуру по id — updateShape из useShapes. */
  onChange: (id: string, patch: Partial<ShapeDraft>) => void
}

/** Поле свойства: подпись + значение (пока только для чтения). */
function Field({ label, value }: { label: string; value: number }) {
  return (
    <label className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1.5">
      <span className="w-4 shrink-0 text-xs font-medium text-neutral-400">{label}</span>
      <span className="w-full truncate text-right text-xs text-neutral-700 tabular-nums">
        {Math.round(value)}
      </span>
    </label>
  )
}

/**
 * Панель свойств справа.
 *
 * Геометрия X/Y/W/H пока для чтения; цвет заливки редактируется —
 * он сразу применяется к выбранной фигуре через updateShape из useShapes.
 */
export default function PropertiesPanel({ shape, onChange }: PropertiesPanelProps) {
  return (
    <section className="flex shrink-0 flex-col gap-3 border-t border-neutral-200 p-3">
      <h2 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">
        Свойства
      </h2>

      {!shape ? (
        <p className="text-xs leading-relaxed text-neutral-400">
          Ничего не выбрано.
          <br />
          Выберите фигуру, чтобы увидеть её свойства.
        </p>
      ) : (
        <>
          <p className="text-xs font-medium text-neutral-600 capitalize">
            {shape.type === 'rectangle' ? 'Прямоугольник' : 'Эллипс'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="X" value={shape.x} />
            <Field label="Y" value={shape.y} />
            <Field label="W" value={shape.width} />
            <Field label="H" value={shape.height} />
          </div>
          <label className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Заливка</span>
            <input
              type="color"
              value={shape.fill}
              onChange={(event) => onChange(shape.id, { fill: event.target.value })}
              aria-label="Цвет заливки"
              className="h-6 w-10 shrink-0 cursor-pointer rounded border border-neutral-200 bg-white p-0.5"
            />
            <span className="text-xs text-neutral-500">{shape.fill}</span>
          </label>
        </>
      )}
    </section>
  )
}
