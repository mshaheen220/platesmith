import { useState, useEffect } from 'react';
import { Eye, EyeOff, Sun, Moon, Circle, Layers, Split, Lightbulb, LightbulbOff, Upload, LoaderCircle, Merge, GripVertical } from 'lucide-react';
import type { LayerConfig } from '../../types/project';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

interface SidebarProps {
  layers: LayerConfig[];
  onImageUpload: (file: File) => void;
  isProcessing: boolean;
  selectedLayerIds: string[];
  onToggleLayerSelection: (layerId: string) => void;
  onMergeLayers: () => void;
  onDragEnd: (result: DropResult) => void;
  onToggleVisibility: (layerId: string) => void;
  onLayerHeightChange: (layerId: string, newHeight: number) => void;
  onLayerColorChange: (layerId: string, newColor: string) => void;
  onLayerOpacityChange: (layerId: string, newOpacity: number) => void;
  isExplodedView: boolean;
  onToggleExplodedView: () => void;
  isBacklightOn: boolean;
  onToggleBacklight: () => void;
  onToggleCanvasBackground: () => void;
  currentCanvasBgClass: 'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500';
}

export function Sidebar({
  layers,
  onImageUpload,
  isProcessing,
  selectedLayerIds,
  onToggleLayerSelection,
  onMergeLayers,
  onDragEnd,
  onToggleVisibility,
  onLayerHeightChange,
  onLayerColorChange,
  onLayerOpacityChange,
  isExplodedView,
  onToggleExplodedView,
  isBacklightOn,
  onToggleBacklight,
  onToggleCanvasBackground,
  currentCanvasBgClass
}: SidebarProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setSelectedFile(event.target.files[0]);
      setImagePreviewUrl(URL.createObjectURL(event.target.files[0]));
    }
  };

  const handleUploadClick = () => {
    if (selectedFile) {
      onImageUpload(selectedFile);
    }
  };

  return (
    <aside className="w-96 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-6 flex-shrink-0">
        <h2 className="text-2xl font-bold text-white">Controls</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 min-h-0">
        <div className="space-y-8">
          {/* Image Source and Global Settings remain the same */}
          <div>
            <h3 className="text-lg font-semibold text-gray-200 mb-2">Image Source</h3>
            <div className="bg-gray-700/50 rounded p-4 space-y-3">
              <input type="file" onChange={handleFileChange} accept="image/png, image/svg+xml" className="text-sm text-gray-300 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
              {imagePreviewUrl && (
                <div className="flex justify-center p-2 bg-black/20 rounded">
                  <img src={imagePreviewUrl} alt="Selected preview" className="max-h-32 rounded" />
                </div>
              )}
              <button onClick={handleUploadClick} disabled={!selectedFile || isProcessing} className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-2 px-4 rounded hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed">
                {isProcessing ? <LoaderCircle className="animate-spin" /> : <Upload size={16} />}
                <span>{isProcessing ? 'Processing...' : 'Upload & Process'}</span>
              </button>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-200 mb-2">Global Settings</h3>
            <div className="bg-gray-700/50 rounded p-4 text-sm text-gray-400 space-y-4">
              <p>Project dimensions will go here.</p>
              <div className="flex items-center justify-between">
                <span>Canvas Background:</span>
                <button onClick={onToggleCanvasBackground} className="p-2 rounded-full hover:bg-gray-600 text-gray-400 hover:text-white transition-colors" title="Toggle Canvas Background">
                    {currentCanvasBgClass === 'bg-gray-700' ? <Sun size={20} /> : currentCanvasBgClass === 'bg-gray-200' ? <Moon size={20} /> : <Circle size={20} />}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>Exploded View:</span>
                <button onClick={onToggleExplodedView} className="p-2 rounded-full hover:bg-gray-600 text-gray-400 hover:text-white transition-colors" title={isExplodedView ? 'Switch to Stacked View' : 'Switch to Exploded View'}>
                  {isExplodedView ? <Split size={20} /> : <Layers size={20} />}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span>Backlight Simulation:</span>
                <button onClick={onToggleBacklight} className="p-2 rounded-full hover:bg-gray-600 text-gray-400 hover:text-white transition-colors" title={isBacklightOn ? 'Turn Off Backlight' : 'Turn On Backlight'}>
                  {isBacklightOn ? <LightbulbOff size={20} /> : <Lightbulb size={20} />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-lg font-semibold text-gray-200">Layers</h3>
              {selectedLayerIds.length > 1 && (
                <button onClick={onMergeLayers} className="flex items-center gap-2 text-sm bg-green-600 text-white font-bold py-1 px-3 rounded hover:bg-green-700">
                  <Merge size={14} />
                  Merge Selected
                </button>
              )}
            </div>
            <DragDropContext onDragEnd={onDragEnd}>
              <Droppable droppableId="layers">
                {(provided) => (
                  <ul {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                    {layers.map((layer, index) => (
                      <Draggable key={layer.id} draggableId={layer.id} index={index}>
                        {(provided, snapshot) => (
                          <li
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            className={`bg-gray-700/50 p-3 rounded space-y-2 ${snapshot.isDragging ? 'bg-gray-600' : ''}`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div {...provided.dragHandleProps} className="cursor-grab text-gray-500">
                                  <GripVertical size={20} />
                                </div>
                                <input
                                  type="checkbox"
                                  checked={selectedLayerIds.includes(layer.id)}
                                  onChange={() => onToggleLayerSelection(layer.id)}
                                  className="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-blue-500 focus:ring-blue-500"
                                />
                                <div className="relative w-5 h-5 rounded-sm border-2 border-gray-500 cursor-pointer" style={{ backgroundColor: layer.filamentColorHex }}>
                                  <input type="color" value={layer.filamentColorHex} onChange={(e) => onLayerColorChange(layer.id, e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" title="Change filament color" />
                                </div>
                                <span className="text-sm font-medium text-gray-200">{layer.name}</span>
                              </div>
                              <button onClick={() => onToggleVisibility(layer.id)} className="p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-white transition-colors" title={layer.isVisible ? 'Hide Layer' : 'Show Layer'}>
                                {layer.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                              </button>
                            </div>
                            <div className="flex items-center justify-between">
                              <label htmlFor={`height-${layer.id}`} className="text-xs text-gray-400">Height (mm)</label>
                              <input id={`height-${layer.id}`} type="number" step="0.1" value={layer.layerHeightMm} onChange={(e) => onLayerHeightChange(layer.id, parseFloat(e.target.value))} className="w-20 bg-gray-900 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                            </div>
                            <div className="flex items-center justify-between">
                              <label htmlFor={`opacity-${layer.id}`} className="text-xs text-gray-400">Opacity</label>
                              <div className="flex items-center gap-2" title={!isBacklightOn ? "Only available in Backlight Simulation mode" : ""}>
                                <input id={`opacity-${layer.id}`} type="range" min="0" max="1" step="0.01" disabled={!isBacklightOn} value={layer.opacity} onChange={(e) => onLayerOpacityChange(layer.id, parseFloat(e.target.value))} className="w-32 accent-blue-500 disabled:opacity-50 disabled:cursor-not-allowed" />
                                <span className="text-xs text-gray-400 w-8 text-right">{layer.opacity.toFixed(2)}</span>
                              </div>
                            </div>
                          </li>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </ul>
                )}
              </Droppable>
            </DragDropContext>
          </div>
        </div>
      </div>
    </aside>
  );
}