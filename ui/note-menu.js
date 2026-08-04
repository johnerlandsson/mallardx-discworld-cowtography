export function buildRoomNoteItems(name, hasNote, { onEdit, onRemove }) {
  const items = [
    { header: true, label: name },
    { label: hasNote ? 'Edit note' : 'Add note', onClick: onEdit },
  ];
  if (hasNote) {
    items.push({ label: 'Remove note', onClick: onRemove });
  }
  return items;
}
