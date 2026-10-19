/**
 * Мелкие DOM-помощники.
 *
 * Нужны нескольким хукам сразу (useViewport и useHotkeys), поэтому живут
 * отдельно, а не дублируются: панорама пробелом и горячие клавиши не должны
 * срабатывать, пока пользователь печатает в поле ввода.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}
