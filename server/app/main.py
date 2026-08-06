from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from collections import Counter
from math import sqrt
from pydantic import BaseModel
import io
from PIL import Image
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

def contour_to_path_data(contour: np.ndarray) -> str:
    points = contour.reshape(-1, 2).astype(np.float64)
    if len(points) < 3:
        return ''
    path_parts = [f"M{points[0][0]:.6f},{points[0][1]:.6f}"]
    for point in points[1:]:
        path_parts.append(f"L{point[0]:.6f},{point[1]:.6f}")
    path_parts.append('Z')
    return ' '.join(path_parts)


def create_svg_path_from_mask(mask_array: np.ndarray, use_external_only: bool = False) -> str:
    """Convert a binary mask into an SVG string with explicit closed paths."""
    retrieval_mode = cv2.RETR_EXTERNAL if use_external_only else cv2.RETR_CCOMP
    contours_list, hierarchy = cv2.findContours(mask_array, retrieval_mode, cv2.CHAIN_APPROX_SIMPLE)
    if not contours_list:
        return ''

    width = max(mask_array.shape[1], 1)
    height = max(mask_array.shape[0], 1)

    if use_external_only:
        contour = max(contours_list, key=cv2.contourArea)
        path_data = contour_to_path_data(contour)
        if not path_data:
            return ''
        return (
            f'<svg width="100%" height="100%" viewBox="0 0 {width} {height}" '
            f'xmlns="http://www.w3.org/2000/svg"><path d="{path_data}" fill="#000000" fill-rule="evenodd" /></svg>'
        )

    path_elements: List[str] = []
    for index, contour in enumerate(contours_list):
        path_data = contour_to_path_data(contour)
        if not path_data:
            continue
        path_elements.append(f'<path d="{path_data}" fill="#000000" fill-rule="evenodd" />')

    if not path_elements:
        return ''

    body = ''.join(path_elements)
    return (
        f'<svg width="100%" height="100%" viewBox="0 0 {width} {height}" '
        f'xmlns="http://www.w3.org/2000/svg">{body}</svg>'
    )


def estimate_background_color(image: Image.Image) -> np.ndarray:
    """Estimate the background color from the image corners."""
    rgba = np.array(image.convert('RGBA'))
    height, width = rgba.shape[:2]
    samples = []
    for y, x in [(0, 0), (0, width - 1), (height - 1, 0), (height - 1, width - 1)]:
        if rgba[y, x, 3] > 200:
            samples.append(rgba[y, x, :3].astype(np.float32))
    if not samples:
        return np.array([255, 255, 255], dtype=np.float32)
    return np.median(np.stack(samples, axis=0), axis=0).astype(np.float32)


def create_foreground_mask(image: Image.Image) -> np.ndarray:
    """Create a foreground mask using transparency, contrast, and background difference."""
    rgba = np.array(image.convert('RGBA'))
    alpha = rgba[:, :, 3].astype(np.uint8)
    rgb = rgba[:, :, :3].astype(np.float32)

    background_color = estimate_background_color(image)
    color_distance = np.linalg.norm(rgb - background_color, axis=2)
    gray = cv2.cvtColor(rgba[:, :, :3].astype(np.uint8), cv2.COLOR_RGBA2GRAY)

    transparent_mask = np.where(alpha < 250, 255, 0).astype(np.uint8)
    contrast_mask = np.where((color_distance > 35.0) | (gray < 220), 255, 0).astype(np.uint8)
    foreground_mask = cv2.bitwise_or(transparent_mask, contrast_mask)

    foreground_mask = cv2.medianBlur(foreground_mask, 5)
    foreground_mask = cv2.morphologyEx(foreground_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    foreground_mask = cv2.morphologyEx(foreground_mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return foreground_mask


def estimate_component_color(image: Image.Image, component_mask: np.ndarray) -> str:
    """Estimate a dominant hue for a component using the foreground pixels."""
    rgba = np.array(image.convert('RGBA'))
    mask = component_mask.astype(bool)
    if not np.any(mask):
        return '#000000'

    pixels = rgba[mask]
    if len(pixels) == 0:
        return '#000000'

    visible_pixels = pixels[pixels[:, 3] > 128] if pixels.shape[1] >= 4 else pixels
    if len(visible_pixels) == 0:
        return '#000000'

    rgb_pixels = visible_pixels[:, :3].astype(np.uint8)
    if len(rgb_pixels) == 0:
        return '#000000'

    quantized = (rgb_pixels // 32) * 32
    color_keys = [tuple(color) for color in quantized]
    counts = Counter(color_keys)
    if not counts:
        return '#000000'

    dominant_color = counts.most_common(1)[0][0]
    r, g, b = dominant_color
    return f'#{r:02x}{g:02x}{b:02x}'


def create_base_layer_from_image(image: Image.Image) -> LayerData | None:
    """Create a base silhouette layer for the overall object shape."""
    try:
        foreground_mask = create_foreground_mask(image)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(foreground_mask, connectivity=8)
        if num_labels <= 1:
            return None

        component_sizes = stats[1:, cv2.CC_STAT_AREA]
        if len(component_sizes) == 0:
            return None

        largest_component_index = 1 + int(np.argmax(component_sizes))
        component_mask = np.where(labels == largest_component_index, 255, 0).astype(np.uint8)

        contours, _ = cv2.findContours(component_mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        svg_path = create_svg_path_from_mask(component_mask, use_external_only=False)
        if not svg_path:
            return None
        color = estimate_component_color(image, component_mask)
        return LayerData(color=color, svg_path=svg_path)
    except Exception as exc:
        print(f'Could not create base layer: {exc}')
        return None


def create_print_layers_from_image(image: Image.Image) -> List[LayerData]:
    """Create a print-oriented layer stack from connected foreground regions."""
    try:
        foreground_mask = create_foreground_mask(image)

        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(foreground_mask, connectivity=8)
        if num_labels <= 1:
            return []

        components = []
        for label_index in range(1, num_labels):
            area = stats[label_index, cv2.CC_STAT_AREA]
            if area < 50:
                continue

            component_mask = np.where(labels == label_index, 255, 0).astype(np.uint8)
            candidate_masks = [component_mask]
            if area > 100:
                eroded_mask = cv2.erode(component_mask, np.ones((3, 3), np.uint8), iterations=1)
                if cv2.countNonZero(eroded_mask) > 20:
                    candidate_masks.append(eroded_mask)

            for mask in candidate_masks:
                svg_path = create_svg_path_from_mask(mask, use_external_only=False)
                if not svg_path:
                    continue
                if any(existing.svg_path == svg_path for _, existing in components):
                    continue
                color = estimate_component_color(image, mask)
                components.append((area, LayerData(color=color, svg_path=svg_path)))

        components.sort(key=lambda item: item[0], reverse=True)
        return [layer for _, layer in components[:4]]
    except Exception as exc:
        print(f'Could not create print layers: {exc}')
        return []

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
    image = Image.open(io.BytesIO(contents)).convert("RGBA")

    # Resize the image to a manageable size for faster processing.
    # This is a crucial step for performance with large images.
    max_size = (512, 512)
    image.thumbnail(max_size)

    base_layer = create_base_layer_from_image(image)
    response_layers: List[LayerData] = []
    if base_layer is not None:
        response_layers.append(base_layer)

    print_layers = create_print_layers_from_image(image)
    for layer in print_layers:
        if layer.svg_path and not any(existing.svg_path == layer.svg_path for existing in response_layers):
            response_layers.append(layer)

    return ProcessImageResponse(filename=file.filename, layers=response_layers)