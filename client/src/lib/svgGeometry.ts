import type { LayerConfig } from '../types/project';

const SVG_DIMS_RE = /width="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"/;

/**
 * The source image's pixel dimensions, read from whichever layer actually has geometry.
 * Mirrors the backend's own dimension parsing so the preview and the export agree on
 * what "plate width" scales against. Falls back to a nominal size for the placeholder
 * demo layers (or before any image has been processed), which carry no real geometry.
 */
export function getImageDimsPx(layers: LayerConfig[]): { width: number; height: number } {
  for (const layer of layers) {
    const svg = layer.accumulatedPathData ?? layer.pathData;
    const match = svg?.match(SVG_DIMS_RE);
    if (match) return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
  }
  return { width: 300, height: 300 };
}

/** Same as getImageDimsPx, but returns null instead of a fallback when no layer has
 * real geometry yet - used where "no image processed" needs to be a distinct case
 * (e.g. disabling an action that requires knowing the actual canvas size). */
export function getImageDimsPxOrNull(layers: LayerConfig[]): { width: number; height: number } | null {
  for (const layer of layers) {
    const svg = layer.accumulatedPathData ?? layer.pathData;
    const match = svg?.match(SVG_DIMS_RE);
    if (match) return { width: parseFloat(match[1]), height: parseFloat(match[2]) };
  }
  return null;
}

/** A closed rectangle SVG path spanning the full given dimensions, in the same
 * "M x y L x y ... Z" format the backend produces - a full-canvas rectangle, not
 * clipped to any subject, for layers like the diffuser base that must always be the
 * plate's maximum extent regardless of what the artwork itself covers. */
export function buildRectPathData(width: number, height: number): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><path d="M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z" fill="#000" fill-rule="evenodd" /></svg>`;
}
