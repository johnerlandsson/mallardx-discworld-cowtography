import { describe, it, expect, vi } from 'vitest';
import { buildRoomNoteItems } from '../ui/note-menu.js';

describe('buildRoomNoteItems', () => {
  it('leads with a header showing the room name', () => {
    const items = buildRoomNoteItems('The Mended Drum', false, {});
    expect(items[0]).toEqual({ header: true, label: 'The Mended Drum' });
  });

  it('offers "Add note" when the room has none', () => {
    const items = buildRoomNoteItems('Room', false, {});
    const addItem = items.find(i => i.label === 'Add note');
    expect(addItem).toBeDefined();
    expect(items.find(i => i.label === 'Edit note')).toBeUndefined();
    expect(items.find(i => i.label === 'Remove note')).toBeUndefined();
  });

  it('offers "Edit note" and "Remove note" when the room already has one', () => {
    const items = buildRoomNoteItems('Room', true, {});
    expect(items.find(i => i.label === 'Edit note')).toBeDefined();
    expect(items.find(i => i.label === 'Remove note')).toBeDefined();
    expect(items.find(i => i.label === 'Add note')).toBeUndefined();
  });

  it('wires the add/edit item to onEdit', () => {
    const onEdit = vi.fn();
    const items = buildRoomNoteItems('Room', false, { onEdit, onRemove: vi.fn() });
    items.find(i => i.label === 'Add note').onClick();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('wires the remove item to onRemove', () => {
    const onRemove = vi.fn();
    const items = buildRoomNoteItems('Room', true, { onEdit: vi.fn(), onRemove });
    items.find(i => i.label === 'Remove note').onClick();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
