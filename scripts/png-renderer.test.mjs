import { describe, it, expect } from 'vitest';
import { findNearestRoom, libraryArrowPoints, libraryDistortionRect } from '../ui/png-renderer.js';

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

// Matches svg-renderer.js's #applyLibraryOverlay path math (M cx-w,cy-r+w L cx,cy-r L cx+w,cy-r+w for 'n', etc.)
describe('libraryArrowPoints', () => {
  it('points north', () => {
    expect(libraryArrowPoints(100, 100, 'n', 12, 5)).toEqual([[95, 93], [100, 88], [105, 93]]);
  });
  it('points south', () => {
    expect(libraryArrowPoints(100, 100, 's', 12, 5)).toEqual([[95, 107], [100, 112], [105, 107]]);
  });
  it('points east', () => {
    expect(libraryArrowPoints(100, 100, 'e', 12, 5)).toEqual([[107, 95], [112, 100], [107, 105]]);
  });
  it('points west', () => {
    expect(libraryArrowPoints(100, 100, 'w', 12, 5)).toEqual([[93, 95], [88, 100], [93, 105]]);
  });
  it('returns null for an unknown facing', () => {
    expect(libraryArrowPoints(100, 100, 'x', 12, 5)).toBeNull();
  });
});

describe('libraryDistortionRect', () => {
  it('bands the north wall', () => {
    expect(libraryDistortionRect(100, 100, 'n', 15, 20, 3)).toEqual([90, 82, 20, 3]);
  });
  it('bands the east wall', () => {
    expect(libraryDistortionRect(100, 100, 'e', 15, 20, 3)).toEqual([115, 90, 3, 20]);
  });
});
