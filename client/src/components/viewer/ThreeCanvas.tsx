import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Center, Extrude, Bounds, useBounds } from '@react-three/drei';
import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { useEffect, useMemo, useRef } from 'react';
import type { LayerConfig } from '../../types/project';
import { getImageDimsPx } from '../../lib/svgGeometry';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

interface ThreeCanvasProps {
  layers: LayerConfig[]; // Array of layer configurations
  canvasBgClass: 'bg-gray-700' | 'bg-gray-200' | 'bg-gray-500'; // Tailwind class for canvas background
  isExplodedView: boolean; // New prop for exploded view state
  isBacklightOn: boolean; // New prop for backlight state
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  plateWidthMm: number; // Real-world plate width, matching what /export/ scales to
  // Lets ViewControls trigger a real re-fit ("Zoom to Fit") instead of OrbitControls.reset(),
  // which only snaps back to whatever camera pose existed when OrbitControls first mounted -
  // stale as soon as the model's real-world scale changes.
  fitToContentRef: React.RefObject<(() => void) | null>;
}

// Converts millimeters from the data model to scene units for rendering. Shared at
// module scope (not just a local inside ThreeCanvas) because LayerGeometry's backlight
// material also needs it: meshPhysicalMaterial's transmission shader scales `thickness`
// by the mesh's world-matrix scale before comparing it against `attenuationDistance`
// (see getVolumeTransmissionRay in three's transmission shader chunk), so
// attenuationDistance has to be pre-compensated by this same factor or the two drift
// out of sync and the falloff no longer matches real mm.
const MM_TO_SCENE_UNITS = 0.1;

// A generic "how absorptive is FDM plastic per mm" stand-in for the backlight
// simulation - not measured from any real filament, just tuned so the app's typical
// layer heights (0.2-4mm) produce a visible glowing-to-blocked range.
const ATTENUATION_DISTANCE_MM = 1.5;

function LayerGeometry({ layer, isBacklightOn }: { layer: LayerConfig; isBacklightOn: boolean }) {
  // Extrude the accumulated (support-aware) footprint, not the layer's raw own-color
  // shape - a layer must be solid everywhere something is stacked above it, regardless
  // of that feature's color. Fall back to the raw shape while accumulation hasn't run yet.
  const printedPathData = layer.accumulatedPathData ?? layer.pathData;

  const shapes = useMemo(() => {
    if (!printedPathData) return [];
    const loader = new SVGLoader();
    const { paths } = loader.parse(printedPathData);
    // We cast `path` to `any` here because the `toShapes` method is not
    // correctly typed on the `ShapePath` object returned by the SVGLoader.
    // This is a known workaround for this specific library issue.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return paths.flatMap((path: any) => path.toShapes(true));
  }, [printedPathData]); // This memoization is crucial for performance

  if (!shapes.length) return null;

  return (
    <Extrude
      // The depth is scaled relative to the normalized model, making it visible.
      args={[shapes, { steps: 1, depth: layer.layerHeightMm, bevelEnabled: false }]}
    >
      {isBacklightOn ? (
        // A real backlit print doesn't just fade to see-through - light passes through
        // the plastic and comes out tinted by it, dimmer where there's more material to
        // pass through. meshPhysicalMaterial's transmission model approximates that
        // (unlike plain alpha blending, which just reveals whatever's rendered behind
        // rather than glowing). There's no separate "opacity" dial here on purpose: at
        // 100% infill (the only sane choice for a layer this thin) the actual print has
        // no independent translucency control - the only thing that changes how much
        // light gets through is how thick the layer is, which is just its own height.
        // ATTENUATION_DISTANCE_MM is a fixed, generic "how absorptive is FDM plastic per
        // mm" stand-in - a 1.5mm-thick layer roughly halves the light passing through it.
        // attenuationColor tints by the layer's own color, so dark colors absorb faster
        // regardless of thickness, matching real pigment behavior.
        //
        // thickness is declared in the mesh's local units (raw mm, matching the Extrude
        // depth above), but three's transmission shader scales it by the mesh's world-
        // matrix scale before comparing it against attenuationDistance (see
        // getVolumeTransmissionRay - `thickness * modelScale`). Since this mesh sits
        // inside the MM_TO_SCENE_UNITS-scaled group in ThreeCanvas, attenuationDistance
        // has to be pre-scaled by the same factor, or the falloff no longer corresponds
        // to real mm and everything looks equally bright regardless of thickness.
        <meshPhysicalMaterial
          color={layer.filamentColorHex}
          side={THREE.DoubleSide}
          transmission={1}
          thickness={layer.layerHeightMm}
          ior={1.45}
          // A diffuser's job is to scatter light evenly rather than pass it through
          // crisply - much higher roughness gives it that frosted look instead of a
          // clear/tinted-glass appearance like the color layers above it.
          roughness={layer.isDiffuser ? 0.95 : 0.4}
          attenuationColor={layer.filamentColorHex}
          attenuationDistance={ATTENUATION_DISTANCE_MM * MM_TO_SCENE_UNITS}
        />
      ) : (
        <meshStandardMaterial color={layer.filamentColorHex} side={THREE.DoubleSide} />
      )}
    </Extrude>
  );
}

