import React, { useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import { FloorPlanData } from '../lib/gemini';
import { View } from 'lucide-react';

interface FloorPlan3DProps {
  data: FloorPlanData | null;
  wallHeight: number;
  wallThickness: number;
  imageDimensions: { width: number, height: number } | null;
}

const SCALE = 0.02; // Scale down to manageable units

function CameraController({ topDown }: { topDown: boolean }) {
  const { camera, controls } = useThree();
  
  React.useEffect(() => {
    if (topDown && controls) {
      // Set camera to top-down view
      camera.position.set(0, 30, 0.1); // slight offset to avoid gimbal lock
      // @ts-ignore
      controls.target.set(0, 0, 0);
      // @ts-ignore
      controls.update();
    }
  }, [topDown, camera, controls]);
  
  return null;
}

function WallMesh({ 
  start, 
  end, 
  height, 
  imageDimensions,
  color = '#e2e8f0', 
  yOffset = 0,
  thickness = 0.3,
  transparent = false,
  opacity = 1
}: { 
  start: {x: number, y: number}, 
  end: {x: number, y: number}, 
  height: number, 
  imageDimensions: { width: number, height: number } | null,
  color?: string, 
  yOffset?: number,
  thickness?: number,
  transparent?: boolean,
  opacity?: number
}) {
  const length = Math.hypot(end.x - start.x, end.y - start.y) * SCALE;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  
  // Center point
  const cx = (start.x + end.x) / 2;
  const cy = (start.y + end.y) / 2;
  
  const width = imageDimensions?.width || 1000;
  const heightDim = imageDimensions?.height || 1000;

  const posX = (cx - width / 2) * SCALE;
  const posZ = (cy - heightDim / 2) * SCALE;
  
  return (
    <mesh position={[posX, height / 2 + yOffset, posZ]} rotation={[0, -angle, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, height, thickness]} />
      <meshStandardMaterial color={color} transparent={transparent} opacity={opacity} />
    </mesh>
  );
}

export function FloorPlan3D({ data, wallHeight, wallThickness, imageDimensions }: FloorPlan3DProps) {
  const width = imageDimensions?.width || 1000;
  const heightDim = imageDimensions?.height || 1000;
  const [topDown, setTopDown] = React.useState(false);

  return (
    <div className="w-full h-full bg-slate-900 relative">
      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button 
          onClick={() => setTopDown(true)}
          className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-lg text-white transition-colors flex items-center gap-2 shadow-lg border border-white/20"
          title="俯瞰視角"
        >
          <View className="w-5 h-5" />
          <span className="text-sm font-medium">俯瞰視角</span>
        </button>
      </div>
      <Canvas camera={{ position: [0, 15, 20], fov: 50 }} shadows>
        <CameraController topDown={topDown} />
        <ambientLight intensity={0.6} />
        <directionalLight 
          position={[10, 20, 10]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize-width={2048} 
          shadow-mapSize-height={2048}
        />
        
        <OrbitControls 
          makeDefault 
          mouseButtons={{
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.PAN,
            RIGHT: THREE.MOUSE.PAN
          }}
          onStart={() => {
            if (topDown) setTopDown(false);
          }}
        />
        
        <Grid 
          infiniteGrid 
          fadeDistance={50} 
          sectionColor="#475569" 
          cellColor="#334155" 
        />
        
        {/* Floor */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#1e293b" />
        </mesh>

        {data && (
          <group>
            {data.walls.map((wall, i) => (
              <WallMesh 
                key={`wall-${i}`} 
                start={wall.start} 
                end={wall.end} 
                height={wallHeight} 
                thickness={wallThickness}
                imageDimensions={imageDimensions}
              />
            ))}
            {data.doors.map((door, i) => (
              <WallMesh 
                key={`door-${i}`} 
                start={door.start} 
                end={door.end} 
                height={wallHeight * 0.8} 
                color="#fca5a5" 
                thickness={wallThickness * 1.2}
                imageDimensions={imageDimensions}
              />
            ))}
            {data.rooms?.map((room, i) => {
              const posX = (room.position.x - width / 2) * SCALE;
              const posZ = (room.position.y - heightDim / 2) * SCALE;
              return (
                <Html key={`room-label-${i}`} position={[posX, 0.1, posZ]} center distanceFactor={10}>
                  <div 
                    className="bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full font-bold shadow-lg border border-slate-200 whitespace-nowrap select-none"
                    style={{ 
                      fontSize: `${room.fontSize || 12}px`,
                      color: room.color || '#1e293b'
                    }}
                  >
                    {room.name}
                  </div>
                </Html>
              );
            })}
          </group>
        )}
      </Canvas>
    </div>
  );
}
