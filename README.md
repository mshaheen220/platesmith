# platesmith

> Web-based multi-layer 3D plate generator for lightboxes, ornaments, and stacked filament prints.

## Overview
platesmith converts 2D images (PNG/SVG) into stacked, multi-color 3D printable layers (STL/3MF). Designed for multi-material setups and manual filament-swap printing.

## Features (Phase 1 - Lightbox Mode)
- **Image Slicing & Layer Separation**: Auto-extract or manual color/luminance thresholding into discrete plates.
- **Granular Controls**: Custom per-layer height (mm), Z-offset, and filament color matching.
- **Interactive 3D Canvas**: React Three Fiber live preview with exploded Z-view and dynamic backlit simulation.
- **Multi-Format Export**: Zip archive containing individual layer STLs with predictable naming.

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
