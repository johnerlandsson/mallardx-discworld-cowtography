import { describe, it, expect } from 'vitest';
import { drawState } from '../ui/png-renderer/draw-state.js';

function render(state, rooms) {
  const strokes = [], fills = [];
  const ctx = {
    clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
    stroke() { strokes.push(this.strokeStyle); },
    fill() { fills.push(this.fillStyle); },
  };
  const img = { clientWidth: 100, clientHeight: 100, naturalWidth: 100, naturalHeight: 100 };
  drawState(img, { width: 100, height: 100, getContext: () => ctx }, rooms, 1, null, {
    current: null, target: null, routeRoomIds: [], routeGuide: false, libraryOverlay: null, ...state,
  }, false);
  return { strokes, fills };
}

// rooms format: { id: [map_id, xpos, ypos] }
const rooms = { A: [1, 10, 10], B: [1, 20, 20], X: [2, 30, 30], C: [1, 40, 40] };
const BLUE = 'rgba(74, 159, 212, 0.8)';
const GREEN = '#4ade80';

describe('guide routes on PNG maps', () => {
  it('draws green lines and markers, current-room marker last and red', () => {
    const r = render({ routeRoomIds: ['A', 'B'], routeGuide: true, current: { roomId: 'A' } }, rooms);
    expect(r.strokes).toEqual([GREEN, '#ffffff']);
    expect(r.fills).toEqual([GREEN, GREEN, '#e03030']);
  });

  it('never draws a line across a map boundary', () => {
    const r = render({ routeRoomIds: ['A', 'B', 'X', 'C'], routeGuide: true }, rooms);
    expect(r.strokes).toEqual([GREEN]); // only A-B; B-X and X-C cross maps
    expect(r.fills).toEqual([GREEN, GREEN, GREEN]);
  });

  it('keeps normal routes blue with no lines', () => {
    const r = render({ routeRoomIds: ['A', 'B'] }, rooms);
    expect(r.strokes).toEqual([]);
    expect(r.fills).toEqual([BLUE, BLUE]);
  });
});
