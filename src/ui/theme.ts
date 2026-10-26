/** Colour theme: follow the system setting, or force light or dark (SPEC §13.1). */
export type Theme = 'system' | 'light' | 'dark'

/**
 * Apply a theme to the page. Forcing sets data-theme on <html>, which index.css reads; 'system'
 * removes it so prefers-color-scheme decides. index.html applies the saved choice before the
 * first paint, so this only matters when the choice changes.
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}
