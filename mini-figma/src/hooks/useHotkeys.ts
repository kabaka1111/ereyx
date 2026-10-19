import { useEffect, useRef } from 'react'
import { HOTKEYS, TOOL_BY_SHORTCUT } from '../constants/tools'
import type { Tool } from '../types/shape'
import { isTypingTarget } from '../utils/dom'

/**
 * Горячие клавиши как в Figma:
 *
 * - V / R / O — переключение инструментов (список клавиш — в constants/tools);
 * - Escape — снять выделение и прервать текущий жест;
 * - Delete / Backspace — удалить выбранную фигуру;
 * - Ctrl+Z — отмена, Ctrl+Shift+Z — повтор (Cmd на macOS вместо Ctrl).
 *
 * Хук только слушает клавиатуру и разбирает события: что делать при каждой
 * клавише, решают колбэки из App, а сами данные и история живут в useShapes.
 */

export interface HotkeyHandlers {
  onSelectTool: (tool: Tool) => void
  /** Снять выделение и прервать текущий жест (Escape). */
  onDeselect: () => void
  /** Удалить выбранную фигуру (Delete / Backspace). */
  onDeleteSelected: () => void
  /** Отменить последнее изменение (Ctrl+Z). */
  onUndo: () => void
  /** Повторить отменённое (Ctrl+Shift+Z). */
  onRedo: () => void
}

export function useHotkeys(handlers: HotkeyHandlers): void {
  // Храним колбэки в ref, чтобы не переподписывать клавиатуру на каждый рендер.
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Не перехватываем клавиши при вводе текста.
      if (isTypingTarget(event.target)) {
        return
      }

      const key = event.key.toLowerCase()
      // Cmd на macOS и Ctrl на Windows/Linux для отмены — одно и то же.
      const isModified = event.ctrlKey || event.metaKey

      if (isModified && !event.altKey) {
        if (key === HOTKEYS.undo) {
          event.preventDefault()
          // Повтор — та же клавиша + Shift.
          if (event.shiftKey) {
            handlersRef.current.onRedo()
          } else {
            handlersRef.current.onUndo()
          }
        }
        return
      }

      // Прочие модификаторы (Alt+letter и т.п.) оставляем браузеру.
      if (event.altKey) {
        return
      }

      const tool = TOOL_BY_SHORTCUT[key]
      if (tool) {
        event.preventDefault()
        handlersRef.current.onSelectTool(tool)
        return
      }

      if (key === HOTKEYS.escape) {
        handlersRef.current.onDeselect()
        return
      }

      if (key === HOTKEYS.delete || key === HOTKEYS.backspace) {
        event.preventDefault()
        handlersRef.current.onDeleteSelected()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
