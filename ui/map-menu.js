export function buildMapMenuItems(maps, mapGroups, displayedMapId) {
  const assignedRegions = new Set(
    mapGroups.flatMap(g => g.regions ?? [])
  );

  const result = [];

  for (const group of mapGroups) {
    const groupEntries = Object.entries(maps)
      .filter(([, meta]) =>
        group.regions === null
          ? !assignedRegions.has(meta.region)
          : group.regions.includes(meta.region)
      )
      .sort(([, a], [, b]) => {
        if (a.topLevel !== b.topLevel) return a.topLevel ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    if (groupEntries.length === 0) continue;

    const submenu = groupEntries.map(([id, meta]) => {
      const mapId = Number(id);
      return { label: meta.name, mapId, checked: mapId === displayedMapId };
    });

    result.push({
      label: group.label,
      checked: submenu.some(s => s.checked),
      submenu,
    });
  }

  return result;
}
