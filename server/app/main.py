from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel
import io
import json
import re
import zipfile
from PIL import Image
import numpy as np
import cv2
import trimesh
from shapely.affinity import scale as shapely_scale
from shapely.geometry import MultiPolygon, Polygon as ShapelyPolygon
from shapely.ops import unary_union
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
    # True for the synthetic layer built from the image's transparent region (an
    # "outside color" the caller opted into), as opposed to a color extracted from
    # opaque pixels via clustering. Lets the frontend name it distinctly.
    is_background: bool = False

class ProcessImageResponse(BaseModel):
    filename: str
    layers: List[LayerData]


def relative_luminance(color) -> float:
    """Perceptual brightness (ITU-R BT.601 luma) of an RGB color (any 3-length
    r,g,b sequence - a numpy array row or a plain tuple), used to order extracted
    layers from brightest (base) to darkest (top) by default."""
    r, g, b = int(color[0]), int(color[1]), int(color[2])
    return 0.299 * r + 0.587 * g + 0.114 * b


def parse_hex_color(value: str) -> Tuple[int, int, int]:
    """Parses a "#rrggbb" (or "rrggbb") string into an (r, g, b) int tuple."""
    cleaned = value.strip().lstrip("#")
    if len(cleaned) != 6:
        raise HTTPException(status_code=400, detail="background_color must be a hex color like #rrggbb.")
    try:
        return (int(cleaned[0:2], 16), int(cleaned[2:4], 16), int(cleaned[4:6], 16))
    except ValueError:
        raise HTTPException(status_code=400, detail="background_color must be a hex color like #rrggbb.")


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

_SVG_DIMS_RE = re.compile(r'width="(\d+(?:\.\d+)?)"\s+height="(\d+(?:\.\d+)?)"')
_SVG_PATH_D_RE = re.compile(r'<path d="([^"]+)"')
_SVG_NUMBER_RE = re.compile(r'-?\d+\.?\d*')


def parse_svg_path_to_subpaths(svg_string: str) -> List[List[Tuple[float, float]]]:
    """
    Parses the "M x y L x y ... Z" path data produced by this backend (and by the
    frontend's layer-merge step, which just concatenates such strings) back into
    a list of point-lists, one per subpath.
    """
    match = _SVG_PATH_D_RE.search(svg_string)
    if not match:
        return []

    d = match.group(1)
    subpaths = []
    for chunk in re.split(r"(?=M)", d.strip()):
        if not chunk.strip():
            continue
        nums = [float(n) for n in _SVG_NUMBER_RE.findall(chunk)]
        points = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        if len(points) >= 3:
            subpaths.append(points)
    return subpaths


def rasterize_evenodd(
    subpaths: List[List[Tuple[float, float]]], width: int, height: int
) -> np.ndarray:
    """
    Rasterizes a set of (possibly nested) subpaths using the SVG even-odd fill rule.
    Even-odd fill of nested polygons is equivalent to XOR-ing each subpath's own
    filled raster in turn, so this needs no hole/hierarchy metadata to be correct.
    """
    mask = np.zeros((height, width), dtype=np.uint8)
    for points in subpaths:
        subpath_mask = np.zeros((height, width), dtype=np.uint8)
        int_points = np.array(points, dtype=np.int32).reshape(-1, 1, 2)
        cv2.fillPoly(subpath_mask, [int_points], 255)
        mask = cv2.bitwise_xor(mask, subpath_mask)
    return mask


def accumulate_top_down(masks: List[Tuple[str, np.ndarray]]) -> Dict[str, np.ndarray]:
    """
    Given per-layer masks ordered bottom-to-top, returns each layer's printable
    footprint: its own mask unioned with every mask above it in the stack.
    Shared by the preview accumulation endpoint and STL export so the two can
    never drift apart.
    """
    if not masks:
        return {}
    running_union = np.zeros_like(masks[0][1])
    accumulated_by_id: Dict[str, np.ndarray] = {}
    for lid, mask in reversed(masks):
        running_union = cv2.bitwise_or(running_union, mask)
        accumulated_by_id[lid] = running_union.copy()
    return accumulated_by_id


