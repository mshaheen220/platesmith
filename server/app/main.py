from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from pydantic import BaseModel
import io
from PIL import Image
import trimesh
import numpy as np
import cv2

app = FastAPI(
    title="platesmith Backend",
    description="Handles image processing and 3D mesh generation for the platesmith application.",
)

# Configure CORS to allow requests from our frontend
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(?:localhost|127\.0\.0\.1):\d+",
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

def create_svg_path_from_mask(mask_array: np.ndarray, use_external_only: bool = False) -> str:
    """Convert a binary mask into a compact SVG path string."""
    retrieval_mode = cv2.RETR_EXTERNAL if use_external_only else cv2.RETR_CCOMP
    contours_list, hierarchy = cv2.findContours(mask_array, retrieval_mode, cv2.CHAIN_APPROX_SIMPLE)
    if not contours_list:
        return ''

    if use_external_only:
        contour = max(contours_list, key=cv2.contourArea)
        points = contour.reshape(-1, 2).astype(np.float64)
        if len(points) < 3:
            return ''
        combined_path = trimesh.path.Path2D(
            entities=[trimesh.path.entities.Line(np.arange(len(points)))],
            vertices=points,
        )
        return combined_path.export(file_type='svg')

    polygons: List[np.ndarray] = []
    holes: List[np.ndarray] = []
    for index, contour in enumerate(contours_list):
        points = contour.reshape(-1, 2).astype(np.float64)
        if hierarchy[0][index][3] != -1:
            holes.append(points)
        else:
            polygons.append(points)

    if not polygons:
        return ''

    combined_path = trimesh.path.Path2D(
        entities=[trimesh.path.entities.Line(np.arange(len(p))) for p in polygons] +
                 [trimesh.path.entities.Line(np.arange(len(h))) for h in holes],
        vertices=np.vstack(polygons + holes) if polygons or holes else []
    )
    return combined_path.export(file_type='svg')


def create_base_layer_from_image(image: Image.Image) -> LayerData | None:
    """Create a base silhouette layer for the overall object shape."""
    try:
        rgb = np.array(image.convert('RGB'))
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

        # Remove the bright background by selecting darker pixels as foreground.
        # For ink-like artwork, the outline and detail lines should dominate the base layer.
        foreground_mask = np.where(gray < 230, 255, 0).astype(np.uint8)
        foreground_mask = cv2.medianBlur(foreground_mask, 5)
        foreground_mask = cv2.morphologyEx(foreground_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

        # Keep only the largest connected component so the background does not become the base.
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(foreground_mask, connectivity=8)
        if num_labels <= 1:
            return None

        # Pick the component with the largest area that is not the background.
        component_sizes = stats[1:, cv2.CC_STAT_AREA]
        if len(component_sizes) == 0:
            return None

        largest_component_index = 1 + int(np.argmax(component_sizes))
        component_mask = np.where(labels == largest_component_index, 255, 0).astype(np.uint8)

        contours, _ = cv2.findContours(component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        largest_contour = max(contours, key=cv2.contourArea)
        contour_points = largest_contour.reshape(-1, 2).astype(np.float64)
        combined_path = trimesh.path.Path2D(
            entities=[trimesh.path.entities.Line(np.arange(len(contour_points)))],
            vertices=contour_points,
        )
        svg_path = combined_path.export(file_type='svg')
        if not svg_path:
            return None
        return LayerData(color='#000000', svg_path=svg_path)
    except Exception as exc:
        print(f'Could not create base layer: {exc}')
        return None


def create_layer_from_color(
    color_hex: str,
    quantized_image: Image.Image,
    palette: List[int],
    color_distance_threshold: float
) -> LayerData | None:
    """Generate an optional detail layer from a detected color region."""
    try:
        target_rgb = hex_to_rgb(color_hex)
        palette_rgb = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]
        matching_indices = {
            i for i, rgb in enumerate(palette_rgb)
            if color_distance(rgb, target_rgb) < color_distance_threshold
        }

        if not matching_indices:
            return None

        quantized_array = np.array(quantized_image)
        mask_array = np.isin(quantized_array, list(matching_indices)).astype(np.uint8) * 255
        mask_array = cv2.medianBlur(mask_array, 5)
        mask_array = cv2.morphologyEx(mask_array, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask_array, connectivity=8)
        if num_labels <= 1:
            return None

        component_sizes = stats[1:, cv2.CC_STAT_AREA]
        if len(component_sizes) == 0:
            return None

        # Keep the largest connected component for a single, coherent detail layer.
        largest_component_index = 1 + int(np.argmax(component_sizes))
        component_mask = np.where(labels == largest_component_index, 255, 0).astype(np.uint8)
        if cv2.countNonZero(component_mask) < 20:
            return None

        svg_path = create_svg_path_from_mask(component_mask, use_external_only=True)
        if not svg_path:
            return None
        return LayerData(color=color_hex, svg_path=svg_path)
    except Exception as exc:
        print(f'Could not generate path for color {color_hex}: {exc}')
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

    base_layer = create_base_layer_from_image(image)
    response_layers: List[LayerData] = []
    if base_layer is not None:
        response_layers.append(base_layer)

    accent_layers = [
        layer for color_hex in distinct_colors[:4]
        if (layer := create_layer_from_color(color_hex, quantized_image, palette, color_distance_threshold)) is not None
    ]
    response_layers.extend(accent_layers)

    return ProcessImageResponse(filename=file.filename, layers=response_layers)