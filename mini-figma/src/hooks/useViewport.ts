import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { ZOOM_STEP } from '../constants/viewport'
import type { Point, Viewport } from '../types/shape'
import { zoomAt } from '../utils/geometry'
import { isTypingTarget } from '../utils/dom'

/**
 * Камера холста: панорамирование при зажатом пробеле, зум колесом
 * от 10% до 400% и центрирование начала координат при старте.
 *
 * Хук владеет всей логикой «камеры»; компоненту достаточно передать ref
 * на контейнер холста и разложить возвращённые обработчики на элементе.
 */

/** Состояние камеры в экранных координатах: панорама и зум (1 = 100%). */
const INITIAL_VIEWPORT: Viewport = { pan: { x: 0, y: 0 }, zoom: 1 }

interface UseViewportResult {
  viewport: Viewport
  /** Пробел сейчас зажат — можно панорамировать. */
  isSpacePressed: boolean
  /** Идёт перетаскивание холста. */
  isPanning: boolean
  /** Обработчики: раскладываются на контейнере холста. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  }
}

export function useViewport(containerRef: RefObject<HTMLElement | null>): UseViewportResult {
  const [viewport, setViewport] = useState<Viewport>(INITIAL_VIEWPORT)
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isPanning, setIsPanning] = useState(false)

  /** Последняя позиция курсора при перетаскивании — чтобы считать дельту. */
  const lastPointerRef = useRef<Point | null>(null)

  /** Ставит начало координат канваса в центр экрана. */
  const centerOrigin = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const rect = container.getBoundingClientRect()
    setViewport({
      pan: { x: rect.width / 2, y: rect.height / 2 },
      zoom: 1,
    })
  }, [containerRef])

  useLayoutEffect(() => {
    centerOrigin()
  }, [centerOrigin])

  // Пробел: зажали — режим панорамы. preventDefault, чтобы страница не скроллилась
  // и кнопка под фокусом не «кликнулась» пробелом.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) {
        return
      }

      event.preventDefault()
      setIsSpacePressed(true)
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setIsSpacePressed(false)
      }
    }

    // Потеря фокуса окна «отпускает» пробел, иначе панорама залипает.
    const handleBlur = () => setIsSpacePressed(false)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  // Зум колесом — вокруг точки под курсором.
  // Слушатель вешаем вручную: React делает wheel-события пассивными
  // и preventDefault внутри onWheel не сработает.
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()

      const rect = container.getBoundingClientRect()
      const cursor: Point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP

      setViewport((current) => zoomAt(cursor, current, factor))
    }

    container.addEventListener('wheel', handleWheel, { passive: false })

    return () => container.removeEventListener('wheel', handleWheel)
  }, [containerRef])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    // Панорамируем пробелом или средней кнопкой мыши.
    const wantsPan = isSpacePressed || event.button === 1
    if (!wantsPan || isPanning) {
      return
    }

    event.preventDefault()
    lastPointerRef.current = { x: event.clientX, y: event.clientY }
    setIsPanning(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const lastPointer = lastPointerRef.current
    if (!isPanning || !lastPointer) {
      return
    }

    const delta: Point = {
      x: event.clientX - lastPointer.x,
      y: event.clientY - lastPointer.y,
    }
    lastPointerRef.current = { x: event.clientX, y: event.clientY }

    setViewport((current) => ({
      ...current,
      pan: {
        x: current.pan.x + delta.x,
        y: current.pan.y + delta.y,
      },
    }))
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!isPanning) {
      return
    }

    lastPointerRef.current = null
    setIsPanning(false)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return {
    viewport,
    isSpacePressed,
    isPanning,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  }
}
