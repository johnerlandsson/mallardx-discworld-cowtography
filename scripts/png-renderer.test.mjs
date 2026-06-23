import { describe, it, expect } from 'vitest';
import { findNearestRoom } from '../ui/png-renderer.js';

// rooms format: { id: [map_id, xpos, ypos, short] }
const ROOMS = {
  'room-a': [1, 100, 100, 'Room A'],
  'room-b': [1, 200, 200, 'Room B'],
  'room-c': [2, 100, 100, 'Room C on map 2'],
};

describe('findNearestRoom', () => {
  it('returns the nearest room on the correct map', () => {
    expect(findNearestRoom(ROOMS, 1, 100, 100)).toBe('room-a');
    expect(findNearestRoom(ROOMS, 1, 200, 200)).toBe('room-b');
  });

  it('ignores rooms on other maps', () => {
    expect(findNearestRoom(ROOMS, 2, 100, 100)).toBe('room-c');
    // room-c is on map 2; map 1 click at same coords → room-a
    expect(findNearestRoom(ROOMS, 1, 100, 100)).toBe('room-a');
  });

  it('returns null when nearest room exceeds click threshold', () => {
    const sparse = { 'r1': [1, 100, 100, 'R1'] };
    // distance = sqrt(100^2 + 100^2) ≈ 141px, well beyond 20px threshold
    expect(findNearestRoom(sparse, 1, 200, 200)).toBeNull();
  });

  it('returns null when no rooms exist for the given map', () => {
    expect(findNearestRoom(ROOMS, 99, 100, 100)).toBeNull();
  });

  it('returns the closer of two nearby rooms', () => {
    const rooms = {
      'r1': [1, 100, 100, 'R1'],
      'r2': [1, 110, 100, 'R2'],
    };
    expect(findNearestRoom(rooms, 1, 108, 100)).toBe('r2');  // 2px vs 8px
    expect(findNearestRoom(rooms, 1, 102, 100)).toBe('r1');  // 2px vs 8px
  });
});
