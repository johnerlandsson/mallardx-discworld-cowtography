import { describe, it, expect } from 'vitest';
import { roomFromElement } from '../ui/svg-renderer/geometry.js';

describe('roomFromElement', () => {
  it('extracts roomId and label from a generated room element', () => {
    const el = { id: 'room-abc123def', dataset: { label: 'The Mended Drum' } };
    expect(roomFromElement(el)).toEqual({ roomId: 'abc123def', name: 'The Mended Drum' });
  });

  it('defaults name to empty string when dataset.label is missing', () => {
    const el = { id: 'room-abc123def', dataset: {} };
    expect(roomFromElement(el)).toEqual({ roomId: 'abc123def', name: '' });
  });

  it('still returns a (garbage) roomId for hand-annotated elements without a room-<id> id', () => {
    // e.g. ephebe.svg's temple-offmap-1, ramtops.svg's phantom-water — these carry
    // the "room" class for styling but were never assigned a real room-<hash> id.
    // notes.lua rejects these via the state.rooms lookup, not via id shape here.
    const el = { id: 'rect751', dataset: {} };
    expect(roomFromElement(el)).toEqual({ roomId: '51', name: '' });
  });

  it('returns null for an element with no id', () => {
    const el = { id: '', dataset: {} };
    expect(roomFromElement(el)).toBeNull();
  });

  it('returns null when no element is given', () => {
    expect(roomFromElement(null)).toBeNull();
  });
});
