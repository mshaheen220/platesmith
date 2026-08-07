# platesmith

> Web-based multi-layer 3D plate generator for lightboxes, ornaments, and stacked filament prints.

## Overview
platesmith converts 2D images (PNG/SVG) into stacked, multi-color 3D printable layers (STL/3MF). Designed for multi-material setups and manual filament-swap printing.

## Features (Phase 1 - Lightbox Mode)
- **Image Slicing & Layer Separation**: Auto-extract or manual color/luminance thresholding into discrete plates.
- **Granular Controls**: Custom per-layer height (mm), Z-offset, and filament color matching.
- **Interactive 3D Canvas**: React Three Fiber live preview with exploded Z-view and dynamic backlit simulation.
- **Multi-Format Export**: Zip archive containing individual layer STLs with predictable naming.

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

## Tech Stack
- **Frontend**: React (Vite, TypeScript), Tailwind CSS, React Three Fiber / Three.js
- **Backend**: Node.js / Python (2D vector/raster extrusion engine)

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
