import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../constants/viewport'
import type { Point, Shape, Viewport } from '../types/shape'

/**
 * Чистая математика холста: пересчёт координат при зуме и панорамировании.
 *
 * Без этих функций фигуры «уезжают» относительно курсора: экранные координаты
 * мыши и координаты канваса — разные системы, между ними нужно переводить.
 */

/**
 * Переводит экранные координаты (клика, курсора) в координаты канваса.
 *
 * Экранная точка = точка канваса, умноженная на зум, плюс сдвиг камеры:
 *   screen = canvas * zoom + pan
 * Обратное преобразование:
 *   canvas = (screen - pan) / zoom
 */
export function screenToCanvas(screen: Point, viewport: Viewport): Point {
  return {
    x: (screen.x - viewport.pan.x) / viewport.zoom,
    y: (screen.y - viewport.pan.y) / viewport.zoom,
  }
}

/** Переводит координаты канваса обратно в экранные. */
export function canvasToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.zoom + viewport.pan.x,
    y: point.y * viewport.zoom + viewport.pan.y,
  }
}

/**
 * Прямоугольник по двум точкам — началу и текущей позиции мыши.
 *
 * Перетаскивание может идти в любую сторону, поэтому координаты
 * нормализуем: левый верхний угол — минимальные x/y, размеры — модуль разницы.
 */
export function rectFromPoints(start: Point, end: Point): Omit<Shape, 'id' | 'type' | 'fill' | 'stroke'> {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/**
 * Попадание точки в фигуру — чистая математика для выделения кликом.
 *
 * Прямоугольник: точка внутри его границ. Эллипс: нормируем точку
 * к центру и проверяем единичный круг — (dx / rx)² + (dy / ry)² ≤ 1.
 */
export function isPointInShape(point: Point, shape: Shape): boolean {
  const insideBox =
    point.x >= shape.x &&
    point.x <= shape.x + shape.width &&
    point.y >= shape.y &&
    point.y <= shape.y + shape.height

  if (shape.type === 'rectangle') {
    return insideBox
  }

  const radiusX = shape.width / 2
  const radiusY = shape.height / 2
  if (radiusX === 0 || radiusY === 0) {
    return false
  }

  const normalizedX = (point.x - (shape.x + radiusX)) / radiusX
  const normalizedY = (point.y - (shape.y + radiusY)) / radiusY

  return normalizedX * normalizedX + normalizedY * normalizedY <= 1
}

/**
 * Верхняя фигура под точкой или null.
 *
 * Ищем с конца списка: последняя нарисованная фигура лежит поверх остальных,
 * поэтому именно её выделяет клик вналожении друг на друга.
 */
export function findShapeAt(point: Point, shapes: readonly Shape[]): Shape | null {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    const shape = shapes[index]

    if (isPointInShape(point, shape)) {
      return shape
    }
  }

  return null
}

/**
 * Смещение от точки захвата к текущей позиции мыши.
 * Дельта одинакова для любой фигуры: перетаскивание = старт + дельта.
 */
export function pointDelta(from: Point, to: Point): Point {
  return { x: to.x - from.x, y: to.y - from.y }
}

/** Точка, сдвинутая на дельту — новое положение фигуры при перетаскивании. */
export function translatePoint(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y }
}

/** Ограничивает зум диапазоном 10% … 400%. */
export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

/**
 * Новая камера при зуме колесом.
 *
 * Точка канваса под курсором должна остаться под курсором, иначе холст
 * «уплывает» от мыши. Поэтому сначала запоминаем точку под курсором,
 * потом пересчитываем сдвиг так, чтобы она осталась на месте.
 */
export function zoomAt(screenPoint: Point, viewport: Viewport, factor: number): Viewport {
  const zoom = clampZoom(viewport.zoom * factor)
  const anchor = screenToCanvas(screenPoint, viewport)

  return {
    zoom,
    pan: {
      x: screenPoint.x - anchor.x * zoom,
      y: screenPoint.y - anchor.y * zoom,
    },
  }
}

/** Зум «на шаг» внутрь или наружу — для клавиш +/-. */
export function zoomStep(viewport: Viewport, direction: 1 | -1): Viewport {
  return zoomAt({ x: 0, y: 0 }, viewport, direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
}

/** Человекочитаемый процент зума: 1 → «100%», 0.5 → «50%». */
export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}