def mask_to_polygon(mask: np.ndarray):
    """
    Converts a binary mask into a shapely (Multi)Polygon, preserving holes via
    the same parent/child contour hierarchy used elsewhere in this file.
    """
    contours, hierarchy = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
    if not contours or hierarchy is None:
        return None

    polygons = []
    hierarchy = hierarchy[0]
    for i, h in enumerate(hierarchy):
        if h[3] != -1:
            continue  # a hole; it's picked up below via its parent
        exterior = contours[i].reshape(-1, 2)
        if len(exterior) < 3:
            continue
        holes = []
        child = h[2]
        while child != -1:
            hole_points = contours[child].reshape(-1, 2)
            if len(hole_points) >= 3:
                holes.append(hole_points)
            child = hierarchy[child][0]
        polygon = ShapelyPolygon(exterior, holes)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if not polygon.is_empty:
            polygons.append(polygon)

    if not polygons:
        return None
    return unary_union(polygons)


def extrude_mask_to_mesh(
    mask: np.ndarray, layer_height_mm: float, z_offset_mm: float, scale_mm_per_px: float
) -> Optional[trimesh.Trimesh]:
    """
    Extrudes a mask's accumulated footprint into a solid mesh, scaled from pixel
    space into real-world mm and positioned at its stack height. The Y axis is
    flipped to match the frontend preview's SVG-to-scene transform (ThreeCanvas
    negates Y for the same reason: SVG/raster Y grows downward, and left uncorrected
    the printed image would render upside down).
    """
    if layer_height_mm <= 0:
        return None

    geometry = mask_to_polygon(mask)
    if geometry is None or geometry.is_empty:
        return None

    scaled = shapely_scale(geometry, xfact=scale_mm_per_px, yfact=-scale_mm_per_px, origin=(0, 0))

    polygons = list(scaled.geoms) if isinstance(scaled, MultiPolygon) else [scaled]
    meshes = [
        trimesh.creation.extrude_polygon(polygon, height=layer_height_mm)
        for polygon in polygons
        if not polygon.is_empty and polygon.area > 0
    ]
    if not meshes:
        return None

    mesh = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
    mesh.apply_translation([0, 0, z_offset_mm])
    return mesh


class AccumulateLayerInput(BaseModel):
    id: str
    svg_path: str


class AccumulateRequest(BaseModel):
    # Layers ordered bottom-to-top, matching the frontend's stacking order.
    layers: List[AccumulateLayerInput]


class AccumulatedLayer(BaseModel):
    id: str
    svg_path: str


class AccumulateResponse(BaseModel):
    layers: List[AccumulatedLayer]


@app.post("/api/accumulate-layers/", response_model=AccumulateResponse)
def accumulate_layers(request: AccumulateRequest) -> AccumulateResponse:
    """
    Computes each layer's printable footprint as the union of its own shape with
    every layer stacked above it. This is the physical requirement for FDM stacks:
    material at a given XY position must be present at every height below the
    highest feature at that position, regardless of which color put it there.
    """
    if not request.layers:
        return AccumulateResponse(layers=[])

    width: Optional[int] = None
    height: Optional[int] = None
    parsed: List[Tuple[str, List[List[Tuple[float, float]]]]] = []

    for layer in request.layers:
        subpaths = parse_svg_path_to_subpaths(layer.svg_path)
        if width is None:
            dims = _SVG_DIMS_RE.search(layer.svg_path)
            if dims:
                width = int(round(float(dims.group(1))))
                height = int(round(float(dims.group(2))))
        parsed.append((layer.id, subpaths))

    if width is None or height is None:
        # No layer carried usable geometry (e.g. placeholder/demo layers) -
        # nothing to accumulate, so pass shapes through unchanged.
        return AccumulateResponse(
            layers=[AccumulatedLayer(id=l.id, svg_path=l.svg_path) for l in request.layers]
        )

    masks = [(lid, rasterize_evenodd(subpaths, width, height)) for lid, subpaths in parsed]
    accumulated_by_id = accumulate_top_down(masks)

    result_layers = [
        AccumulatedLayer(
            id=lid,
            svg_path=create_svg_path_from_mask(accumulated_by_id[lid], width=width, height=height),
        )
        for lid, _ in masks
    ]

    return AccumulateResponse(layers=result_layers)


