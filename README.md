# stack3d

> Web-based multi-layer 3D plate generator for lightboxes, ornaments, and stacked filament prints.

## Overview
stack3d converts 2D images (PNG/SVG) into stacked, multi-color 3D printable layers (STL/3MF). Designed for multi-material setups and manual filament-swap printing.

## Features (Phase 1 - Lightbox Mode)
- **Image Slicing & Layer Separation**: Auto-extract or manual color/luminance thresholding into discrete plates.
- **Granular Controls**: Custom per-layer height (mm), Z-offset, and filament color matching.
- **Interactive 3D Canvas**: React Three Fiber live preview with exploded Z-view and dynamic backlit simulation.
- **Multi-Format Export**: Zip archive containing individual layer STLs with predictable naming.

## Tech Stack
- **Frontend**: React (Vite, TypeScript), Tailwind CSS, React Three Fiber / Three.js
- **Backend**: Node.js / Python (2D vector/raster extrusion engine)
