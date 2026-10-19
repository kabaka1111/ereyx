import { useCallback, useMemo, useRef, useState } from 'react'
import { DEFAULT_SHAPE_FILL, DEFAULT_SHAPE_STROKE, MIN_SHAPE_SIZE } from '../constants/shapes'
import type { Point, Shape, ShapeDraft, ShapeType } from '../types/shape'
import { pointDelta, rectFromPoints, translatePoint } from '../utils/geometry'

/**
 * Состояние фигур: список, добавление, изменение, выделение,
 * перетаскивание и создание фигуры перетаскиванием мыши.
 *
 * Данные живут здесь, а не в компонентах: панели слоёв и свойств
 * и холст читают один и тот же источник.
 *
 * Здесь же — история изменений для Ctrl+Z / Ctrl+Shift+Z: список фигур
 * хранится вместе со стеками «снимков до» (past) и «снимков после» (future),
 * поэтому отмена и повтор — это просто переходы между снимками.
 * Выделение лежит в том же состоянии, чтобы отмена сразу чистила
 * выделение исчезнувшей фигуры — без побочных эффектов после рендера.
 */

export type { ShapeDraft }

/**
 * Сколько снимков храним. Ограничиваем, чтобы при долгой сессии
 * история не росла бесконечно.
 */
const HISTORY_LIMIT = 50

/** Список фигур, история и выделение — одно атомарное состояние редактора. */
interface EditorState {
  shapes: Shape[]
  /** Состояния «до» последних изменений: конец массива — самое свежее. */
  past: readonly (readonly Shape[])[]
  /** Отменённые состояния: начало массива — самое свежее (ближайший повтор). */
  future: readonly (readonly Shape[])[]
  selectedId: string | null
}

const INITIAL_STATE: EditorState = { shapes: [], past: [], future: [], selectedId: null }

/** Рисование в процессе: тип фигуры и две точки — начало и текущую позицию мыши. */
interface DrawingState {
  type: ShapeType
  start: Point
  end: Point
}

/**
 * Перетаскивание в процессе: какую фигуру тянем, точка захвата в координатах
 * канваса и положение фигуры в момент захвата. Новое положение = origin + дельта
 * от start до текущей мыши, поэтому фигура не «дёргается» при любом зуме.
 */
interface DraggingState {
  id: string
  start: Point
  origin: Point
}

interface UseShapesResult {
  shapes: readonly Shape[]
  selectedId: string | null
  /** Выбранная фигура или null — удобно для панели свойств. */
  selectedShape: Shape | null
  addShape: (draft: ShapeDraft) => Shape
  updateShape: (id: string, patch: Partial<ShapeDraft>) => void
  removeShape: (id: string) => void
  selectShape: (id: string | null) => void
  /**
   * Черновик текущего рисования для превью на канвасе.
   * null — перетаскивание не идёт.
   */
  draftShape: ShapeDraft | null
  /** Начало перетаскивания: точка в координатах канваса. */
  startDrawing: (type: ShapeType, start: Point) => void
  /** Двигаем мышь: обновляем конечную точку черновика. */
  updateDrawing: (end: Point) => void
  /** Отпустили мышь: если фигура достаточно большая — создаём её. */
  finishDrawing: (end: Point) => void
  /** Отмена рисования (Escape, потеря указателя): черновик просто выбрасываем. */
  cancelDrawing: () => void
  /** Идёт перетаскивание фигуры мышью. */
  isDragging: boolean
  /** Захват фигуры мышью: выделяем её и запоминаем точку захвата и исходное положение. */
  startDragging: (id: string, start: Point) => void
  /** Двигаем мышь: переносим фигуру ровно на дельту от точки захвата. */
  updateDragging: (point: Point) => void
  /** Отпустили мышь: перетаскивание завершено, новое положение уже применено. */
  finishDragging: () => void
  /** Отмена (Escape, потеря указателя): возвращаем фигуру на исходное место. */
  cancelDragging: () => void
  /** Ctrl+Z: вернуть предыдущий снимок истории. */
  undo: () => void
  /** Ctrl+Shift+Z: вернуть снимок, отменённый undo. */
  redo: () => void
  /** Есть ли что отменять — например, чтобы гасить кнопку «Отменить». */
  canUndo: boolean
  /** Есть ли что повторять. */
  canRedo: boolean
}

