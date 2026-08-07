from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List, Tuple
from pydantic import BaseModel
import io
from PIL import Image
import numpy as np
import cv2
from sklearn.cluster import KMeans

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
    layers: List[LayerData]

def contour_to_path_data(contour: np.ndarray) -> str:
    """Converts a single OpenCV contour into an SVG path data string."""
    # Reshape contour to a list of points and ensure it's clean
    points = contour.reshape(-1, 2)
    if len(points) < 3:
        return ""  # Not a valid shape

    # Start the path with a "move to" command
    path_parts = [f"M {points[0][0]:.2f} {points[0][1]:.2f}"]
    # Add "line to" commands for the rest of the points
    for point in points[1:]:
        path_parts.append(f"L {point[0]:.2f} {point[1]:.2f}")
    # Close the path to form a solid shape
    path_parts.append("Z")
    return " ".join(path_parts)


def create_svg_path_from_mask(mask_array: np.ndarray, width: int, height: int) -> str:
    """
    Converts a binary mask into a full SVG string containing path elements for each contour.
    This version handles complex shapes with holes by using parent-child contour relationships.
    """
    # Find all contours and their hierarchy
    contours, hierarchy = cv2.findContours(
        mask_array, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE
    )

    if not contours or hierarchy is None:
        return ""

    path_data_list = []
    # hierarchy[0] contains [Next, Previous, First_Child, Parent]
    # We iterate through top-level contours (those without a parent)
    i = 0
    while i >= 0:
        contour = contours[i]
        path_data = contour_to_path_data(contour)
        path_data_list.append(path_data)

        # Handle holes (child contours)
        child_i = hierarchy[0][i][2]
        while child_i >= 0:
            hole_contour = contours[child_i]
            hole_path_data = contour_to_path_data(hole_contour)
            path_data_list.append(hole_path_data)
            child_i = hierarchy[0][child_i][0]  # Move to the next sibling hole

        i = hierarchy[0][i][0] # Move to the next top-level contour

    if not path_data_list:
        return ""

    # Combine all paths into one for an even-odd fill rule to handle holes
    full_path_d = " ".join(path_data_list)
    
    # Construct the full SVG string, which is what SVGLoader expects.
    # The fill and fill-rule are important for correct rendering of holes.
    return (
        f'<svg width="{width}" height="{height}" viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg">'
        f'<path d="{full_path_d}" fill="#000" fill-rule="evenodd" />'
        f'</svg>'
    )

@app.get("/")
def read_root() -> Dict[str, str]:
    """A simple endpoint to confirm the server is running."""
    return {"message": "platesmith backend is running!"}

@app.post("/process-image/", response_model=ProcessImageResponse)
async def process_image(file: UploadFile = File(...), num_colors: int = 8) -> ProcessImageResponse:
    """
    Processes an uploaded image to extract color-based layers using K-Means clustering.
    """
    try:
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGBA")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image file.")

    # Resize for performance. thumbnail maintains aspect ratio.
    max_size = (512, 512)
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    
    # Convert image to numpy array, handling transparency
    rgba_image = np.array(image)
    
    # Separate RGB and Alpha channels
    rgb_image = rgba_image[:, :, :3]
    alpha_channel = rgba_image[:, :, 3]

    # We only want to cluster opaque pixels
    opaque_pixels = rgb_image[alpha_channel > 128]
    if len(opaque_pixels) < num_colors:
        num_colors = len(opaque_pixels)
    
    if num_colors == 0:
        return ProcessImageResponse(filename=file.filename, layers=[])

    # Use K-Means to find the dominant colors
    kmeans = KMeans(n_clusters=num_colors, random_state=42, n_init=10)
    kmeans.fit(opaque_pixels)

    # Get the palette (cluster centers) and labels
    palette = kmeans.cluster_centers_.astype(int)
    labels = kmeans.predict(rgb_image.reshape(-1, 3))
    
    # Reshape labels back to image dimensions
    labeled_image = labels.reshape(rgb_image.shape[:2])

    response_layers: List[LayerData] = []
    
    # Create a layer for each color in the palette
    for i, color in enumerate(palette):
        # Create a binary mask for the current cluster
        # Also ensure we respect the original transparency
        mask = np.zeros(rgb_image.shape[:2], dtype=np.uint8)
        mask[(labeled_image == i) & (alpha_channel > 128)] = 255
        
        # Clean up the mask
        mask = cv2.medianBlur(mask, 3)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3,3), np.uint8), iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3,3), np.uint8), iterations=1)
        
        if cv2.countNonZero(mask) < 20: # Ignore tiny, insignificant layers
            continue

        # Convert the mask to an SVG path data string
        svg_path = create_svg_path_from_mask(mask, width=image.width, height=image.height)

        if svg_path:
            hex_color = f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"
            response_layers.append(LayerData(color=hex_color, svg_path=svg_path))
            
    # Sort layers from largest to smallest for a sensible default stacking order
    response_layers.sort(key=lambda layer: len(layer.svg_path), reverse=True)

    return ProcessImageResponse(filename=file.filename, layers=response_layers)