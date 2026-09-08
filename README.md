# platesmith

> Web-based multi-layer 3D plate generator for lightboxes and stacked filament prints.

## Overview
platesmith converts a 2D image (PNG) into a stack of solid, single-color 3D printable layers, exported as STL files. It's built for multi-material/multi-color FDM printing where each color is printed as its own full layer and the filament is swapped by hand between layers (no AMS/MMU required) - you pause the print at a known Z height, swap filament, and resume.

## Features (Phase 1 - Lightbox Mode)
- **Image Slicing & Layer Separation**: K-means color clustering + contour tracing extracts each dominant color in the source image into its own layer, correctly preserving holes (e.g. a letter's counter, a ring).
- **Support-Aware Layer Accumulation**: every layer's actual printable footprint is the union of its own shape with everything stacked above it, computed server-side and shared by both the live preview and the STL export so they can never disagree. This is a physical requirement, not a preview nicety - FDM material below a raised feature must be present regardless of that feature's color, or the feature above it has nothing to print on. A pure cutout only survives if it's a hole through every layer above it too; anything else gets backfilled automatically.
- **Granular Controls**: per-layer height (mm), drag-to-reorder stacking, filament color override, merge-selected-layers, and per-layer visibility (hidden layers are fully excluded from the stack - the layers above close the gap rather than floating over empty space).
- **Interactive 3D Canvas**: React Three Fiber live preview with exploded Z-view and a backlight simulation mode, rendering each layer's actual accumulated (support-aware) geometry.
- **STL Export & Filament-Swap Manifest**: exports a zip containing one watertight STL per layer (scaled to a real-world plate width you set), plus a `manifest.json` and `README.txt` listing the exact Z height between every pair of layers where a filament swap must happen. If you set your printer's slicer layer height, each swap point is flagged as landing on an achievable physical layer boundary or not.

## How It Works
1. **Upload** a PNG. The backend clusters its opaque pixels into a handful of dominant colors (K-means) and traces each color's mask into an SVG path per layer (`POST /api/process-image/`).
2. **Arrange** the layers in the sidebar: reorder by drag, adjust each layer's height, override its filament color, merge layers together, or hide ones you don't want printed.
3. Any change to stacking order or inclusion triggers a call to `POST /api/accumulate-layers/`, which recomputes every layer's support-aware footprint and updates the 3D preview to show exactly what will print.
4. **Export**: set the plate's real-world width and (optionally) your printer's slicer layer height, then export. `POST /api/export/` re-derives the same accumulated geometry, extrudes each layer into a proper watertight mesh via trimesh/shapely, and returns a zip of per-layer STLs plus the filament-swap manifest.
5. **Print**: import the STLs into your slicer as one combined plate (or slice each layer's STL as its own object stacked at its printed height), then use the manifest's Z heights to insert a pause / color-change at each swap point - most slicers (PrusaSlicer, OrcaSlicer) support adding this directly at an exact height. platesmith does not generate or post-process g-code itself.

## Best Image Inputs for Processing

The current backend is a contour-based mask extractor, so it works best with clean, high-contrast source images. Use this checklist before uploading:

- Prefer PNG files over GIFs.
- Use transparent PNGs when possible; they make subject/background separation much easier.
- Keep the subject on a clean background with strong contrast.
- Crop tightly around the subject and remove extra whitespace.
- Avoid busy backgrounds, shadows, blur, or compressed artifacts.
- Use high-contrast silhouettes, logos, stickers, or bold illustrations when testing.
- For photos, keep the subject simple and avoid heavy texture or mixed lighting.
- Best testing size is usually around 800–1500 px on the longest edge.
- Avoid extremely small images or very large noisy images.
- If the image is grayscale or mostly black/white, expect mostly neutral layer colors and fewer chromatic detail layers.

### Good examples
- logo on transparent background
- silhouetted object on white background
- clean illustration with simple shapes
- crisp black/white art or high-contrast iconography

### Poor examples
- animated GIFs
- low-contrast photos with cluttered backgrounds
- heavily blurred or compressed art
- images with complex shadows or anti-aliased blends into the background

## API

The FastAPI backend exposes these endpoints under `/api`, all consumed by the frontend via relative paths (proxied to the backend by Vite in local dev, same-origin when running the built app in Docker):

- `GET /api/health` - liveness check.
- `GET /api/tips/` - returns every tip shown in the app's own tips panel (`{"tips": [{"category", "text"}, ...]}`) - not consumed by the frontend itself (which has its own local copy), exposed for other apps to use as they see fit. Keep in sync with `client/src/tips.ts` when editing either.
- `POST /api/process-image/` - accepts an uploaded image (`file`), an optional `num_colors`, and an optional `background_color` (fills the image's transparent region as its own layer); returns each extracted layer's dominant color and SVG path.
- `POST /api/accumulate-layers/` - accepts layers (`id`, `svg_path`) ordered bottom-to-top; returns each layer's SVG path recomputed as the union with everything stacked above it. Used to keep the live preview support-aware.
- `POST /api/export/` - accepts layers (`id`, `name`, `svg_path`, `layer_height_mm`, `z_offset_mm`, `color_hex`), a `plate_width_mm`, and optional `printer_layer_height_mm`/`first_layer_height_mm`; returns a zip of per-layer STLs, an assembled reference STL, and a filament-swap manifest.

## Known Limitations / Not Yet Implemented

This is a partial project. Notably missing or simplified:
- Only the Lightbox flow exists end-to-end; there is no ornament or other project type yet.
- No 3MF export, and no direct g-code generation or post-processing - the manifest tells you *where* to pause, but you insert the pause in your slicer yourself.
- Final layer geometry resolution is tied to the resolution the source image is processed at, not an independent high-resolution vector re-trace.
- No manual mask editing (paint/erase) - layer shapes come entirely from the automatic color clustering.

## Tech Stack
- **Frontend**: React (Vite, TypeScript), Tailwind CSS, React Three Fiber / Three.js, `@hello-pangea/dnd`
- **Backend**: Python (FastAPI) - OpenCV + scikit-learn for image clustering/contouring, Shapely for polygon/hole geometry, trimesh (+ mapbox-earcut for triangulation) for STL mesh generation

## Development Setup

### Prerequisites
- Node.js (v18 or later recommended)
- Python (v3.8 or later recommended)

### Installation

1.  **Install Frontend Dependencies:**
    ```bash
    cd client
    npm install
    ```

2.  **Install Backend Dependencies:**
    ```bash
    cd server
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt
    ```

### Running the Application

You will need two separate terminal windows to run the frontend and backend servers concurrently.

1.  **Start the Frontend (Vite):** (From the `/client` directory)
    ```bash
    npm run dev
    ```
    The frontend will be available at `http://localhost:5173`.

2.  **Start the Backend (FastAPI):** (From the `/server` directory, with virtual environment activated)
    ```bash
    uvicorn app.main:app --reload --port 8001
    ```
    The backend API will be available at `http://localhost:8001`.

*Note: You can also use the combined `npm run dev:all` script from the `/client` directory after installing `concurrently`.*

## Docker

For running platesmith as a single container instead of native dev - useful for keeping it alongside other locally-run tools:

```bash
docker compose up --build -d
```

This builds the Vite frontend to static assets and serves them from the same FastAPI process that serves `/api/*`, on one port - visit `http://localhost:8001`. Native dev (above) doesn't go through Docker and is unaffected.

This `docker-compose.yml` is intentionally standalone for now. The plan is to eventually fold this service into a separate dashboard project's compose file (alongside other local 3D-printing tools) so they all share one network and are reachable from that dashboard by service name - no explicit network is declared here for that reason.