class ExportLayerInput(BaseModel):
    id: str
    name: str
    svg_path: str
    layer_height_mm: float
    z_offset_mm: float
    color_hex: str


class ExportRequest(BaseModel):
    # Layers ordered bottom-to-top, matching the frontend's stacking order.
    layers: List[ExportLayerInput]
    plate_width_mm: float
    # Optional nozzle/slicer layer height, used only to flag filament-swap
    # points that don't land on an achievable physical layer boundary.
    printer_layer_height_mm: Optional[float] = None
    # Many printer profiles use a taller first layer for bed adhesion. When set,
    # physical layer boundaries are computed as first_layer_height_mm +
    # k*printer_layer_height_mm instead of plain multiples of printer_layer_height_mm.
    # Leave unset to assume the first layer is the same height as the rest.
    first_layer_height_mm: Optional[float] = None


def _safe_filename_part(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "_", name).strip("_")
    return cleaned or "layer"


def _build_export_readme(manifest: dict) -> str:
    lines = [
        "platesmith export",
        "==================",
        f"Plate width: {manifest['plate_width_mm']}mm",
        f"Total stack height: {manifest['total_height_mm']}mm",
    ]
    if manifest["printer_layer_height_mm"]:
        lines.append(f"Printer layer height: {manifest['printer_layer_height_mm']}mm")
    if manifest.get("first_layer_height_mm"):
        lines.append(f"First layer height: {manifest['first_layer_height_mm']}mm")
    if manifest.get("assembled_filename"):
        lines.append(
            f"Assembled preview: {manifest['assembled_filename']} - the whole stack in one file, "
            "correctly positioned, for looking at as a whole. It has no color information (STL can't "
            "carry that) and is not meant to be sliced - slice the per-layer STLs below, one at a time."
        )
    lines.append("")
    lines.append("Layers (bottom to top):")
    for layer in manifest["layers"]:
        lines.append(
            f"  {layer['order']:>2}. {layer['name']:<24} {layer['color_hex']:<8} "
            f"z {layer['z_start_mm']:.2f}-{layer['z_end_mm']:.2f}mm  "
            f"[{layer['filename'] or layer['status']}]"
        )
    lines.append("")
    lines.append(
        "Filament swap points (if your slicer inserts a pause/color-change \"at layer N\","
    )
    lines.append(
        "that means before layer N starts printing - use the print layer number below):"
    )
    if not manifest["filament_swap_points"]:
        lines.append("  (none - single-layer plate)")
    for point in manifest["filament_swap_points"]:
        note = ""
        layer_note = ""
        if "aligned_to_printer_layer_height" in point:
            if point["aligned_to_printer_layer_height"]:
                note = "  [OK: lands on a printer layer boundary]"
                layer_note = f"  -> at print layer {point['print_layer_number']}"
            else:
                note = (
                    "  [WARNING: does not land on a printer layer boundary - "
                    "adjust layer heights or the printer layer height]"
                )
        lines.append(
            f"  z = {point['pause_at_z_mm']}mm  "
            f"(between \"{point['after_layer']}\" and \"{point['before_layer']}\"){note}{layer_note}"
        )
    return "\n".join(lines) + "\n"


