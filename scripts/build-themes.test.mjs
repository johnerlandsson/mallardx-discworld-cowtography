import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseThemeToml, renderModule } from './build-themes.mjs'
import mapThemes from '../ui/data/map-themes.js'

const SAMPLE = `name = "Sample Light"
base = "light"

[colors]
bg              = "#fafafa"
bg_elevated     = "#ffffff"
fg_muted        = "#666666"

[ansi]
black           = "#000000"
bright_white    = "#ffffff"
`

describe('parseThemeToml', () => {
  it('reads name and base', () => {
    const t = parseThemeToml(SAMPLE)
    expect(t.name).toBe('Sample Light')
    expect(t.base).toBe('light')
  })

  it('projects colors to CSS vars the way Mallard does (underscores → dashes)', () => {
    const { vars } = parseThemeToml(SAMPLE)
    expect(vars['--bg']).toBe('#fafafa')
    expect(vars['--bg-elevated']).toBe('#ffffff')
    expect(vars['--fg-muted']).toBe('#666666')
  })

  it('maps ansi slot names to --ansi-N indices', () => {
    const { vars } = parseThemeToml(SAMPLE)
    expect(vars['--ansi-0']).toBe('#000000')
    expect(vars['--ansi-15']).toBe('#ffffff')
  })

  it('treats any base other than light as dark, like Mallard', () => {
    expect(parseThemeToml('name = "X"\nbase = "weird"\n').base).toBe('dark')
  })

  it('drops values that could break out of a CSS declaration', () => {
    const { vars } = parseThemeToml('name = "X"\nbase = "dark"\n[colors]\nbg = "red; }"\nfg = "#fff"\n')
    expect(vars['--bg']).toBeUndefined()
    expect(vars['--fg']).toBe('#fff')
  })
})

describe('renderModule', () => {
  it('emits an ES module whose default export round-trips', () => {
    const src = renderModule({ a: { name: 'A', base: 'dark', vars: { '--bg': '#000' } } }, 'test')
    expect(src).toContain('export default')
    const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1)
    expect(JSON.parse(json).a.vars['--bg']).toBe('#000')
  })
})

describe('plugin.toml map_theme choices', () => {
  const toml = readFileSync(new URL('../plugin.toml', import.meta.url), 'utf8')
  const block = toml.split('[settings.map_theme]')[1].split('\n[')[0]
  const choices = [...block.matchAll(/\{ value = "([^"]+)",\s*label = "([^"]+)"\s*\}/g)]
    .map(m => ({ value: m[1], label: m[2] }))

  it('starts with Follow Mallard as the default', () => {
    expect(choices[0]).toEqual({ value: 'auto', label: 'Follow Mallard' })
    expect(block).toMatch(/default\s*=\s*"auto"/)
  })

  it('lists exactly the snapshot themes, labelled with their Mallard names', () => {
    const expected = Object.entries(mapThemes).map(([value, t]) => ({ value, label: t.name }))
    expect(choices.slice(1)).toEqual(expected)
  })

  it('keeps light and dark ids for 0.32.0 compatibility', () => {
    expect(mapThemes.light?.base).toBe('light')
    expect(mapThemes.dark?.base).toBe('dark')
  })
})
