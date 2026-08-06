import { useState, useRef } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { ThreeCanvas } from './components/viewer/ThreeCanvas';
import { ViewControls } from './components/viewer/ViewControls';
import { Sun, Moon, Circle, Lightbulb, LightbulbOff, Upload } from 'lucide-react';

import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
// Import types using 'type' keyword for clarity and correct bundling
import type { LayerConfig } from './types/project';

const INITIAL_LAYERS: LayerConfig[] = [
  { id: 'layer-1', name: 'Layer 1 - Black', originalColor: '#000000', filamentColorHex: '#000000', layerHeightMm: 0.8, zOffsetMm: 0, opacity: 1, isVisible: true, pathData: '' },
  { id: 'layer-2', name: 'Layer 2 - Red', originalColor: '#ff0000', filamentColorHex: '#ff0000', layerHeightMm: 0.6, zOffsetMm: 0.8, opacity: 1, isVisible: true, pathData: '' },
  { id: 'layer-3', name: 'Layer 3 - Yellow', originalColor: '#ffff00', filamentColorHex: '#ffff00', layerHeightMm: 0.6, zOffsetMm: 1.4, opacity: 1, isVisible: true, pathData: '' },
  { id: 'layer-4', name: 'Layer 4 - White', originalColor: '#ffffff', filamentColorHex: '#ffffff', layerHeightMm: 0.6, zOffsetMm: 2.0, opacity: 1, isVisible: false, pathData: '' },
];

interface LayerData {
  color: string;
  svg_path: string;
}

interface ProcessImageResponse {
  filename: string;
  layers: LayerData[];
}

function App() {
  // State for managing layers
  const [layers, setLayers] = useState<LayerConfig[]>(INITIAL_LAYERS);
  // State for managing canvas background color
  const [isBacklightOn, setIsBacklightOn] = useState<boolean>(false);
  // State for managing canvas background color
  const [isExplodedView, setIsExplodedView] = useState<boolean>(false);
  // State for API communication
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  // State for managing canvas background color
  const [canvasBgClass, setCanvasBgClass] = useState<'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500'>('bg-gray-700');
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const handleToggleLayerVisibility = (layerId: string) => {
    setLayers(currentLayers =>
      currentLayers.map(layer =>
        layer.id === layerId ? { ...layer, isVisible: !layer.isVisible } : layer
      )
    );
  };

  const handleLayerHeightChange = (layerId: string, newHeight: number) => {
    setLayers(currentLayers => {
      const newLayers = [...currentLayers];
      const layerIndex = newLayers.findIndex(l => l.id === layerId);

      // Guard against invalid inputs
      if (layerIndex === -1 || isNaN(newHeight) || newHeight < 0) {
        return currentLayers;
      }

      // 1. Update the height of the target layer
      newLayers[layerIndex] = { ...newLayers[layerIndex], layerHeightMm: newHeight };

      // 2. Recalculate Z-offsets for all subsequent layers to ensure they stack correctly
      for (let i = layerIndex + 1; i < newLayers.length; i++) {
        const prevLayer = newLayers[i - 1];
        newLayers[i] = { ...newLayers[i], zOffsetMm: prevLayer.zOffsetMm + prevLayer.layerHeightMm };
      }

      return newLayers;
    });
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

  const handleLayerOpacityChange = (layerId: string, newOpacity: number) => {
    setLayers(currentLayers =>
      currentLayers.map(layer =>
        layer.id === layerId ? { ...layer, opacity: newOpacity } : layer
      )
    );
  };

  const handleToggleBacklight = () => {
    setIsBacklightOn(prev => !prev);
  };

  const handleToggleExplodedView = () => {
    setIsExplodedView(prev => !prev);
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
      let cumulativeHeight = 0;
      const newLayers = result.layers.map((layerData, index) => {
        const defaultHeight = 0.8; // A default height for new layers
        const newLayer: LayerConfig = {
          id: `layer-${Date.now()}-${index}`,
          name: `Layer ${index + 1}`,
          originalColor: layerData.color,
          filamentColorHex: layerData.color,
          layerHeightMm: defaultHeight,
          zOffsetMm: cumulativeHeight,
          opacity: 1,
          isVisible: true,
          pathData: layerData.svg_path,
        };
        cumulativeHeight += defaultHeight;
        return newLayer;
      });

      setLayers(newLayers);
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
        <h1 className="text-xl font-bold tracking-tight">
          platesmith
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
          onToggleVisibility={handleToggleLayerVisibility}
          onLayerHeightChange={handleLayerHeightChange}
          onLayerColorChange={handleLayerColorChange}
          onLayerOpacityChange={handleLayerOpacityChange}
          // Pass exploded view state and handler
          isExplodedView={isExplodedView}
          onToggleExplodedView={handleToggleExplodedView}
          // Pass backlight state and handler
          isBacklightOn={isBacklightOn}
          onToggleBacklight={handleToggleBacklight}
          onToggleCanvasBackground={handleToggleCanvasBackground} currentCanvasBgClass={canvasBgClass} />
        {/* The main content area is now a relative container for the canvas and its overlay controls */}
        <main className="relative flex-1 flex flex-col">
          <ThreeCanvas layers={layers} canvasBgClass={canvasBgClass} isExplodedView={isExplodedView} isBacklightOn={isBacklightOn} controlsRef={controlsRef} />
          <ViewControls controlsRef={controlsRef} />
        </main>
      </div>
    </div>
  )
}

export default App
