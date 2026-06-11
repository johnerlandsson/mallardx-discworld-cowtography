import { describe, it, expect } from 'vitest'
import { injectFontStyle, FONT_STYLE_BLOCK } from './sync-svg-js.mjs'

const SELF_CLOSING_SVG = `<svg>
  <defs
     id="defs8" />
  <g id="layer-artwork" />
</svg>`

describe('injectFontStyle', () => {
  it('injects style block after self-closing defs when none present', () => {
    const result = injectFontStyle(SELF_CLOSING_SVG)
    const defsEnd  = result.indexOf('/>') + 2
    const stylePos = result.indexOf('<style id="inkscape-font-fix">')
    const layerPos = result.indexOf('<g id="layer-artwork"')
    expect(stylePos).toBeGreaterThan(defsEnd)
    expect(stylePos).toBeLessThan(layerPos)
  })

  it('replaces an existing inkscape-font-fix block without duplication', () => {
    const stale = `<style id="inkscape-font-fix">\n.map-label { font-family: "Old Font"; }\n</style>`
    const svg = `<svg>\n  <defs id="defs8" />\n  ${stale}\n</svg>`
    const result = injectFontStyle(svg)
    const count = (result.match(/inkscape-font-fix/g) || []).length
    expect(count).toBe(1)
    expect(result).not.toContain('Old Font')
  })

  it('injected block contains Noto Sans for all annotation classes', () => {
    const result = injectFontStyle(SELF_CLOSING_SVG)
    expect(result).toContain('"Noto Sans", sans-serif')
    expect(result).toContain('.map-label')
    expect(result).toContain('.map-label-muted')
    expect(result).toContain('.lib-table')
    expect(result).toContain('.lib-gap-label')
    expect(result).toContain('.lib-book-label')
    expect(result).toContain('.lib-row-num')
    expect(result).toContain('.lib-book-list')
  })

  it('FONT_STYLE_BLOCK export contains the id marker', () => {
    expect(FONT_STYLE_BLOCK).toContain('id="inkscape-font-fix"')
    expect(FONT_STYLE_BLOCK).toContain('"Noto Sans", sans-serif')
  })
})