// Stands in for the LED strip + diffuser behind a real lightbox print: a soft, roughly
// uniform glow immediately behind the stack. Backlit color prints read as "glowing"
// largely because the light source itself is diffuse and even, not a single hotspot -
// a point light directly behind (the old approach) produces a bright center with hard
// falloff toward the edges, nothing like how a diffused LED panel actually looks.
function BacklightPanel({ layers }: { layers: LayerConfig[] }) {
  const { width, height } = useMemo(() => getImageDimsPx(layers), [layers]);
  const margin = 1.4;
  return (
    <mesh position={[0, 0, -6]}>
      <planeGeometry args={[width * margin, height * margin]} />
      <meshBasicMaterial color="#fff6e0" toneMapped={false} />
    </mesh>
  );
}

// Recomputes camera fit whenever the content's actual bounding box could have
// changed - not on every layers update (e.g. a color edit doesn't move geometry
// and shouldn't yank the camera around mid-interaction).
//
// This snaps the camera directly rather than using Bounds' own animated fit()/reset().
// drei's OrbitControls recomputes camera.position from its own internal spherical
// state every frame (regardless of who else touches camera.position), so it silently
// overwrites Bounds' per-frame lerp before it's ever painted - the animation runs but
// nothing visibly moves. Setting position + controls.target once, then calling
// controls.update() ourselves, lets OrbitControls absorb the new pose immediately
// instead of fighting it.
function BoundsController({
  fitToContentRef,
  boundsKey,
  contentRef,
}: {
  fitToContentRef: React.RefObject<(() => void) | null>;
  boundsKey: string;
  // Scopes the fit to just the printable content, not the whole <Bounds> subtree -
  // the BacklightPanel also lives in there and is deliberately larger than the model,
  // which would otherwise pull the camera back to frame the panel instead of the piece.
  contentRef: React.RefObject<THREE.Object3D | null>;
}) {
  const bounds = useBounds();
  const camera = useThree(state => state.camera);
  const controls = useThree(state => state.controls) as OrbitControlsImpl | undefined;

  useEffect(() => {
    fitToContentRef.current = () => {
      const { center, distance } = bounds.refresh(contentRef.current ?? undefined).clip().getSize();
      const target = controls?.target ?? new THREE.Vector3();
      const direction = camera.position.clone().sub(target);
      if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
      direction.normalize();

      camera.position.copy(center).addScaledVector(direction, distance);
      camera.updateMatrixWorld();
      if (camera instanceof THREE.PerspectiveCamera) camera.updateProjectionMatrix();

      if (controls) {
        controls.target.copy(center);
        controls.update();
      }
    };
  }, [bounds, camera, controls, fitToContentRef, contentRef]);

  useEffect(() => {
    // Debounced: an upload fires two layer updates in quick succession (the raw
    // extraction, then the accumulated response a moment later) - wait for boundsKey
    // to stop changing before snapping, rather than fitting twice in a row.
    const timer = setTimeout(() => {
      fitToContentRef.current?.();
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey]);

  return null;
}

export function ThreeCanvas({ layers, canvasBgClass, isExplodedView, isBacklightOn, controlsRef, plateWidthMm, fitToContentRef }: ThreeCanvasProps) {
  const SPREAD_FACTOR = 0.5; // Adjust this value to control how much layers spread out

  // Layer shapes are authored in source-image pixel space; zOffsetMm/layerHeightMm
  // are already real mm. Converting pixels to mm first (the same conversion /export/
  // uses) before applying the single MM_TO_SCENE_UNITS factor to every axis keeps the
  // preview's proportions - thin vs wide, tall vs thick - true to the physical plate,
  // and means changing Plate Width visibly resizes the model instead of doing nothing.
  const imageWidthPx = useMemo(() => getImageDimsPx(layers).width, [layers]);
  const scaleMmPerPx = plateWidthMm / imageWidthPx;
  const xyScale = scaleMmPerPx * MM_TO_SCENE_UNITS;

  // Exposed by Center's forwardRef (its own outer group) - lets BoundsController measure
  // just the printable content, not the BacklightPanel that also lives inside <Bounds>.
  const contentGroupRef = useRef<THREE.Group>(null);

  const boundsKey = useMemo(
    () =>
      layers
        .filter(layer => layer.isVisible)
        .map(layer => `${layer.id}:${layer.zOffsetMm}:${layer.layerHeightMm}:${(layer.accumulatedPathData ?? layer.pathData ?? '').length}`)
        .join('|') + `|exploded:${isExplodedView}|scale:${xyScale}`,
    [layers, isExplodedView, xyScale]
  );

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
        {/* Backlight Simulation Lighting: kept dim on purpose - the BacklightPanel glowing
            through the transmissive layers should read as the dominant light source, the
            way a print actually looks in a dim room lit mainly from behind. A brighter
            front light here would wash that out and look like normal room lighting again. */}
        {isBacklightOn && (
          <>
            <ambientLight intensity={0.15} />
            <pointLight position={[0, 3, 6]} intensity={0.5} />
          </>
        )}

        {/* Bounds auto-fits the camera to whatever the content's real-world size turns
            out to be - required now that scale is tied to actual mm rather than a fixed
            constant tuned to look right at one arbitrary size. */}
        <Bounds margin={1.2}>
          {/* We wrap the Center component in a group to apply global transformations.
              We flip the Y-axis to correct the SVG orientation and apply a uniform scale. */}
          <group scale={[xyScale, -xyScale, MM_TO_SCENE_UNITS]}>
            {/* cacheKey forces Center to recompute: by default it only centers once, against
                whatever geometry existed on first mount (nothing, for the placeholder layers) -
                without this it never re-centers once real layer geometry arrives. */}
            <Center ref={contentGroupRef} cacheKey={boundsKey}>
              {layers.map((layer, index) =>
                layer.isVisible && (
                  <group key={layer.id} position={[0, 0, layer.zOffsetMm + (isExplodedView ? index * SPREAD_FACTOR / MM_TO_SCENE_UNITS : 0)]}>
                    <LayerGeometry layer={layer} isBacklightOn={isBacklightOn} />
                  </group>
                )
              )}
            </Center>
            {/* Sibling of Center, not a child - it must not factor into Center's bounding-box
                math (it would badly skew the recentering, since it's intentionally larger
                than the actual content). Center leaves its own local origin fixed and shifts
                its children to sit centered on it, so the panel lines up automatically. */}
            {isBacklightOn && <BacklightPanel layers={layers} />}
          </group>
          <BoundsController fitToContentRef={fitToContentRef} boundsKey={boundsKey} contentRef={contentGroupRef} />
        </Bounds>

        <OrbitControls ref={controlsRef} makeDefault />
      </Canvas>
    </div>
  );
}