const NON_TEXT_INPUTS = ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file']

/** True when keys typed at `target` are text entry, so app shortcuts must not react. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.includes(target.type)
}

/** True when Space would activate the focused control (buttons, checkboxes). */
export function isActivatable(target: EventTarget | null): boolean {
  if (target instanceof HTMLButtonElement) return true
  return target instanceof HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)
}
