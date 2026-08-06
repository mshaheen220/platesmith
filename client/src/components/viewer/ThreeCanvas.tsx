import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center, Extrude } from '@react-three/drei';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { useMemo } from 'react';
import type { LayerConfig } from '../../types/project';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

interface ThreeCanvasProps {
  layers: LayerConfig[]; // Array of layer configurations
  canvasBgClass: 'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500'; // Tailwind class for canvas background
  isExplodedView: boolean; // New prop for exploded view state
  isBacklightOn: boolean; // New prop for backlight state
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

function LayerGeometry({ layer, isBacklightOn }: { layer: LayerConfig; isBacklightOn: boolean }) {
  const shapes = useMemo(() => {
    if (!layer.pathData) return [];
    const loader = new SVGLoader();
    const { paths } = loader.parse(layer.pathData);
    // We cast `path` to `any` here because the `toShapes` method is not
    // correctly typed on the `ShapePath` object returned by the SVGLoader.
    // This is a known workaround for this specific library issue.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return paths.flatMap((path: any) => path.toShapes(true));
  }, [layer.pathData]); // This memoization is crucial for performance

  if (!shapes.length) return null;

  return (
    <Extrude
      // The depth is scaled relative to the normalized model, making it visible.
      args={[shapes, { steps: 1, depth: layer.layerHeightMm * 10, bevelEnabled: false }]}
    >
      <meshStandardMaterial
        color={layer.filamentColorHex}
        side={THREE.DoubleSide}
        transparent={isBacklightOn}
        opacity={isBacklightOn ? layer.opacity : 1}
      />
    </Extrude>
  );
}

export function ThreeCanvas({ layers, canvasBgClass, isExplodedView, isBacklightOn, controlsRef }: ThreeCanvasProps) {
  const SPREAD_FACTOR = 0.5; // Adjust this value to control how much layers spread out
  // Define a scaling factor to convert millimeters from the data model to scene units for rendering.
  // This makes the code more readable and easier to adjust globally.
  const MM_TO_SCENE_UNITS = 0.1;
  
  return (
    <div className={`flex-1 ${isBacklightOn ? 'bg-black' : canvasBgClass}`}>
      <Canvas>
        {/* Standard Lighting */}
        {!isBacklightOn && (
          <>
            <ambientLight intensity={Math.PI / 2} />
            <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} decay={0} intensity={Math.PI} />
            <pointLight position={[-10, -10, -10]} decay={0} intensity={Math.PI} />
          </>
        )}
        {/* Backlight Simulation Lighting */}
        {isBacklightOn && <pointLight position={[0, 0, -5]} intensity={50} color="#FFFFE0" />}

        {/* We wrap the Center component in a group to apply global transformations.
            We flip the Y-axis to correct the SVG orientation and apply a uniform scale. */}
        <group scale={[0.005, -0.005, 0.005]}>
          <Center>
            {layers.map((layer, index) =>
              layer.isVisible && (
                <group key={layer.id} position={[0, 0, (layer.zOffsetMm * MM_TO_SCENE_UNITS) + (isExplodedView ? index * SPREAD_FACTOR : 0)]}>
                  <LayerGeometry layer={layer} isBacklightOn={isBacklightOn} />
                </group>
              )
            )}
          </Center>
        </group>

        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </div>
  );
}