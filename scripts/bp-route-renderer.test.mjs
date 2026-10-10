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
    current: null, target: null, routeRoomIds: [], libraryOverlay: null, ...state,
  }, false);
  return { strokes, fills };
}
const rooms = { A: [1, 10, 10], B: [1, 20, 20], X: [2, 30, 30], C: [1, 40, 40] };

describe('BP farming path on PNG maps', () => {
  it('draws green connections and keeps the current-room marker red', () => {
    const result = render({routeRoomIds: ['A', 'B'], routeColor: '#4ade80', current: {roomId: 'A'}}, rooms);
    expect(result.strokes).toEqual(['#4ade80', '#ffffff']);
    expect(result.fills).toEqual(['#4ade80', '#4ade80', '#e03030']);
  });
  it('never connects across a map boundary', () => {
    const result = render({routeRoomIds: ['A', 'B', 'X', 'C'], routeColor: '#4ade80'}, rooms);
    expect(result.strokes).toEqual(['#4ade80']);
    expect(result.fills).toHaveLength(3);
  });
  it('clears the route while preserving the current marker', () => {
    const result = render({current: {roomId: 'A'}}, rooms);
    expect(result.strokes).toEqual(['#ffffff']);
    expect(result.fills).toEqual(['#e03030']);
  });
  it('keeps ordinary destination routes blue', () => {
    const result = render({routeRoomIds: ['A', 'B']}, rooms);
    expect(result.strokes).toEqual([]);
    expect(result.fills).toEqual(['rgba(74, 159, 212, 0.8)', 'rgba(74, 159, 212, 0.8)']);
  });
});
