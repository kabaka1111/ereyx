import type { Tool } from '../types/shape'

/** Описание одного инструмента: что показываем в панели и какая клавиша его включает. */
export interface ToolDefinition {
  id: Tool
  label: string
  description: string
  /** Буква на клавиатуре в нижнем регистре. */
  key: string
}

/**
 * Список инструментов.
 * За хоткеи отвечает поле `key`: поменяли букву здесь — меняемся во всём проекте.
 */
export const TOOLS: readonly ToolDefinition[] = [
  { id: 'select', label: 'Выбор', description: 'Выбирать и перемещать фигуры', key: 'v' },
  { id: 'rectangle', label: 'Прямоугольник', description: 'Рисовать прямоугольник', key: 'r' },
  { id: 'ellipse', label: 'Эллипс', description: 'Рисовать эллипс', key: 'o' },
] as const

/**
 * Управляющие клавиши, не привязанные к инструментам, — как в Figma:
 * Ctrl+Z отменяет, Ctrl+Shift+Z повторяет, Delete удаляет, Escape снимает выделение.
 */
export const HOTKEYS = {
  undo: 'z',
  /** Повтор — та же клавиша, что и отмена, но с Shift. */
  redo: 'z',
  delete: 'delete',
  backspace: 'backspace',
  escape: 'escape',
} as const

/** Инструмент, с которым открывается редактор. */
export const DEFAULT_TOOL: Tool = 'select'

/** Соответствие клавиша → инструмент. Выведено из TOOLS, чтобы не дублировать. */
export const TOOL_BY_SHORTCUT: Readonly<Record<string, Tool>> = Object.fromEntries(
  TOOLS.map((tool) => [tool.key, tool.id]),
)

/** Человекочитаемое имя инструмента, например для подсказок. */
export function toolLabel(tool: Tool): string {
  return TOOLS.find((definition) => definition.id === tool)?.label ?? tool
}
