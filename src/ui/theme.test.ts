/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Read from disk: Vitest turns CSS imports (even ?raw) into empty strings
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf-8')

/** The declarations inside the first rule whose selector is exactly `selector`, one per line. */
function declarations(selector: string): string[] {
  const start = css.indexOf(`${selector} {`)
  expect(start).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('/*'))
}

describe('themes', () => {
  // CSS can't share one rule between a media query and an attribute selector, so the dark tokens
  // appear twice: once for the system setting and once for the in-app switch
  it('defines dark mode the same way for the system setting and the switch', () => {
    const system = declarations(":root:where(:not([data-theme='light']))")
    const forced = declarations(":root[data-theme='dark']")
    expect(system.length).toBeGreaterThan(20)
    expect(forced).toEqual(system)
  })

  it('gives every light token a dark value, and no extra ones', () => {
    const colours = (lines: string[]) =>
      lines
        .filter((l) => l.startsWith('--') && !/^--(radius|control-height|font-|status-critical)/.test(l))
        .map((l) => l.slice(0, l.indexOf(':')))
        .sort()
    // The light block also holds sizes and fonts, which don't change with the theme
    expect(colours(declarations(":root[data-theme='dark']"))).toEqual(colours(declarations(':root')))
  })
})
