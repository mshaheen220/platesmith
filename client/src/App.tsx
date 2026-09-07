import { useState, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ThreeCanvas } from './components/viewer/ThreeCanvas';
import { ViewControls } from './components/viewer/ViewControls';
import { Sun, Moon, Circle, Lightbulb } from 'lucide-react';
import { version as appVersion } from '../package.json';
import { getImageDimsPxOrNull, buildRectPathData } from './lib/svgGeometry';

import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
// Import types using 'type' keyword for clarity and correct bundling
import type { LayerConfig } from './types/project';

// A single stacked layer this thick isn't a realistic print - these plates are thin,
// mostly-solid color slabs, not tall objects. 10mm covers the realistic high end for a
// lightbox front; 12mm leaves a little headroom without allowing something absurd.
const MAX_LAYER_HEIGHT_MM = 12;

const INITIAL_LAYERS: LayerConfig[] = [
  { id: 'layer-1', name: 'Layer 1 - Black', originalColor: '#000000', filamentColorHex: '#000000', layerHeightMm: 0.8, zOffsetMm: 0, isVisible: true, pathData: '' },
  { id: 'layer-2', name: 'Layer 2 - Red', originalColor: '#ff0000', filamentColorHex: '#ff0000', layerHeightMm: 0.6, zOffsetMm: 0.8, isVisible: true, pathData: '' },
  { id: 'layer-3', name: 'Layer 3 - Yellow', originalColor: '#ffff00', filamentColorHex: '#ffff00', layerHeightMm: 0.6, zOffsetMm: 1.4, isVisible: true, pathData: '' },
  { id: 'layer-4', name: 'Layer 4 - White', originalColor: '#ffffff', filamentColorHex: '#ffffff', layerHeightMm: 0.6, zOffsetMm: 2.0, isVisible: false, pathData: '' },
];

interface LayerData {
  color: string;
  svg_path: string;
  is_background: boolean;
}

interface ProcessImageResponse {
  filename: string;
  layers: LayerData[];
}

// Assigns each layer's stack position. A hidden layer is excluded from the
// physical stack entirely (see ThreeCanvas/export), so it must not consume
// height and leave a gap for the layers above it - it inherits the current
// cumulative height without advancing it.
function computeZOffsets(orderedLayers: LayerConfig[]): LayerConfig[] {
  let cumulativeHeight = 0;
  return orderedLayers.map(layer => {
    const updated = { ...layer, zOffsetMm: cumulativeHeight };
    if (layer.isVisible) {
      cumulativeHeight += layer.layerHeightMm;
    }
    return updated;
  });
}

