export type TipCategory = "layers" | "printing" | "backlight";

export interface Tip {
  category: TipCategory;
  text: string;
}

export const TIPS: Tip[] = [
  // --- Layers ---
  { category: "layers", text: "Check the box next to two or more layers to enable Merge Selected — handy when a color split isn't meaningful for your print." },
  { category: "layers", text: "Merging layers is fully reversible: click the Unmerge icon on a merged layer to restore the original layers that went into it." },
  { category: "layers", text: "Add a Diffuser Base Layer to spread backlight evenly under your color layers instead of leaving hot spots and shadows." },
  { category: "layers", text: "Changing a layer's height instantly re-stacks every layer above it in the 3D preview — no need to re-upload or re-process." },
  { category: "layers", text: "Uploading a PNG with a transparent background? Turn on Fill Transparent Background first to turn the cutout into a solid rectangular plate." },
  { category: "layers", text: "Drag a layer's grip handle to reorder the stack — Platesmith recalculates filament swap points automatically after a reorder." },
  { category: "layers", text: "Click a layer's name to rename it inline — worth doing once you have more than a couple of colors to keep track of." },
  { category: "layers", text: "Hiding a layer removes it from the stack entirely and closes the height gap it would have left — it isn't just skipped at export time." },

  // --- Printing & slicing ---
  { category: "printing", text: "Set Printer Layer Height so Platesmith can flag filament swap points that don't land on an achievable physical layer boundary." },
  { category: "printing", text: "If your first layer prints taller for bed adhesion, set First Layer Height separately — swap point math accounts for that one-time offset." },
  { category: "printing", text: "Snap to Layer Grid rounds every layer's height to a multiple of your printer's layer height, so every color swap lands on a clean boundary." },
  { category: "printing", text: "The 'print layer' number shown for a swap point is what to type into your slicer's pause-at-layer feature — it's already offset by one." },
  { category: "printing", text: "Export STL Pack exports every visible layer at its current height, order, and color as separate, ready-to-slice files." },
  { category: "printing", text: "Plate Width sets the real-world export scale — your source image's pixel width maps to this dimension in millimeters." },

  // --- Backlight & viewing ---
  { category: "backlight", text: "Toggle Backlight Simulation to preview how light passes through thin filament areas before committing to a layer height." },
  { category: "backlight", text: "Exploded View pulls layers apart along Z so you can inspect stacking order and gaps that overlap in the normal stacked view." },
  { category: "backlight", text: "Cycle Canvas Background between dark, light, and neutral gray to check contrast against different lightbox or display setups." },
  { category: "backlight", text: "A thin, light-colored Diffuser Base under a lightbox print softens hard edges between colors when the backlight is on." },
];

/** Fisher-Yates shuffle of [0, length) - used to tour every tip exactly
 * once in a random order before repeating, rather than picking randomly
 * with replacement (which can stall on a few tips and never reach others). */
export function shuffleIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}