@app.post("/api/export/")
def export_plate(request: ExportRequest) -> StreamingResponse:
    """
    Builds one STL per layer - each extruded from that layer's accumulated
    (support-aware) footprint, scaled to real-world mm and positioned at its
    stack height - plus a manifest of the filament-swap Z heights between
    layers, and returns it all as a zip.
    """
    if not request.layers:
        raise HTTPException(status_code=400, detail="No layers to export.")
    if request.plate_width_mm <= 0:
        raise HTTPException(status_code=400, detail="plate_width_mm must be positive.")

    width: Optional[int] = None
    height: Optional[int] = None
    parsed: List[Tuple[str, List[List[Tuple[float, float]]]]] = []

    for layer in request.layers:
        subpaths = parse_svg_path_to_subpaths(layer.svg_path)
        if width is None:
            dims = _SVG_DIMS_RE.search(layer.svg_path)
            if dims:
                width = int(round(float(dims.group(1))))
                height = int(round(float(dims.group(2))))
        parsed.append((layer.id, subpaths))

    if width is None or height is None:
        raise HTTPException(status_code=400, detail="No layer geometry to export.")

    masks = [(lid, rasterize_evenodd(subpaths, width, height)) for lid, subpaths in parsed]
    accumulated_by_id = accumulate_top_down(masks)
    scale_mm_per_px = request.plate_width_mm / width

    manifest_layers = []
    total_height_mm = 0.0
    zip_buffer = io.BytesIO()
    # Each layer's mesh is already positioned at its real world-space Z (see
    # extrude_mask_to_mesh's translate), so concatenating them all reproduces the
    # assembled stack exactly - no re-alignment needed. This is a reference/preview
    # mesh only (multiple watertight shells in one file, no per-shell color data -
    # STL has no standard way to carry that) - the per-layer STLs are still what
    # actually gets sliced and printed one color at a time.
    meshes_for_assembly: List[trimesh.Trimesh] = []

    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for index, layer in enumerate(request.layers):
            mask = accumulated_by_id.get(layer.id)
            mesh = (
                extrude_mask_to_mesh(mask, layer.layer_height_mm, layer.z_offset_mm, scale_mm_per_px)
                if mask is not None
                else None
            )

            filename = f"{index + 1:02d}_{_safe_filename_part(layer.name)}_{layer.color_hex.lstrip('#')}.stl"
            if mesh is not None and len(mesh.faces) > 0:
                zf.writestr(filename, mesh.export(file_type="stl"))
                meshes_for_assembly.append(mesh)
                status = "exported"
            else:
                filename = None
                status = "empty (no geometry at this position)"

            z_end = layer.z_offset_mm + layer.layer_height_mm
            manifest_layers.append(
                {
                    "order": index + 1,
                    "id": layer.id,
                    "name": layer.name,
                    "filename": filename,
                    "color_hex": layer.color_hex,
                    "layer_height_mm": layer.layer_height_mm,
                    "z_start_mm": round(layer.z_offset_mm, 4),
                    "z_end_mm": round(z_end, 4),
                    "status": status,
                }
            )
            total_height_mm = max(total_height_mm, z_end)

        swap_points = []
        for i in range(len(request.layers) - 1):
            z = round(request.layers[i].z_offset_mm + request.layers[i].layer_height_mm, 4)
            point = {
                "after_layer": request.layers[i].name,
                "before_layer": request.layers[i + 1].name,
                "pause_at_z_mm": z,
            }
            if request.printer_layer_height_mm and request.printer_layer_height_mm > 0:
                # Physical layer boundaries sit at first_layer_height_mm +
                # k*printer_layer_height_mm - a taller first layer (common for bed
                # adhesion) shifts every later boundary by that one-time offset, so this
                # isn't just z % printer_layer_height_mm once a first-layer height is set.
                effective_first_layer_height_mm = (
                    request.first_layer_height_mm
                    if request.first_layer_height_mm and request.first_layer_height_mm > 0
                    else request.printer_layer_height_mm
                )
                offset = z - effective_first_layer_height_mm
                if offset < -1e-3:
                    aligned = False
                    point["aligned_to_printer_layer_height"] = False
                    point["print_layer_number"] = None
                else:
                    clamped_offset = max(0.0, offset)
                    remainder = clamped_offset % request.printer_layer_height_mm
                    aligned = min(remainder, request.printer_layer_height_mm - remainder) < 1e-3
                    point["aligned_to_printer_layer_height"] = bool(aligned)
                    # Slicers that let you insert a pause "at layer N" trigger it BEFORE
                    # layer N prints, so this is completed-layers + 1 - the number to
                    # actually enter, not the completed-layer count (which would pause
                    # one layer too early).
                    completed_layers = 1 + clamped_offset / request.printer_layer_height_mm
                    point["print_layer_number"] = round(completed_layers) + 1 if aligned else None
            swap_points.append(point)

        assembled_filename = None
        if meshes_for_assembly:
            assembled_mesh = (
                trimesh.util.concatenate(meshes_for_assembly)
                if len(meshes_for_assembly) > 1
                else meshes_for_assembly[0]
            )
            assembled_filename = "00_assembled_preview.stl"
            zf.writestr(assembled_filename, assembled_mesh.export(file_type="stl"))

        manifest = {
            "plate_width_mm": request.plate_width_mm,
            "total_height_mm": round(total_height_mm, 4),
            "printer_layer_height_mm": request.printer_layer_height_mm,
            "first_layer_height_mm": request.first_layer_height_mm,
            "assembled_filename": assembled_filename,
            "layers": manifest_layers,
            "filament_swap_points": swap_points,
        }
        zf.writestr("manifest.json", json.dumps(manifest, indent=2))
        zf.writestr("README.txt", _build_export_readme(manifest))

    zip_buffer.seek(0)
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=platesmith_export.zip"},
    )


