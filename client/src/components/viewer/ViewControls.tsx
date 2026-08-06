import React from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Maximize } from 'lucide-react';

interface ViewControlsProps {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

export function ViewControls({ controlsRef }: ViewControlsProps) {
  const PAN_SPEED = 0.5; // A smaller value for smoother panning

  const handlePan = (dx: number, dy: number) => {
    const controls = controlsRef.current;
    if (controls) {
      const camera = controls.object as THREE.Camera;
      const x = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const y = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
      const displacement = x.multiplyScalar(-dx * PAN_SPEED).add(y.multiplyScalar(dy * PAN_SPEED));

      controls.target.add(displacement);
      camera.position.add(displacement);
      controls.update();
    }
  };

  const handleZoomToFit = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  return (
    <div className="absolute bottom-4 right-4 bg-gray-800/50 backdrop-blur-sm rounded-lg p-2 flex items-center gap-1">
      <button onClick={() => handlePan(0, 1)} className="p-2 rounded hover:bg-gray-700" title="Pan Up"><ArrowUp size={16} /></button>
      <div className="flex flex-col">
        <button onClick={() => handlePan(-1, 0)} className="p-2 rounded hover:bg-gray-700" title="Pan Left"><ArrowLeft size={16} /></button>
        <button onClick={() => handlePan(1, 0)} className="p-2 rounded hover:bg-gray-700" title="Pan Right"><ArrowRight size={16} /></button>
      </div>
      <button onClick={() => handlePan(0, -1)} className="p-2 rounded hover:bg-gray-700" title="Pan Down"><ArrowDown size={16} /></button>
      <div className="w-px h-8 bg-gray-600 mx-1"></div>
      <button onClick={handleZoomToFit} className="p-2 rounded hover:bg-gray-700" title="Zoom to Fit"><Maximize size={16} /></button>
    </div>
  );
}