export function useShapes(): UseShapesResult {
  // Список фигур и история — одно состояние: снимок делается атомарно с изменением.
  const [state, setState] = useState<EditorState>(INITIAL_STATE)
  const [drawing, setDrawing] = useState<DrawingState | null>(null)
  const [dragging, setDragging] = useState<DraggingState | null>(null)
  // Записали ли мы снимок истории за текущее перетаскивание:
  // снимок делаем один раз — на первом движении, а не на каждый кадр мыши.
  const dragRecordedRef = useRef(false)

  const { shapes, selectedId } = state

  const addShape = useCallback((draft: ShapeDraft): Shape => {
    const shape: Shape = { ...draft, id: crypto.randomUUID() }

    setState((current) => ({
      shapes: [...current.shapes, shape],
      past: [...current.past, current.shapes].slice(-HISTORY_LIMIT),
      future: [],
      // addShape выделяет новую фигуру — панель свойств сразу показывает её.
      selectedId: shape.id,
    }))

    return shape
  }, [])

  const updateShape = useCallback((id: string, patch: Partial<ShapeDraft>) => {
    setState((current) => ({
      shapes: current.shapes.map((shape) =>
        shape.id === id ? { ...shape, ...patch } : shape,
      ),
      // Свойства часто меняют сериями (числа, цвет) — история ограничена HISTORY_LIMIT,
      // поэтому запись каждого шага безопасна и позволяет откатить любой из них.
      past: [...current.past, current.shapes].slice(-HISTORY_LIMIT),
      future: [],
      selectedId: current.selectedId,
    }))
  }, [])

  const removeShape = useCallback((id: string) => {
    setState((current) => ({
      shapes: current.shapes.filter((shape) => shape.id !== id),
      past: [...current.past, current.shapes].slice(-HISTORY_LIMIT),
      future: [],
      // Убирали выделение с удалённой фигуры, чтобы панель свойств не показывала «призрак».
      selectedId: current.selectedId === id ? null : current.selectedId,
    }))
  }, [])

  const selectShape = useCallback((id: string | null) => {
    setState((current) => ({ ...current, selectedId: id }))
  }, [])

  const startDrawing = useCallback((type: ShapeType, start: Point) => {
    setDrawing({ type, start, end: start })
  }, [])

  const updateDrawing = useCallback((end: Point) => {
    setDrawing((current) => (current ? { ...current, end } : current))
  }, [])

  const cancelDrawing = useCallback(() => {
    setDrawing(null)
  }, [])

  const startDragging = useCallback(
    (id: string, start: Point) => {
      const shape = shapes.find((current) => current.id === id)
      if (!shape) {
        return
      }

      // Захват сразу выделяет фигуру: тянуть можно и ранее невыделенную.
      // Снимок истории сделаем только если фигура действительно сдвинется —
      // простой клик по уже выбранной не должен плодить записи в истории.
      dragRecordedRef.current = false
      setState((current) => ({
        ...current,
        selectedId: id,
      }))
      setDragging({ id, start, origin: { x: shape.x, y: shape.y } })
    },
    [shapes],
  )

  const updateDragging = useCallback(
    (point: Point) => {
      if (!dragging) {
        return
      }

      const position = translatePoint(dragging.origin, pointDelta(dragging.start, point))
      // Первое движение запоминает положение «до» перетаскивания;
      // остальные кадры мыши только двигают фигуру, без новых снимков.
      const isFirstMove = !dragRecordedRef.current
      dragRecordedRef.current = true

      setState((current) => {
        const shapes = current.shapes.map((shape) =>
          shape.id === dragging.id ? { ...shape, ...position } : shape,
        )

        if (isFirstMove) {
          return {
            shapes,
            past: [...current.past, current.shapes].slice(-HISTORY_LIMIT),
            future: [],
            selectedId: current.selectedId,
          }
        }

        return { ...current, shapes }
      })
    },
    [dragging],
  )

  const finishDragging = useCallback(() => {
    setDragging(null)
  }, [])

  const cancelDragging = useCallback(() => {
    if (!dragging) {
      return
    }

    const { id, origin } = dragging
    const wasRecorded = dragRecordedRef.current
    dragRecordedRef.current = false
    setDragging(null)

    setState((current) => {
      const shapes = current.shapes.map((shape) =>
        shape.id === id ? { ...shape, x: origin.x, y: origin.y } : shape,
      )

      if (!wasRecorded) {
        // Снимок не делали — просто возвращаем фигуру на место.
        return { ...current, shapes }
      }

      // Снимок делали, но отмена вернула фигуру ровно в него же —
      // снимок бессмысленен, убираем, чтобы не засорять Ctrl+Z.
      return { ...current, shapes, past: current.past.slice(0, -1) }
    })
  }, [dragging])

  const finishDrawing = useCallback(
    (end: Point) => {
      if (!drawing) {
        return
      }

      setDrawing(null)

      const rect = rectFromPoints(drawing.start, end)
      // Слишком маленький «мазок» = случайный клик, фигуру не создаём.
      if (rect.width < MIN_SHAPE_SIZE || rect.height < MIN_SHAPE_SIZE) {
        return
      }

      const draft: ShapeDraft = {
        type: drawing.type,
        ...rect,
        fill: DEFAULT_SHAPE_FILL,
        stroke: DEFAULT_SHAPE_STROKE,
      }
      // addShape сам выделяет новую фигуру.
      addShape(draft)
    },
    [drawing, addShape],
  )

  const undo = useCallback(() => {
    // Отмена посреди жеста бессмысленна: сначала завершаем его.
    setDrawing(null)
    setDragging(null)
    dragRecordedRef.current = false

    setState((current) => {
      const previous = current.past[current.past.length - 1]
      if (!previous) {
        return current
      }

      return {
        shapes: [...previous],
        past: current.past.slice(0, -1),
        future: [current.shapes, ...current.future],
        // Выделение не должно переживать свою фигуру: если её нет
        // в восстановленном снимке — снимаем выделение.
        selectedId: previous.some((shape) => shape.id === current.selectedId)
          ? current.selectedId
          : null,
      }
    })
  }, [])

  const redo = useCallback(() => {
    setDrawing(null)
    setDragging(null)
    dragRecordedRef.current = false

    setState((current) => {
      const [next, ...rest] = current.future
      if (!next) {
        return current
      }

      return {
        shapes: [...next],
        past: [...current.past, current.shapes].slice(-HISTORY_LIMIT),
        future: rest,
        selectedId: next.some((shape) => shape.id === current.selectedId)
          ? current.selectedId
          : null,
      }
    })
  }, [])

  /** Превью черновика: та же модель, что и у настоящей фигуры, только без id. */
  const draftShape = useMemo<ShapeDraft | null>(() => {
    if (!drawing) {
      return null
    }

    return {
      type: drawing.type,
      ...rectFromPoints(drawing.start, drawing.end),
      fill: DEFAULT_SHAPE_FILL,
      stroke: DEFAULT_SHAPE_STROKE,
    }
  }, [drawing])

  const selectedShape = useMemo(
    () => shapes.find((shape) => shape.id === selectedId) ?? null,
    [shapes, selectedId],
  )

  return {
    shapes,
    selectedId,
    selectedShape,
    addShape,
    updateShape,
    removeShape,
    selectShape,
    draftShape,
    startDrawing,
    updateDrawing,
    finishDrawing,
    cancelDrawing,
    isDragging: dragging !== null,
    startDragging,
    updateDragging,
    finishDragging,
    cancelDragging,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  }
}
