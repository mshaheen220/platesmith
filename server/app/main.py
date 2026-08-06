from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from pydantic import BaseModel
import io
from PIL import Image
import trimesh
import numpy as np # Already imported, but good to ensure
import cv2 # Import OpenCV

app = FastAPI(
    title="platesmith Backend",
    description="Handles image processing and 3D mesh generation for the platesmith application.",
)

# Configure CORS to allow requests from our frontend
app.add_middleware(
    CORSMiddleware,
    # In production, this should be a more restrictive list of allowed origins,
    # ideally managed via environment variables.
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Define Pydantic models for structured, type-safe responses.
class LayerData(BaseModel):
    color: str
    svg_path: str

class ProcessImageResponse(BaseModel):
    filename: str
    # The response will now be a list of layer data objects
    layers: List[LayerData]

def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Converts a HEX color string to an (R, G, B) tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))

def color_distance(rgb1: tuple[int, int, int], rgb2: tuple[int, int, int]) -> float:
    """
    Calculates the Euclidean distance between two RGB colors.
    A simple measure of color similarity.
    """
    r1, g1, b1 = rgb1
    r2, g2, b2 = rgb2
    return ((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) ** 0.5

def merge_similar_colors(hex_colors: List[str], threshold: float) -> List[str]:
    """
    Merges a list of HEX colors that are closer to each other than the given threshold.
    """
    distinct_colors = []
    for color in hex_colors:
        # Check if the current color is similar to any color already in the distinct list
        is_similar = any(
            color_distance(hex_to_rgb(color), hex_to_rgb(existing_color)) < threshold
            for existing_color in distinct_colors
        )
        if not is_similar:
            distinct_colors.append(color)
    return distinct_colors

def create_layer_from_color(
    color_hex: str,
    quantized_image: Image.Image,
    palette: List[int],
    color_distance_threshold: float
) -> LayerData | None:
    """Generates a LayerData object containing SVG paths for a given color."""
    try:
        mask = Image.new('L', quantized_image.size, 0)
        target_rgb = hex_to_rgb(color_hex)

        palette_rgb = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]
        matching_indices = {
            i for i, rgb in enumerate(palette_rgb)
            if color_distance(rgb, target_rgb) < color_distance_threshold
        }

        mask_data = [255 if p in matching_indices else 0 for p in quantized_image.getdata()]
        mask.putdata(mask_data)

        # Convert the Pillow image to a numpy array and find contours.
        # This is the most reliable method for extracting paths from a raster image.
        mask_array = np.array(mask)
        
        # OpenCV requires a single-channel 8-bit image.
        # Our mask_array is already 0 or 255, so it's suitable.
        # Find contours using OpenCV
        # RETR_CCOMP retrieves all contours and organizes them into a two-level hierarchy.
        # CHAIN_APPROX_SIMPLE compresses horizontal, vertical, and diagonal segments.
        contours_list, hierarchy = cv2.findContours(mask_array, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours_list:
            return None

        # Process contours and their hierarchy to correctly identify holes
        polygons = []
        holes = []
        # The hierarchy is a list of [Next, Previous, First_Child, Parent]
        for i, contour in enumerate(contours_list):
            # A contour is a hole if it has a parent
            if hierarchy[0][i][3] != -1:
                holes.append(contour.reshape(-1, 2).astype(np.float64))
            else:
                polygons.append(contour.reshape(-1, 2).astype(np.float64))
        
        # Create a single Path2D object with both outer polygons and inner holes
        # This is the correct way to represent complex shapes.
        combined_path = trimesh.path.Path2D(
            entities=[trimesh.path.entities.Line(np.arange(len(p))) for p in polygons] +
                     [trimesh.path.entities.Line(np.arange(len(h))) for h in holes],
            vertices=np.vstack(polygons + holes) if polygons or holes else []
        )

        # Export the combined path object to an SVG path string
        svg_path_string = combined_path.export(file_type='svg')
        
        return LayerData(color=color_hex, svg_path=svg_path_string)
    except Exception as e:
        print(f"Could not generate path for color {color_hex}: {e}")
        return None

@app.get("/")
def read_root() -> Dict[str, str]:
    """A simple endpoint to confirm the server is running."""
    return {"message": "platesmith backend is running!"}

@app.post("/process-image/")
async def process_image(file: UploadFile = File(...), num_colors: int = 10) -> ProcessImageResponse:
    """
    Processes an uploaded image to extract its dominant colors.
    """
    # Read the image file into memory
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")

    # Resize the image to a manageable size for faster processing.
    # This is a crucial step for performance with large images.
    max_size = (512, 512)
    image.thumbnail(max_size)

    # Quantize the image to reduce the number of colors to a maximum of 8.
    # This is a simple way to find dominant colors.
    quantized_image = image.quantize(colors=num_colors, method=Image.Quantize.MEDIANCUT)
    
    # Get the palette, which is a flat list [r1, g1, b1, r2, g2, b2, ...].
    # We convert it to a list of [r, g, b] tuples and then to HEX strings.
    palette = quantized_image.getpalette()
    if palette is None:
        return ProcessImageResponse(filename=file.filename, layers=[])
        
    rgb_colors = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]
    initial_hex_colors = [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in rgb_colors[:num_colors]]

    # This threshold can be tuned. Higher values mean more colors will be merged.
    color_distance_threshold = 40.0
    distinct_colors = merge_similar_colors(initial_hex_colors, color_distance_threshold)

    # For each distinct color, generate the geometry in parallel (conceptually)
    response_layers = [
        layer for color_hex in distinct_colors
        if (layer := create_layer_from_color(color_hex, quantized_image, palette, color_distance_threshold)) is not None
    ]

    return ProcessImageResponse(filename=file.filename, layers=response_layers)