/**
 * Единый язык проекта.
 *
 * Здесь описаны сущности, которые понимают все остальные слои:
 * типы фигур, инструменты и координаты. TypeScript по этим описаниям
 * ловит ошибки до запуска приложения, а все файлы говорят об одних
 * и тех же сущностях одинаково.
 */

/** Геометрия, которую умеет рисовать редактор. */
export type ShapeType = 'rectangle' | 'ellipse'

/** Инструменты панели инструментов. */
export type Tool = 'select' | ShapeType

/**
 * Точка. Система координат зависит от контекста:
 * у мыши это экранные пиксели, у фигур — координаты канваса.
 */
export interface Point {
  x: number
  y: number
}

/** Камера холста: сдвиг (панорамирование) и зум, где 1 — это 100%. */
export interface Viewport {
  pan: Point
  zoom: number
}

/** Модель фигуры на канвасе. */
export interface Shape {
  id: string
  type: ShapeType
  /** Левый верхний угол фигуры в координатах канваса. */
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke: string
}

/**
 * Всё, что нужно описать фигуру, чтобы её создать, — всё, кроме id.
 * Хук useShapes принимает на вход именно черновик и сам проставляет id.
 */
export type ShapeDraft = Omit<Shape, 'id'>
