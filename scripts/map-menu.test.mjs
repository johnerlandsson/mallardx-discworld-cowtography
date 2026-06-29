import { describe, it, expect } from 'vitest';
import { buildMapMenuItems } from '../ui/map-menu.js';

const MAPS = {
  1: { name: 'Ankh-Morpork', region: 'AM', topLevel: true,  defaultX: 100, defaultY: 100 },
  2: { name: 'AM Guilds',     region: 'AM', topLevel: false, defaultX: 50,  defaultY: 50  },
  3: { name: 'Bes Pelargic',  region: 'BP', topLevel: true,  defaultX: 200, defaultY: 200 },
  4: { name: 'Thursday',      region: 'Thursday', topLevel: false, defaultX: 10, defaultY: 10 },
};

const GROUPS = [
  { label: 'Ankh-Morpork', regions: ['AM'] },
  { label: 'Other',         regions: null },
];

describe('buildMapMenuItems', () => {
  it('emits a header for each non-empty group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const headers = items.filter(i => i.header);
    expect(headers.map(h => h.label)).toEqual(['Ankh-Morpork', 'Other']);
  });

  it('puts topLevel maps before sub-maps within a group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const amStart = items.findIndex(i => i.header && i.label === 'Ankh-Morpork');
    const mapItems = [];
    for (let i = amStart + 1; i < items.length && !items[i].header; i++) mapItems.push(items[i]);
    expect(mapItems[0].label).toBe('Ankh-Morpork');
    expect(mapItems[1].label).toBe('AM Guilds');
  });

  it('marks the displayed map as checked and no other', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, 1);
    const mapItems = items.filter(i => !i.header);
    const checked = mapItems.filter(i => i.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].mapId).toBe(1);
  });

  it('routes unassigned regions to the catch-all group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const otherStart = items.findIndex(i => i.header && i.label === 'Other');
    const otherItems = [];
    for (let i = otherStart + 1; i < items.length && !items[i].header; i++) otherItems.push(items[i]);
    expect(otherItems.map(i => i.label)).toContain('Bes Pelargic');
    expect(otherItems.map(i => i.label)).toContain('Thursday');
  });

  it('skips groups that contain no matching maps', () => {
    const groups = [
      { label: 'Empty', regions: ['ZZZ'] },
      { label: 'AM',    regions: ['AM']  },
      { label: 'Other', regions: null    },
    ];
    const items = buildMapMenuItems(MAPS, groups, null);
    expect(items.filter(i => i.header).map(h => h.label)).not.toContain('Empty');
  });

  it('returns mapId as a number regardless of object key type', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const mapItems = items.filter(i => !i.header);
    for (const item of mapItems) expect(typeof item.mapId).toBe('number');
  });
});
