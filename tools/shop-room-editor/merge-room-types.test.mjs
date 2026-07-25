import { describe, it, expect } from 'vitest'
import { applyRoomTypeChanges, serializeRoomTypes } from './merge-room-types.mjs'

describe('applyRoomTypeChanges', () => {
  it('updates an existing key in place, preserving key order', () => {
    const original = { a: 'temple', b: 'shop', c: 'post' }
    const result = applyRoomTypeChanges(original, { b: 'weapon' })
    expect(Object.keys(result)).toEqual(['a', 'b', 'c'])
    expect(result).toEqual({ a: 'temple', b: 'weapon', c: 'post' })
  })

  it('appends a new key at the end', () => {
    const original = { a: 'temple' }
    const result = applyRoomTypeChanges(original, { z: 'food' })
    expect(Object.keys(result)).toEqual(['a', 'z'])
    expect(result.z).toBe('food')
  })

  it('removes a key when the change value is null', () => {
    const original = { a: 'temple', b: 'shop' }
    const result = applyRoomTypeChanges(original, { a: null })
    expect(result).toEqual({ b: 'shop' })
  })

  it('leaves the original object untouched', () => {
    const original = { a: 'temple' }
    applyRoomTypeChanges(original, { a: 'food' })
    expect(original).toEqual({ a: 'temple' })
  })

  it('applies multiple changes at once', () => {
    const original = { a: 'temple', b: 'shop' }
    const result = applyRoomTypeChanges(original, { a: null, b: 'weapon', c: 'food' })
    expect(result).toEqual({ b: 'weapon', c: 'food' })
  })
})

describe('serializeRoomTypes', () => {
  it('pretty-prints with 2-space indent and a trailing newline', () => {
    const out = serializeRoomTypes({ a: 'temple' })
    expect(out).toBe('{\n  "a": "temple"\n}\n')
  })
})
