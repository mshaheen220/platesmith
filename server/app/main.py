from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, List
from pydantic import BaseModel
import io
from PIL import Image

app = FastAPI(
    title="stack3d Backend",
    description="Handles image processing and 3D mesh generation for the stack3d application.",
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

# Define a Pydantic model for a structured, type-safe response.
class ProcessImageResponse(BaseModel):
    filename: str
    colors: List[str]

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

@app.get("/")
def read_root() -> Dict[str, str]:
    """A simple endpoint to confirm the server is running."""
    return {"message": "stack3d backend is running!"}

@app.post("/process-image/")
async def process_image(file: UploadFile = File(...), num_colors: int = 8) -> ProcessImageResponse:
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
        return ProcessImageResponse(filename=file.filename, colors=[])
        
    rgb_colors = [tuple(palette[i:i + 3]) for i in range(0, len(palette), 3)]
    initial_hex_colors = [f"#{r:02x}{g:02x}{b:02x}" for r, g, b in rgb_colors[:num_colors]]

    # This threshold can be tuned. Higher values mean more colors will be merged.
    color_distance_threshold = 40.0
    distinct_colors = merge_similar_colors(initial_hex_colors, color_distance_threshold)

    return ProcessImageResponse(filename=file.filename, colors=distinct_colors)