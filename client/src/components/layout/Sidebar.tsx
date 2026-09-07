import { useState, useEffect, type ReactNode } from 'react';
import { Eye, EyeOff, Sun, Moon, Circle, Layers, Split, Lightbulb, LightbulbOff, Upload, LoaderCircle, Merge, Ungroup, GripVertical, Download, AlertTriangle, ChevronDown, Magnet, Plus, X } from 'lucide-react';
import type { LayerConfig } from '../../types/project';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';

interface SidebarProps {
  layers: LayerConfig[];
  onImageUpload: (file: File, backgroundColorHex?: string) => void;
  isProcessing: boolean;
  selectedLayerIds: string[];
  onToggleLayerSelection: (layerId: string) => void;
  onMergeLayers: () => void;
  onUnmergeLayer: (layerId: string) => void;
  onToggleDiffuserLayer: () => void;
  onDragEnd: (result: DropResult) => void;
  onToggleVisibility: (layerId: string) => void;
  onLayerHeightChange: (layerId: string, newHeight: number) => void;
  maxLayerHeightMm: number;
  onSnapToLayerGrid: () => void;
  onLayerColorChange: (layerId: string, newColor: string) => void;
  onLayerNameChange: (layerId: string, newName: string) => void;
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
  firstLayerHeightMm: number | null;
  onFirstLayerHeightChange: (heightMm: number | null) => void;
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
  onToggleDiffuserLayer,
  onDragEnd,
  onToggleVisibility,
  onLayerHeightChange,
  maxLayerHeightMm,
  onSnapToLayerGrid,
  onLayerColorChange,
  onLayerNameChange,
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
  firstLayerHeightMm,
  onFirstLayerHeightChange,
  onExport,
  isExporting,
}: SidebarProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [fillTransparentBg, setFillTransparentBg] = useState(false);
  const [backgroundColorHex, setBackgroundColorHex] = useState('#ffffff');
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
      onImageUpload(selectedFile, fillTransparentBg ? backgroundColorHex : undefined);
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
    // How many physical printer layers have completed by this Z height - only
    // meaningful once we know the printer's own slicer layer height. Accounts for a
    // taller first layer (common for bed adhesion): physical layer boundaries sit at
    // firstLayerHeightMm + k*printerLayerHeightMm, not plain multiples of
    // printerLayerHeightMm, once a first-layer height is set.
    let printLayerNumber: number | null = null;
    if (printerLayerHeightMm && printerLayerHeightMm > 0) {
      const effectiveFirstLayerHeightMm =
        firstLayerHeightMm && firstLayerHeightMm > 0 ? firstLayerHeightMm : printerLayerHeightMm;
      const offset = z - effectiveFirstLayerHeightMm;
      if (offset < -1e-3) {
        // Falls before even the first physical layer would finish - no valid boundary here.
        alignedToLayerHeight = false;
      } else {
        const clampedOffset = Math.max(0, offset);
        const remainder = clampedOffset % printerLayerHeightMm;
        alignedToLayerHeight = Math.min(remainder, printerLayerHeightMm - remainder) < 1e-3;
        printLayerNumber = 1 + clampedOffset / printerLayerHeightMm;
      }
    }
    return { z, alignedToLayerHeight, printLayerNumber, afterName: layer.name, beforeName: visibleLayers[i + 1].name };
  });
  const hasOffGridSwapPoints = swapPoints.some(point => point.alignedToLayerHeight === false);
  const hasDiffuser = layers.some(l => l.isDiffuser);
  const hasProcessedImage = layers.some(l => l.pathData);

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
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="fill-transparent-bg"
                  checked={fillTransparentBg}
                  onChange={(e) => setFillTransparentBg(e.target.checked)}
                  className="form-checkbox h-4 w-4 bg-gray-800 border-gray-600 rounded text-blue-500 focus:ring-blue-500"
                />
                <label
                  htmlFor="fill-transparent-bg"
                  className="text-sm text-gray-300"
                  title="Fills whatever's transparent in the source image with this color, as its own layer, instead of leaving that area unprinted - turns a subject cut out on a transparent background into a solid rectangular plate. Must be set before uploading."
                >
                  Fill transparent background
                </label>
                {fillTransparentBg && (
                  <input
                    type="color"
                    value={backgroundColorHex}
                    onChange={(e) => setBackgroundColorHex(e.target.value)}
                    title="Background fill color"
                    className="w-8 h-6 rounded cursor-pointer bg-gray-800 border border-gray-600"
                  />
                )}
              </div>
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
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <div {...provided.dragHandleProps} className="cursor-grab text-gray-500 flex-shrink-0">
                                  <GripVertical size={20} />
                                </div>
                                <input
                                  type="checkbox"
                                  checked={selectedLayerIds.includes(layer.id)}
                                  onChange={() => onToggleLayerSelection(layer.id)}
                                  title="Select for merging"
                                  className="form-checkbox h-3 w-3 bg-gray-800 border-gray-600 rounded-sm text-blue-500 focus:ring-blue-500 focus:ring-offset-0 flex-shrink-0"
                                />
                                <div className="relative w-5 h-5 rounded-sm border-2 border-gray-500 cursor-pointer flex-shrink-0" style={{ backgroundColor: layer.filamentColorHex }}>
                                  <input type="color" value={layer.filamentColorHex} onChange={(e) => onLayerColorChange(layer.id, e.target.value)} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" title="Change filament color" />
                                </div>
                                <input
                                  type="text"
                                  value={layer.name}
                                  onChange={(e) => onLayerNameChange(layer.id, e.target.value)}
                                  title="Click to rename"
                                  className="min-w-0 flex-1 text-sm font-medium text-gray-200 bg-transparent border border-transparent rounded px-1 -mx-1 truncate hover:border-gray-600 focus:border-blue-500 focus:bg-gray-800 focus:outline-none"
                                />
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
            <button
              onClick={onToggleDiffuserLayer}
              disabled={!hasDiffuser && !hasProcessedImage}
              title={
                hasDiffuser
                  ? 'Remove the clear diffuser base layer'
                  : 'Add a full-canvas clear/natural filament layer at the very bottom of the stack, to diffuse the backlight evenly before it reaches the color layers above'
              }
              className="w-full mt-2 flex items-center justify-center gap-2 text-sm bg-gray-600 text-white font-semibold py-2 px-3 rounded hover:bg-gray-500 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              {hasDiffuser ? <X size={14} /> : <Plus size={14} />}
              <span>{hasDiffuser ? 'Remove Diffuser Base Layer' : 'Add Diffuser Base Layer'}</span>
            </button>
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
                  placeholder="none"
                  value={printerLayerHeightMm ?? ''}
                  onChange={(e) => onPrinterLayerHeightChange(e.target.value === '' ? null : parseFloat(e.target.value))}
                  className="w-20 bg-gray-900 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="first-layer-height" className="text-gray-300" title="If your first physical layer is printed taller for bed adhesion (e.g. 0.24mm first layer, 0.2mm rest), set it here so swap-point calculations account for the offset. Leave blank to assume it's the same as Printer Layer Height.">
                  First Layer Height (mm)
                </label>
                <input
                  id="first-layer-height"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="none"
                  value={firstLayerHeightMm ?? ''}
                  onChange={(e) => onFirstLayerHeightChange(e.target.value === '' ? null : parseFloat(e.target.value))}
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
                <ul className="space-y-1.5 max-h-40 overflow-y-auto text-xs border-t border-gray-600 pt-2">
                  {swapPoints.map((point, i) => (
                    <li key={i} className="space-y-0.5">
                      <div className="flex items-center justify-between gap-2 text-gray-300">
                        <span className="truncate" title={`${point.afterName} → ${point.beforeName}`}>
                          {point.afterName} → {point.beforeName}
                        </span>
                        {point.alignedToLayerHeight === false && (
                          <span className="flex items-center gap-1 text-amber-400 flex-shrink-0" title="Doesn't land on a printer layer boundary - adjust layer heights or the printer layer height above">
                            <AlertTriangle size={12} /> off-grid
                          </span>
                        )}
                      </div>
                      <div className="text-gray-500">
                        z = {point.z.toFixed(2)} mm
                        {point.printLayerNumber !== null && (
                          <>
                            {' · '}
                            {point.alignedToLayerHeight
                              // Slicers that let you insert a pause "at layer N" trigger it
                              // BEFORE layer N prints - so this is completed-layers + 1, the
                              // number to actually type in, not the completed-layer count
                              // (which would be off by one if entered directly).
                              ? `at print layer ${Math.round(point.printLayerNumber) + 1}`
                              : `mid print layer ${Math.ceil(point.printLayerNumber)}`}
                          </>
                        )}
                      </div>
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
