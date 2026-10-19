import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Shape from './Shape'
import { GRID_SIZE } from '../constants/viewport'
import { findShapeAt, formatZoom, screenToCanvas } from '../utils/geometry'
import { useViewport } from '../hooks/useViewport'
import type { Point, Shape as ShapeModel, ShapeDraft, ShapeType, Tool } from '../types/shape'

interface CanvasProps {
  shapes: readonly ShapeModel[]
  tool: Tool
  selectedId: string | null
  /** Идёт перетаскивание выбранной фигуры — чтобы двигать её, а не рисовать. */
  isDragging: boolean
  /** Черновик текущего рисования — рисуем как обычную фигуру, но не сохраняем. */
  draftShape: ShapeDraft | null
  onDrawStart: (type: ShapeType, point: Point) => void
  onDrawMove: (point: Point) => void
  onDrawEnd: (point: Point) => void
  onDrawCancel: () => void
  /** Клик по пустому месту холста: снимаем выделение (id = null). */
  onSelectShape: (id: string | null) => void
  /** Захват фигуры для перетаскивания: её id и точка канваса под курсором. */
  onDragStart: (id: string, start: Point) => void
  /** Двигаем мышь: переносим захваченную фигуру. */
  onDragMove: (point: Point) => void
  /** Отпустили мышь над холстом: перетаскивание завершено. */
  onDragEnd: () => void
  /** Потеря указателя во время перетаскивания: возвращаем фигуру на место. */
  onDragCancel: () => void
}

/**
 * Холст на весь рабочий экран: сетка на фоне, обработка мыши.
 *
 * Вся камера (пробел + перетаскивание, зум колесом) — в useViewport;
 * здесь только ref на контейнер, раскладка обработчиков и отрисовка фигур.
 *
 * Рисование живёт в useShapes: сюда приходят только колбэки, а перевод
 * экранных координат мыши в координаты канваса делает geometry.screenToCanvas,
 * поэтому фигуры создаются «под курсором» при любом зуме и панораме.
 */
export default function Canvas({
  shapes,
  tool,
  selectedId,
  isDragging,
  draftShape,
  onDrawStart,
  onDrawMove,
  onDrawEnd,
  onDrawCancel,
  onSelectShape,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { viewport, isSpacePressed, isPanning, handlers } = useViewport(containerRef)

  const { pan, zoom } = viewport

  /** Экранные координаты события → координаты канваса (с учётом камеры). */
  const toCanvasPoint = (event: ReactPointerEvent<HTMLElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()

    return screenToCanvas(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      viewport,
    )
  }

  // Рисование инструментами «прямоугольник» и «эллипс» левой кнопкой мыши,
  // но не мешаем панораме пробелом и средней кнопкой.
  // Инструмент «Выбор»: клик по фигуре выделяет её и захватывает для
  // перетаскивания, клик по пустому месту снимает выделение.
  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    handlers.onPointerDown(event)

    if (isSpacePressed || isPanning || event.button !== 0) {
      return
    }

    if (tool === 'rectangle' || tool === 'ellipse') {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      onDrawStart(tool, toCanvasPoint(event))
      return
    }

    if (tool !== 'select') {
      return
    }

    // Тест попадания — чистая геометрия из utils/geometry:
    // при наложении фигур клик попадает в верхнюю (последнюю) из них.
    const point = toCanvasPoint(event)
    const hit = findShapeAt(point, shapes)

    if (!hit) {
      onSelectShape(null)
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    onDragStart(hit.id, point)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    handlers.onPointerMove(event)

    if (draftShape) {
      onDrawMove(toCanvasPoint(event))
      return
    }

    if (isDragging) {
      onDragMove(toCanvasPoint(event))
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    handlers.onPointerUp(event)

    if (!draftShape && !isDragging) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (draftShape) {
      onDrawEnd(toCanvasPoint(event))
    } else {
      onDragEnd()
    }
  }

  // Потеря указателя (например, вылет за пределы окна):
  // черновик выбрасываем, перетаскивание откатываем.
  const handlePointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    handlers.onPointerUp(event)
    onDrawCancel()
    onDragCancel()
  }

  // Сетка живёт в системе координат канваса: двигаем и масштабируем её
  // теми же pan/zoom, что и фигуры, иначе фон «расходится» с контентом.
  const gridSize = GRID_SIZE * zoom
  const gridStyle = {
    backgroundImage: 'radial-gradient(circle, #d4d4d4 1px, transparent 1px)',
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: `${pan.x}px ${pan.y}px`,
  }

  const cursor =
    isPanning || isDragging
      ? 'cursor-grabbing'
      : isSpacePressed
        ? 'cursor-grab'
        : tool === 'select'
          ? 'cursor-default'
          : 'cursor-crosshair'

  return (
    <div
      ref={containerRef}
      className={`relative h-full w-full overflow-hidden bg-neutral-50 ${cursor}`}
      style={gridStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Фигуры рисуем одним SVG: камера холста = translate + scale, поэтому
          всё внутри <g> масштабируется вместе с канвасом. pointer-events:none,
          чтобы мышь всегда попадала в контейнер, а не в отдельные фигуры. */}
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: 'none' }}>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {shapes.map((shape) => (
            <Shape
              key={shape.id}
              shape={shape}
              isSelected={shape.id === selectedId}
              zoom={zoom}
            />
          ))}
          {/* Превью рисуемой фигуры — та же модель и тот же <g>, что и у настоящих. */}
          {draftShape && <Shape key="draft" shape={{ ...draftShape, id: 'draft' }} />}
        </g>
      </svg>

      {/* Индикатор зума — чтобы было видно, что колесо работает. */}
      <div className="absolute bottom-3 left-3 rounded-md border border-neutral-200 bg-white/90 px-2 py-1 text-xs font-medium text-neutral-500 tabular-nums">
        {formatZoom(zoom)}
      </div>

      {/* Подсказка для новичка. */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-neutral-200 bg-white/90 px-3 py-1 text-xs text-neutral-400">
        V — выбор: клик выделяет фигуру, перетаскивание двигает; R / O — рисование, пробел + перетаскивание — панорама, колесо — зум; Ctrl+Z / Ctrl+Shift+Z — отмена / повтор
      </div>
    </div>
  )
}