@app.get("/api/health")
def read_root() -> Dict[str, str]:
    """A simple endpoint to confirm the server is running."""
    return {"message": "platesmith backend is running!"}

@app.post("/api/process-image/", response_model=ProcessImageResponse)
async def process_image(
    file: UploadFile = File(...),
    num_colors: int = Form(8),
    # Optional "outside color": fills the image's transparent region as its own layer,
    # so a subject cut out on a transparent background becomes a solid rectangular
    # plate instead of a subject-shaped void. Must be requested at upload time - the
    # source image isn't retained server-side afterward, so this can't be added later.
    background_color: Optional[str] = Form(None),
) -> ProcessImageResponse:
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

    layers_with_luminance: List[Tuple[float, LayerData]] = []

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
            layers_with_luminance.append(
                (relative_luminance(color), LayerData(color=hex_color, svg_path=svg_path))
            )

    if background_color:
        bg_rgb = parse_hex_color(background_color)
        outside_mask = np.zeros(rgb_image.shape[:2], dtype=np.uint8)
        outside_mask[alpha_channel <= 128] = 255

        if cv2.countNonZero(outside_mask) >= 20:  # skip if the image has no real transparency
            outside_svg_path = create_svg_path_from_mask(outside_mask, width=image.width, height=image.height)
            if outside_svg_path:
                bg_hex = f"#{bg_rgb[0]:02x}{bg_rgb[1]:02x}{bg_rgb[2]:02x}"
                layers_with_luminance.append(
                    (relative_luminance(bg_rgb), LayerData(color=bg_hex, svg_path=outside_svg_path, is_background=True))
                )

    # Brightest color first (becomes the base/bottom layer, closest to a backlight),
    # darkest last (becomes the topmost/front layer, closest to the viewer). This
    # matters beyond aesthetics: the accumulation engine gives the base layer's
    # printed footprint the full silhouette of the whole design, so a dark base
    # would block backlight across the entire piece regardless of the colors above
    # it. A dark color at the top only darkens its own pixels, since nothing needs
    # to inherit its footprint - so that's where detail/outline colors belong.
    layers_with_luminance.sort(key=lambda pair: pair[0], reverse=True)
    response_layers = [layer for _, layer in layers_with_luminance]

    return ProcessImageResponse(filename=file.filename, layers=response_layers)


# Serves the built frontend (Docker: the multi-stage build copies client/dist here)
# so the whole app - UI and API - runs as a single process on one port, matching
# how the other local 3D-printing tools are containerized. Mounted last, and only
# if actually present, so it's a no-op in local dev (Vite's own dev server serves
# the frontend there instead, proxying /api/* to this backend - see vite.config.ts).
# Being registered after every /api/* route means those still take priority; this
# StaticFiles(html=True) mount only catches whatever they don't.
_frontend_dist = Path(__file__).resolve().parent / "static"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")