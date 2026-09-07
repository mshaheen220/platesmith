import { useState, useEffect, type ReactNode } from 'react';
import { Eye, EyeOff, Sun, Moon, Circle, Layers, Split, Lightbulb, LightbulbOff, Upload, LoaderCircle, Merge, Ungroup, GripVertical, Download, AlertTriangle, ChevronDown, Magnet } from 'lucide-react';
import type { LayerConfig } from '../../types/project';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

interface SidebarProps {
  layers: LayerConfig[];
  onImageUpload: (file: File) => void;
  isProcessing: boolean;
  selectedLayerIds: string[];
  onToggleLayerSelection: (layerId: string) => void;
  onMergeLayers: () => void;
  onUnmergeLayer: (layerId: string) => void;
  onDragEnd: (result: DropResult) => void;
  onToggleVisibility: (layerId: string) => void;
  onLayerHeightChange: (layerId: string, newHeight: number) => void;
  maxLayerHeightMm: number;
  onSnapToLayerGrid: () => void;
  onLayerColorChange: (layerId: string, newColor: string) => void;
  isExplodedView: boolean;
  onToggleExplodedView: () => void;
  isBacklightOn: boolean;
  onToggleBacklight: () => void;
  onToggleCanvasBackground: () => void;
  currentCanvasBgClass: 'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500';
  plateWidthMm: number;
  onPlateWidthChange: (widthMm: number) => void;
  printerLayerHeightMm: number | null;
  onPrinterLayerHeightChange: (heightMm: number | null) => void;
  onExport: () => void;
  isExporting: boolean;
}

type SectionKey = 'image' | 'layers' | 'global' | 'export';

