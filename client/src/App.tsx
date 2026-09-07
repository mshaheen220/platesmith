import { useState, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ThreeCanvas } from './components/viewer/ThreeCanvas';
import { ViewControls } from './components/viewer/ViewControls';
import { Sun, Moon, Circle, Lightbulb } from 'lucide-react';
import { version as appVersion } from '../package.json';

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
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
      const response = await fetch(`${apiBaseUrl}/accumulate-layers/`, {
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
  // height. A filament-swap point sits at the cumulative sum of the layers below it, and
  // a sum of multiples of X is itself a multiple of X - so this is sufficient to put every
  // swap point on an achievable physical layer boundary, not just the ones already close.
  const handleSnapToLayerGrid = () => {
    if (!printerLayerHeightMm || printerLayerHeightMm <= 0) return;

    const snapped = layers.map(layer => {
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
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
      const response = await fetch(`${apiBaseUrl}/export/`, {
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

  const handleImageUpload = async (file: File) => {
    if (!file) return;

    setIsProcessing(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:8001';
      const response = await fetch(`${apiBaseUrl}/process-image/`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Image processing failed on the server.');
      }

      const result: ProcessImageResponse = await response.json();
      console.log('Backend response:', result);

      // Generate new layers from the extracted colors
      const extractedLayers = result.layers.map((layerData, index) => {
        const isBaseLayer = index === 0;
        const name = isBaseLayer ? 'Base Layer' : `Detail Layer ${index}`;
        const newLayer: LayerConfig = {
          id: `layer-${Date.now()}-${index}`,
          name,
          originalColor: layerData.color,
          filamentColorHex: layerData.color,
          layerHeightMm: isBaseLayer ? 1.2 : 0.35,
          zOffsetMm: 0,
          isVisible: true,
          pathData: layerData.svg_path,
        };
        return newLayer;
      });

      if (extractedLayers.length === 1) {
        extractedLayers.push({
          id: `layer-${Date.now()}-detail`,
          name: 'Detail Layer 1',
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
          onDragEnd={handleDragEnd}
          onToggleVisibility={handleToggleLayerVisibility}
          onLayerHeightChange={handleLayerHeightChange}
          maxLayerHeightMm={MAX_LAYER_HEIGHT_MM}
          onSnapToLayerGrid={handleSnapToLayerGrid}
          onLayerColorChange={handleLayerColorChange}
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
