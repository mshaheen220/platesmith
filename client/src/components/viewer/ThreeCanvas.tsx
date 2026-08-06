import { Canvas } from '@react-three/fiber';
import { OrbitControls, Center, Extrude } from '@react-three/drei';
import * as THREE from 'three';
import type { LayerConfig } from '../../types/project';

// Define a placeholder 2D shape to be extruded.
// This represents the geometry that will eventually come from the backend.
const placeholderShape = new THREE.Shape();
const outerBox = new THREE.Path();
outerBox.moveTo(-0.75, -0.5); // Start point
outerBox.lineTo(0.75, -0.5);  // Bottom edge
outerBox.lineTo(0.75, 0.5);   // Right edge
outerBox.lineTo(-0.75, 0.5);  // Top edge
outerBox.lineTo(-0.75, -0.5); // Left edge (closed)
placeholderShape.add(outerBox);

// Add a hole to the shape to make the change visually obvious
const hole = new THREE.Path();
hole.moveTo(-0.25, -0.25);
hole.lineTo(0.25, -0.25);
hole.lineTo(0.25, 0.25);
hole.lineTo(-0.25, 0.25);
hole.lineTo(-0.25, -0.25);
placeholderShape.holes.push(hole);

interface ThreeCanvasProps {
  layers: LayerConfig[]; // Array of layer configurations
  canvasBgClass: 'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500'; // Tailwind class for canvas background
  isExplodedView: boolean; // New prop for exploded view state
  isBacklightOn: boolean; // New prop for backlight state
}

export function ThreeCanvas({ layers, canvasBgClass, isExplodedView, isBacklightOn }: ThreeCanvasProps) {
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

        <Center>
          {layers.map(layer =>
            layer.isVisible && ( // Only render visible layers, using index for exploded view spread
              <Extrude
                key={layer.id}
                args={[
                  placeholderShape,
                  { steps: 1, depth: layer.layerHeightMm * MM_TO_SCENE_UNITS, bevelEnabled: false }
                ]}
                position={[0, 0, (layer.zOffsetMm * MM_TO_SCENE_UNITS) + (isExplodedView ? layers.indexOf(layer) * SPREAD_FACTOR : 0)]} // Position layer along the Z-axis, adding spread if exploded
              >
                <meshStandardMaterial
                  color={layer.filamentColorHex}
                  side={THREE.DoubleSide}
                  transparent={isBacklightOn} // Enable transparency for backlight effect
                  opacity={isBacklightOn ? layer.opacity : 1} // Use layer's opacity property
                />
              </Extrude>
            ) 
          )}
        </Center>

        <OrbitControls />
      </Canvas>
    </div>
  );
}