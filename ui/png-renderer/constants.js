export const PNG_CLICK_THRESHOLD = 20;  // px — max distance to nearest room for a click to register
export const PNG_ZOOM_FACTOR = 1.25;
export const PNG_MAX_SCALE   = 8;
// Target on-screen spacing (px) between adjacent rooms at default zoom.
// Mirrors svg-renderer.js's TARGET_PX so both renderers default to a
// comparably "zoomed in" view instead of always fitting the whole map —
// #fitScale() has zero scrollable overflow by definition, which made
// centerOn() a structural no-op on every fresh map visit.
export const PNG_TARGET_PX = 30;

// Mirrors svg-renderer.js's ORB_RADIUS / #applyLibraryOverlay geometry, in raw map units.
export const LIB_ORB_RADIUS = {
  "tiny speck": 3, "small point": 5, "moderately-sized ball": 7,
  "large orb": 9, "substantial sphere": 12,
};
