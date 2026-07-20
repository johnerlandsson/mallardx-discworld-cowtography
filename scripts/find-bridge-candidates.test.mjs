import { describe, it, expect } from 'vitest'
import { isBridgeCandidate } from './find-bridge-candidates.mjs'

describe('isBridgeCandidate', () => {
  it('includes a plain named bridge', () => {
    expect(isBridgeCandidate("King's Bridge")).toBe(true)
  })

  it('includes a punnily-named bridge', () => {
    expect(isBridgeCandidate('Rubber bridge')).toBe(true)
  })

  it('includes "middle of X Bridge"', () => {
    expect(isBridgeCandidate('middle of New Bridge')).toBe(true)
  })

  it('includes "end of X Bridge"', () => {
    expect(isBridgeCandidate('east end of New Bridge')).toBe(true)
  })

  it('includes "section of X Bridge ..."', () => {
    expect(isBridgeCandidate('section of Rainbow Bridge connecting Hong Fa and Shoo-Li')).toBe(true)
  })

  it('includes "bridge over/spanning/between Y"', () => {
    expect(isBridgeCandidate('bridge over Lancre Gorge')).toBe(true)
    expect(isBridgeCandidate('bridge spanning the Sapphire Strand')).toBe(true)
    expect(isBridgeCandidate('bridge between two towers')).toBe(true)
  })

  it('excludes rooms under the bridge', () => {
    expect(isBridgeCandidate("under the King's Bridge")).toBe(false)
    expect(isBridgeCandidate('ledge underneath the Tora Bridge')).toBe(false)
  })

  it('excludes a street named after a bridge', () => {
    expect(isBridgeCandidate('Bridge Street')).toBe(false)
  })

  it('excludes a junction room that merely mentions a bridge', () => {
    expect(isBridgeCandidate("junction of Phedre Road with King's Way and King's Bridge")).toBe(false)
  })

  it('excludes a river room that merely mentions bridges in passing', () => {
    expect(isBridgeCandidate('Pearl River between two bridges')).toBe(false)
    expect(isBridgeCandidate('east of a bridge on Pearl Path')).toBe(false)
  })

  it('excludes empty or missing names', () => {
    expect(isBridgeCandidate('')).toBe(false)
    expect(isBridgeCandidate(undefined)).toBe(false)
  })
})
