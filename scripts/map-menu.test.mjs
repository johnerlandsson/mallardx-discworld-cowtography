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
  it('returns one top-level item per non-empty group', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    expect(items.map(i => i.label)).toEqual(['Ankh-Morpork', 'Other']);
  });

  it('sorts maps within a group submenu alphabetically', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const am = items.find(i => i.label === 'Ankh-Morpork');
    expect(am.submenu[0].label).toBe('AM Guilds');
    expect(am.submenu[1].label).toBe('Ankh-Morpork');
  });

  it('marks the exact displayed map as checked in its submenu', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, 1);
    const allSubmapItems = items.flatMap(i => i.submenu);
    const checked = allSubmapItems.filter(i => i.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].mapId).toBe(1);
  });

  it('marks the group as checked when it contains the displayed map', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, 1);
    const am = items.find(i => i.label === 'Ankh-Morpork');
    const other = items.find(i => i.label === 'Other');
    expect(am.checked).toBe(true);
    expect(other.checked).toBe(false);
  });

  it('routes unassigned regions to the catch-all group submenu', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    const other = items.find(i => i.label === 'Other');
    expect(other.submenu.map(i => i.label)).toContain('Bes Pelargic');
    expect(other.submenu.map(i => i.label)).toContain('Thursday');
  });

  it('skips groups that contain no matching maps', () => {
    const groups = [
      { label: 'Empty', regions: ['ZZZ'] },
      { label: 'AM',    regions: ['AM']  },
      { label: 'Other', regions: null    },
    ];
    const items = buildMapMenuItems(MAPS, groups, null);
    expect(items.map(i => i.label)).not.toContain('Empty');
  });

  it('returns mapId as a number regardless of object key type', () => {
    const items = buildMapMenuItems(MAPS, GROUPS, null);
    for (const item of items.flatMap(i => i.submenu)) {
      expect(typeof item.mapId).toBe('number');
    }
  });
});
