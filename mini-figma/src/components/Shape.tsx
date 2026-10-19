import { SELECTION_COLOR, SELECTION_HANDLE_SIZE } from '../constants/shapes'
import type { Shape as ShapeModel } from '../types/shape'

interface ShapeProps {
  shape: ShapeModel
  isSelected?: boolean
  /**
   * Текущий зум камеры: маркеры выделения рисуем постоянного экранного
   * размера, поэтому в координатах канваса их сторона = размер / zoom.
   */
  zoom?: number
}

/** Отступ рамки выделения от края фигуры в координатах канваса. */
const SELECTION_PADDING = 2

/**
 * Восемь маркеров выделения — как в Figma: по квадрату в каждом углу
 * и в середине каждой стороны рамки.
 */
function handlePoints(left: number, top: number, right: number, bottom: number) {
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2

  return [
    { x: left, y: top },
    { x: centerX, y: top },
    { x: right, y: top },
    { x: left, y: centerY },
    { x: right, y: centerY },
    { x: left, y: bottom },
    { x: centerX, y: bottom },
    { x: right, y: bottom },
  ]
}

/**
 * Рендер одной фигуры на канвасе.
 *
 * Геометрия — rect/ellipse; выделение — синяя рамка с восемью маркерами
 * вокруг фигуры. Маркеры пока только показывают границы выделения,
 * ресайз за них добавим на следующем шаге.
 */
export default function Shape({ shape, isSelected = false, zoom = 1 }: ShapeProps) {
  const { type, x, y, width, height, fill, stroke } = shape

  // Сторона одного маркера в координатах канваса: на экране всегда 8px при любом зуме.
  const handleSize = SELECTION_HANDLE_SIZE / zoom

  // Рамка выделения рисуем снаружи фигуры, а толщину не скалируем,
  // чтобы линия оставалась одинаковой при любом зуме.
  const selection = (
    <g pointerEvents="none">
      <rect
        x={x - SELECTION_PADDING}
        y={y - SELECTION_PADDING}
        width={width + SELECTION_PADDING * 2}
        height={height + SELECTION_PADDING * 2}
        fill="none"
        stroke={SELECTION_COLOR}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {handlePoints(
        x - SELECTION_PADDING,
        y - SELECTION_PADDING,
        x + width + SELECTION_PADDING,
        y + height + SELECTION_PADDING,
      ).map((point, index) => (
        <rect
          key={index}
          x={point.x - handleSize / 2}
          y={point.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="#ffffff"
          stroke={SELECTION_COLOR}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  )

  if (type === 'rectangle') {
    return (
      <>
        <rect x={x} y={y} width={width} height={height} fill={fill} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {isSelected && selection}
      </>
    )
  }

  // ellipse
  return (
    <>
      <ellipse
        cx={x + width / 2}
        cy={y + height / 2}
        rx={width / 2}
        ry={height / 2}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {isSelected && selection}
    </>
  )
}