function App() {
  // State for managing layers
  const [layers, setLayers] = useState<LayerConfig[]>(INITIAL_LAYERS);
  // State for layer selection
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  // State for managing canvas background color
  const [isBacklightOn, setIsBacklightOn] = useState<boolean>(false);
  // State for managing canvas background color
  const [isExplodedView, setIsExplodedView] = useState<boolean>(false);
  // State for API communication
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  // State for managing canvas background color
  const [canvasBgClass, setCanvasBgClass] = useState<'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500'>('bg-gray-700');
  // Real-world width of the plate in mm - the source image's pixel width scales to this on export.
  const [plateWidthMm, setPlateWidthMm] = useState<number>(100);
  // Nozzle/slicer layer height, used only to flag filament-swap points that don't
  // land on an achievable physical layer boundary. Optional - leave blank to skip the check.
  const [printerLayerHeightMm, setPrinterLayerHeightMm] = useState<number | null>(0.2);
  // Many people print a taller first layer for bed adhesion (e.g. 0.24mm first layer,
  // 0.2mm rest) - when set, swap-point math accounts for that one-time offset instead
  // of assuming every physical layer is printerLayerHeightMm tall. Leave blank to
  // assume the first layer is the same height as the rest.
  const [firstLayerHeightMm, setFirstLayerHeightMm] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const fitToContentRef = useRef<(() => void) | null>(null);

  const handleToggleLayerSelection = (layerId: string) => {
    setSelectedLayerIds(prev =>
      prev.includes(layerId)
        ? prev.filter(id => id !== layerId)
        : [...prev, layerId]
    );
  };

  // Recomputes each visible layer's printable (support-aware) footprint: its own
  // shape unioned with everything stacked above it. Must be re-run any time
  // stacking order or layer inclusion changes (upload, merge, reorder, visibility) -
  // it does NOT need to run for height/color changes, since those don't affect
  // any layer's footprint.
  const accumulateLayers = async (layersToAccumulate: LayerConfig[]) => {
    const visibleLayers = layersToAccumulate.filter(layer => layer.isVisible && layer.pathData);
    if (visibleLayers.length === 0) return;

    try {
      const response = await fetch('/api/accumulate-layers/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layers: visibleLayers.map(layer => ({ id: layer.id, svg_path: layer.pathData })),
        }),
      });

      if (!response.ok) {
        throw new Error('Accumulation failed on the server.');
      }

      const result: { layers: { id: string; svg_path: string }[] } = await response.json();
      const accumulatedById = new Map(result.layers.map(layer => [layer.id, layer.svg_path]));

      setLayers(currentLayers =>
        currentLayers.map(layer =>
          accumulatedById.has(layer.id)
            ? { ...layer, accumulatedPathData: accumulatedById.get(layer.id) }
            : layer
        )
      );
    } catch (error) {
      console.error('Error accumulating layers:', error);
    }
  };

  const handleMergeLayers = () => {
    if (selectedLayerIds.length < 2) return;

    const layersToMerge = layers.filter(layer => selectedLayerIds.includes(layer.id));
    const remainingLayers = layers.filter(layer => !selectedLayerIds.includes(layer.id));

    const baseLayer = layersToMerge.reduce((acc, layer) =>
      ((layer.pathData ?? '').length > (acc.pathData ?? '').length) ? layer : acc
    );

    const extractPathD = (svgString: string) => {
      const match = svgString.match(/<path d="([^"]+)"/);
      return match ? match[1] : '';
    };

    const allPathDs = layersToMerge.map(layer => extractPathD(layer.pathData ?? '')).join(' ');
    const { width, height } = (baseLayer.pathData ?? '').match(/<svg width="(?<width>\d+)" height="(?<height>\d+)"/)?.groups ?? { width: 300, height: 300 };

    // Merging an already-merged layer flattens its stored originals in rather than
    // nesting them, so mergedFrom always holds leaf layers and one Unmerge click
    // fully restores everything that ever went into this layer.
    const mergedFrom = layersToMerge.flatMap(layer => layer.mergedFrom ?? [layer]);

    const mergedLayer: LayerConfig = {
      ...baseLayer,
      id: `layer-merged-${Date.now()}`,
      name: `${baseLayer.name} (Merged)`,
      pathData: `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><path d="${allPathDs}" fill="#000" fill-rule="evenodd" /></svg>`,
      accumulatedPathData: undefined,
      mergedFrom,
    };

    const insertIndex = layers.findIndex(l => l.id === baseLayer.id);
    remainingLayers.splice(insertIndex, 0, mergedLayer);

    const newLayers = computeZOffsets(remainingLayers);

    setLayers(newLayers);
    setSelectedLayerIds([]);
    accumulateLayers(newLayers);
  };

  const handleUnmergeLayer = (layerId: string) => {
    const index = layers.findIndex(l => l.id === layerId);
    const target = layers[index];
    if (!target?.mergedFrom || target.mergedFrom.length === 0) return;

    const restored = [...layers];
    restored.splice(index, 1, ...target.mergedFrom);

    const newLayers = computeZOffsets(restored);
    setLayers(newLayers);
    setSelectedLayerIds([]);
    accumulateLayers(newLayers);
  };

  const handleToggleLayerVisibility = (layerId: string) => {
    const toggled = layers.map(layer =>
      layer.id === layerId ? { ...layer, isVisible: !layer.isVisible } : layer
    );
    // A hidden layer is excluded from the stack entirely - both its stacking
    // height (no gap left behind) and its contribution to accumulation above it.
    const newLayers = computeZOffsets(toggled);
    setLayers(newLayers);
    accumulateLayers(newLayers);
  };

  const handleLayerHeightChange = (layerId: string, newHeight: number) => {
    setLayers(currentLayers => {
      if (isNaN(newHeight) || newHeight < 0 || !currentLayers.some(l => l.id === layerId)) {
        return currentLayers;
      }

      const clampedHeight = Math.min(newHeight, MAX_LAYER_HEIGHT_MM);
      const updated = currentLayers.map(layer =>
        layer.id === layerId ? { ...layer, layerHeightMm: clampedHeight } : layer
      );

      return computeZOffsets(updated);
    });
  };

  // Rounds every layer's height to the nearest multiple of the printer's slicer layer
  // height, so the cumulative Z at every swap point lands on an achievable physical
  // layer boundary (a sum of multiples of X is itself a multiple of X). The bottommost
  // visible layer is special-cased against firstLayerHeightMm instead, when set - it's
  // physically the first layer printed, so its height determines where the *second*
  // layer boundary falls (firstLayerHeightMm + k*printerLayerHeightMm), not a plain
  // multiple of printerLayerHeightMm. Rounding every other layer to plain multiples on
  // top of that still keeps every later cumulative Z on that same offset grid.
  const handleSnapToLayerGrid = () => {
    if (!printerLayerHeightMm || printerLayerHeightMm <= 0) return;
    const effectiveFirstLayerHeightMm =
      firstLayerHeightMm && firstLayerHeightMm > 0 ? firstLayerHeightMm : printerLayerHeightMm;
    const firstVisibleIndex = layers.findIndex(l => l.isVisible);

    const snapped = layers.map((layer, index) => {
      if (index === firstVisibleIndex) {
        const extraLayers = Math.max(
          0,
          Math.round((layer.layerHeightMm - effectiveFirstLayerHeightMm) / printerLayerHeightMm)
        );
        return { ...layer, layerHeightMm: effectiveFirstLayerHeightMm + extraLayers * printerLayerHeightMm };
      }
      const layerCount = Math.max(1, Math.round(layer.layerHeightMm / printerLayerHeightMm));
      return { ...layer, layerHeightMm: layerCount * printerLayerHeightMm };
    });

    setLayers(computeZOffsets(snapped));
  };

  const handleDragEnd = (result: { destination: any; source: any; }) => {
    const { destination, source } = result;
    if (!destination) return;

    const reordered = [...layers];
    const [movedLayer] = reordered.splice(source.index, 1);
    reordered.splice(destination.index, 0, movedLayer);

    const newLayers = computeZOffsets(reordered);

    setLayers(newLayers);
    // Reordering changes which layers are "above" which, so every layer's
    // accumulated footprint needs to be recomputed.
    accumulateLayers(newLayers);
  };

  const handleToggleCanvasBackground = () => {
    setCanvasBgClass(prev => {
      if (prev === 'bg-gray-700') return 'bg-gray-200'; // Dark -> Light
      if (prev === 'bg-gray-200') return 'bg-gray-500'; // Light -> Neutral
      return 'bg-gray-700'; // Neutral -> Dark (cycle back)
    });
  };

  const handleLayerColorChange = (layerId: string, newColor: string) => {
    setLayers(currentLayers =>
      currentLayers.map(layer =>
        layer.id === layerId ? { ...layer, filamentColorHex: newColor } : layer
      )
    );
  };

  const handleLayerNameChange = (layerId: string, newName: string) => {
    setLayers(currentLayers =>
      currentLayers.map(layer =>
        layer.id === layerId ? { ...layer, name: newName } : layer
      )
    );
  };

  const handleToggleBacklight = () => {
    setIsBacklightOn(prev => !prev);
  };

  const handleToggleExplodedView = () => {
    setIsExplodedView(prev => !prev);
  };

  const handleExport = async () => {
    const visibleLayers = layers.filter(layer => layer.isVisible && layer.pathData);
    if (visibleLayers.length === 0) return;

    setIsExporting(true);
    try {
      const response = await fetch('/api/export/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layers: visibleLayers.map(layer => ({
            id: layer.id,
            name: layer.name,
            svg_path: layer.pathData,
            layer_height_mm: layer.layerHeightMm,
            z_offset_mm: layer.zOffsetMm,
            color_hex: layer.filamentColorHex,
          })),
          plate_width_mm: plateWidthMm,
          printer_layer_height_mm: printerLayerHeightMm,
          first_layer_height_mm: firstLayerHeightMm,
        }),
      });

      if (!response.ok) {
        throw new Error('Export failed on the server.');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'platesmith_export.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error exporting plate:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // Adds or removes a full-canvas rectangle of clear/natural filament as the
  // bottommost layer, to diffuse the backlight evenly before it reaches the color
  // layers above. Pure geometry - no image analysis needed - so this can be a
  // simple client-side toggle rather than requiring a re-upload.
  const handleToggleDiffuserLayer = () => {
    const hasDiffuser = layers.some(layer => layer.isDiffuser);

    let newLayers: LayerConfig[];
    if (hasDiffuser) {
      newLayers = computeZOffsets(layers.filter(layer => !layer.isDiffuser));
    } else {
      const dims = getImageDimsPxOrNull(layers);
      if (!dims) return; // no image processed yet - nothing to size the diffuser to

      const diffuserLayer: LayerConfig = {
        id: `layer-diffuser-${Date.now()}`,
        name: 'Diffuser Base',
        originalColor: '#f2f2f2',
        filamentColorHex: '#f2f2f2',
        layerHeightMm: 0.4,
        zOffsetMm: 0,
        isVisible: true,
        isDiffuser: true,
        pathData: buildRectPathData(dims.width, dims.height),
      };
      newLayers = computeZOffsets([diffuserLayer, ...layers]);
    }

    setLayers(newLayers);
    accumulateLayers(newLayers);
  };

  const handleImageUpload = async (file: File, backgroundColorHex?: string) => {
    if (!file) return;

    setIsProcessing(true);
    const formData = new FormData();
    formData.append('file', file);
    if (backgroundColorHex) {
      formData.append('background_color', backgroundColorHex);
    }

    try {
      const response = await fetch('/api/process-image/', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Image processing failed on the server.');
      }

      const result: ProcessImageResponse = await response.json();
      console.log('Backend response:', result);

      // Generate new layers from the extracted colors. "Layer N" rather than the old
      // "Base Layer" for index 0 - that name collided with the diffuser's "Diffuser
      // Base", implying they were the same kind of thing when they aren't.
      const extractedLayers = result.layers.map((layerData, index) => {
        const isBaseLayer = index === 0;
        const name = layerData.is_background ? 'Background' : `Layer ${index + 1}`;
        const newLayer: LayerConfig = {
          id: `layer-${Date.now()}-${index}`,
          name,
          originalColor: layerData.color,
          filamentColorHex: layerData.color,
          layerHeightMm: isBaseLayer ? 1.2 : 0.35,
          zOffsetMm: 0,
          isVisible: true,
          isBackgroundFill: layerData.is_background,
          pathData: layerData.svg_path,
        };
        return newLayer;
      });

      if (extractedLayers.length === 1) {
        extractedLayers.push({
          id: `layer-${Date.now()}-detail`,
          name: 'Layer 2',
          originalColor: '#000000',
          filamentColorHex: '#000000',
          layerHeightMm: 0.35,
          zOffsetMm: 0,
          isVisible: true,
          pathData: extractedLayers[0].pathData,
        });
      }

      const newLayers = computeZOffsets(extractedLayers);
      setLayers(newLayers);
      accumulateLayers(newLayers);
    } catch (error) {
      console.error('Error uploading image:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="bg-gray-900 text-white h-screen flex flex-col font-sans">
      <header className="bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center gap-3">
        <img src="/favicon/favicon.svg" alt="platesmith logo" className="h-6 w-6" />
        <h1 className="text-xl font-bold tracking-tight flex items-baseline gap-2">
          platesmith
          <span className="text-xs font-normal text-gray-500">v{appVersion}</span>
          {/* Optional: Add a small indicator for the current background mode */}
          {isBacklightOn ?
            <Lightbulb className="ml-2 inline-block h-4 w-4 text-yellow-400" /> :
            canvasBgClass === 'bg-gray-700' ?
            <Moon className="ml-2 inline-block h-4 w-4 text-gray-400" /> :
            canvasBgClass === 'bg-gray-200' ?
              <Sun className="ml-2 inline-block h-4 w-4 text-yellow-400" /> :
              <Circle className="ml-2 inline-block h-4 w-4 text-gray-400" />}
        </h1>
      </header>
      {/* This container is the key to the layout. `flex-1` makes it fill vertical space.
          `overflow-hidden` is added to ensure its children are strictly contained. */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          layers={layers} // Pass layers data
          onImageUpload={handleImageUpload}
          isProcessing={isProcessing}
          selectedLayerIds={selectedLayerIds}
          onToggleLayerSelection={handleToggleLayerSelection}
          onMergeLayers={handleMergeLayers}
          onUnmergeLayer={handleUnmergeLayer}
          onToggleDiffuserLayer={handleToggleDiffuserLayer}
          onDragEnd={handleDragEnd}
          onToggleVisibility={handleToggleLayerVisibility}
          onLayerHeightChange={handleLayerHeightChange}
          maxLayerHeightMm={MAX_LAYER_HEIGHT_MM}
          onSnapToLayerGrid={handleSnapToLayerGrid}
          onLayerColorChange={handleLayerColorChange}
          onLayerNameChange={handleLayerNameChange}
          // Pass exploded view state and handler
          isExplodedView={isExplodedView}
          onToggleExplodedView={handleToggleExplodedView}
          // Pass backlight state and handler
          isBacklightOn={isBacklightOn}
          onToggleBacklight={handleToggleBacklight}
          onToggleCanvasBackground={handleToggleCanvasBackground} currentCanvasBgClass={canvasBgClass}
          // Plate/export settings
          plateWidthMm={plateWidthMm}
          onPlateWidthChange={setPlateWidthMm}
          printerLayerHeightMm={printerLayerHeightMm}
          onPrinterLayerHeightChange={setPrinterLayerHeightMm}
          firstLayerHeightMm={firstLayerHeightMm}
          onFirstLayerHeightChange={setFirstLayerHeightMm}
          onExport={handleExport}
          isExporting={isExporting} />
        {/* The main content area is now a relative container for the canvas and its overlay controls */}
        <main className="relative flex-1 flex flex-col">
          <ThreeCanvas layers={layers} canvasBgClass={canvasBgClass} isExplodedView={isExplodedView} isBacklightOn={isBacklightOn} controlsRef={controlsRef} plateWidthMm={plateWidthMm} fitToContentRef={fitToContentRef} />
          <ViewControls controlsRef={controlsRef} fitToContentRef={fitToContentRef} />
        </main>
      </div>
    </div>
  )
}

export default App
