import React from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import { FloorPlanData } from '../lib/gemini';

interface FloorPlan3DProps {
  data: FloorPlanData | null;
  wallHeight: number;
  wallThickness: number;
}

const SCALE = 0.02; // Scale down from 1000x1000 to 20x20 units

function WallMesh({ 
  start, 
  end, 
  height, 
  color = '#e2e8f0', 
  yOffset = 0,
  thickness = 0.3,
  transparent = false,
  opacity = 1
}: { 
  start: {x: number, y: number}, 
  end: {x: number, y: number}, 
  height: number, 
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
  
  const posX = (cx - 500) * SCALE;
  const posZ = (cy - 500) * SCALE;
  
  return (
    <mesh position={[posX, height / 2 + yOffset, posZ]} rotation={[0, -angle, 0]} castShadow receiveShadow>
      <boxGeometry args={[length, height, thickness]} />
      <meshStandardMaterial color={color} transparent={transparent} opacity={opacity} />
    </mesh>
  );
}

export function FloorPlan3D({ data, wallHeight, wallThickness }: FloorPlan3DProps) {
  return (
    <div className="w-full h-full bg-slate-900">
      <Canvas camera={{ position: [0, 15, 20], fov: 50 }} shadows>
        <ambientLight intensity={0.6} />
        <directionalLight 
          position={[10, 20, 10]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize-width={2048} 
          shadow-mapSize-height={2048}
        />
        
        <OrbitControls makeDefault />
        
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
              />
            ))}
            {data.rooms?.map((room, i) => {
              const posX = (room.position.x - 500) * SCALE;
              const posZ = (room.position.y - 500) * SCALE;
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