function Section({
  title,
  isOpen,
  onToggle,
  actions,
  children,
}: {
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-lg font-semibold text-gray-200 hover:text-white transition-colors"
          aria-expanded={isOpen}
        >
          <ChevronDown size={18} className={`text-gray-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
          {title}
        </button>
        {actions}
      </div>
      {isOpen && children}
    </div>
  );
}

export function Sidebar({
  layers,
  onImageUpload,
  isProcessing,
  selectedLayerIds,
  onToggleLayerSelection,
  onMergeLayers,
  onUnmergeLayer,
  onDragEnd,
  onToggleVisibility,
  onLayerHeightChange,
  maxLayerHeightMm,
  onSnapToLayerGrid,
  onLayerColorChange,
  isExplodedView,
  onToggleExplodedView,
  isBacklightOn,
  onToggleBacklight,
  onToggleCanvasBackground,
  currentCanvasBgClass,
  plateWidthMm,
  onPlateWidthChange,
  printerLayerHeightMm,
  onPrinterLayerHeightChange,
  onExport,
  isExporting,
}: SidebarProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>({
    image: true,
    layers: true,
    global: true,
    export: true,
  });

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  const toggleSection = (key: SectionKey) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

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

  // Filament-swap points: one between each consecutive pair of visible layers,
  // at the Z height where the layer below ends. Mirrors the same math the
  // backend uses to build the export manifest, so this is a live preview of it.
  const visibleLayers = layers.filter(l => l.isVisible);
  const totalHeightMm = visibleLayers.reduce((sum, l) => sum + l.layerHeightMm, 0);
  const swapPoints = visibleLayers.slice(0, -1).map((layer, i) => {
    const z = layer.zOffsetMm + layer.layerHeightMm;
    let alignedToLayerHeight: boolean | null = null;
    if (printerLayerHeightMm && printerLayerHeightMm > 0) {
      const remainder = z % printerLayerHeightMm;
      alignedToLayerHeight = Math.min(remainder, printerLayerHeightMm - remainder) < 1e-3;
    }
    return { z, alignedToLayerHeight, afterName: layer.name, beforeName: visibleLayers[i + 1].name };
  });
  const hasOffGridSwapPoints = swapPoints.some(point => point.alignedToLayerHeight === false);

  return (
    <aside className="w-96 bg-gray-800 border-r border-gray-700 flex flex-col">
      <div className="p-6 flex-shrink-0">
        <h2 className="text-2xl font-bold text-white">Controls</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pb-6 min-h-0">
        <div className="space-y-8">
          <Section title="Image Source" isOpen={openSections.image} onToggle={() => toggleSection('image')}>
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
          </Section>

          <Section
            title="Layers"
            isOpen={openSections.layers}
            onToggle={() => toggleSection('layers')}
            actions={
              selectedLayerIds.length > 1 && (
                <button onClick={onMergeLayers} className="flex items-center gap-2 text-sm bg-green-600 text-white font-bold py-1 px-3 rounded hover:bg-green-700">
                  <Merge size={14} />
                  Merge Selected
                </button>
              )
            }
          >
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
                              <div className="flex items-center gap-1">
                                {layer.mergedFrom && layer.mergedFrom.length > 0 && (
                                  <button
                                    onClick={() => onUnmergeLayer(layer.id)}
                                    className="p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
                                    title={`Unmerge back into ${layer.mergedFrom.length} original layers`}
                                  >
                                    <Ungroup size={16} />
                                  </button>
                                )}
                                <button onClick={() => onToggleVisibility(layer.id)} className="p-1 rounded hover:bg-gray-600 text-gray-400 hover:text-white transition-colors" title={layer.isVisible ? 'Hide Layer' : 'Show Layer'}>
                                  {layer.isVisible ? <Eye size={16} /> : <EyeOff size={16} />}
                                </button>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <label htmlFor={`height-${layer.id}`} className="text-xs text-gray-400">Height (mm)</label>
                              <input id={`height-${layer.id}`} type="number" min="0" max={maxLayerHeightMm} step="0.1" value={layer.layerHeightMm} onChange={(e) => onLayerHeightChange(layer.id, parseFloat(e.target.value))} className="w-20 bg-gray-900 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none" />
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
          </Section>

          <Section title="Global Settings" isOpen={openSections.global} onToggle={() => toggleSection('global')}>
            <div className="bg-gray-700/50 rounded p-4 text-sm text-gray-400 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="plate-width" className="text-gray-300">Plate Width (mm)</label>
                <input
                  id="plate-width"
                  type="number"
                  min="1"
                  step="1"
                  value={plateWidthMm}
                  onChange={(e) => onPlateWidthChange(parseFloat(e.target.value))}
                  className="w-20 bg-gray-900 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="printer-layer-height" className="text-gray-300" title="Used only to flag filament-swap points that don't land on an achievable physical layer boundary">
                  Printer Layer Height (mm)
                </label>
                <input
                  id="printer-layer-height"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="optional"
                  value={printerLayerHeightMm ?? ''}
                  onChange={(e) => onPrinterLayerHeightChange(e.target.value === '' ? null : parseFloat(e.target.value))}
                  className="w-20 bg-gray-900 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
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
          </Section>

          <Section title="Export" isOpen={openSections.export} onToggle={() => toggleSection('export')}>
            <div className="bg-gray-700/50 rounded p-4 space-y-3 text-sm">
              <div className="flex items-center justify-between text-gray-300">
                <span>Total stack height</span>
                <span>{totalHeightMm.toFixed(2)} mm</span>
              </div>
              <div className="flex items-center justify-between text-gray-300">
                <span>Filament swap points</span>
                <span>{swapPoints.length}</span>
              </div>
              {swapPoints.length > 0 && (
                <ul className="space-y-1 max-h-32 overflow-y-auto text-xs text-gray-400 border-t border-gray-600 pt-2">
                  {swapPoints.map((point, i) => (
                    <li key={i} className="flex items-center justify-between gap-2" title={`Between "${point.afterName}" and "${point.beforeName}"`}>
                      <span>z = {point.z.toFixed(2)} mm</span>
                      {point.alignedToLayerHeight === false && (
                        <span className="flex items-center gap-1 text-amber-400" title="Doesn't land on a printer layer boundary - adjust layer heights or the printer layer height above">
                          <AlertTriangle size={12} /> off-grid
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {hasOffGridSwapPoints && printerLayerHeightMm && printerLayerHeightMm > 0 && (
                <button
                  onClick={onSnapToLayerGrid}
                  title="Rounds each layer's height to the nearest multiple of the printer layer height above, so every swap point lands on an achievable boundary"
                  className="w-full flex items-center justify-center gap-2 text-sm bg-amber-600 text-white font-bold py-2 px-4 rounded hover:bg-amber-700"
                >
                  <Magnet size={14} />
                  <span>Snap to Layer Grid</span>
                </button>
              )}
              <button
                onClick={onExport}
                disabled={isExporting || visibleLayers.length === 0}
                className="w-full flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-2 px-4 rounded hover:bg-green-700 disabled:bg-gray-500 disabled:cursor-not-allowed"
              >
                {isExporting ? <LoaderCircle className="animate-spin" size={16} /> : <Download size={16} />}
                <span>{isExporting ? 'Exporting...' : 'Export STL Pack'}</span>
              </button>
            </div>
          </Section>
        </div>
      </div>
    </aside>
  );
}
