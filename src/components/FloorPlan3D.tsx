import React, { useRef, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { FloorPlanData } from '../lib/gemini';
import { View, PersonStanding } from 'lucide-react';

interface FloorPlan3DProps {
  data: FloorPlanData | null;
  wallHeight: number;
  wallThickness: number;
  imageDimensions: { width: number, height: number } | null;
  labelSize3D: number;
  showDoors?: boolean;
}

const SCALE = 0.02; // Scale down to manageable units

function PlayerTracker({ markerRef, dirRef, width, heightDim }: { markerRef: any, dirRef: any, width: number, heightDim: number }) {
  const { camera } = useThree();
  useFrame(() => {
    if (markerRef.current && dirRef.current) {
      const x2d = camera.position.x / SCALE + width / 2;
      const y2d = camera.position.z / SCALE + heightDim / 2;
      markerRef.current.setAttribute('cx', x2d.toString());
      markerRef.current.setAttribute('cy', y2d.toString());

      const angle = camera.rotation.y;
      const dx = Math.sin(angle) * -40;
      const dy = Math.cos(angle) * -40;
      
      dirRef.current.setAttribute('d', `M ${x2d} ${y2d} L ${x2d + dx} ${y2d + dy}`);
    }
  });
  return null;
}

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

function FirstPersonController({ active, startMarker }: { active: boolean, startMarker: {x: number, z: number} | null }) {
  const { camera } = useThree();
  const keys = useRef<{ [key: string]: boolean }>({});
  const rotationY = useRef(0);
  const position = useRef(new THREE.Vector3(0, 1.6, 5));

  useEffect(() => {
    if (!active) return;
    
    // Initialize camera
    if (startMarker) {
      position.current.set(startMarker.x, 1.6, startMarker.z);
    } else {
      position.current.set(0, 1.6, 5);
    }
    camera.position.copy(position.current);
    camera.rotation.set(0, 0, 0);
    rotationY.current = 0;

    const handleKeyDown = (e: KeyboardEvent) => { keys.current[e.code] = true; };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      keys.current = {};
    };
  }, [active, camera]);

  useFrame((state, delta) => {
    if (!active) return;

    const moveSpeed = 5 * delta;
    const turnSpeed = 2 * delta;

    if (keys.current['ArrowLeft'] || keys.current['KeyA']) {
      rotationY.current += turnSpeed;
    }
    if (keys.current['ArrowRight'] || keys.current['KeyD']) {
      rotationY.current -= turnSpeed;
    }

    camera.rotation.y = rotationY.current;
    camera.rotation.x = 0;
    camera.rotation.z = 0;

    const direction = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotationY.current);

    if (keys.current['ArrowUp'] || keys.current['KeyW']) {
      position.current.addScaledVector(direction, moveSpeed);
    }
    if (keys.current['ArrowDown'] || keys.current['KeyS']) {
      position.current.addScaledVector(direction, -moveSpeed);
    }

    position.current.y = 1.6; // Keep height constant
    camera.position.copy(position.current);
  });

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
      <meshStandardMaterial color={color} transparent={transparent} opacity={opacity} roughness={0.7} metalness={0.1} />
    </mesh>
  );
}

export function FloorPlan3D({ data, wallHeight, wallThickness, imageDimensions, labelSize3D, showDoors = true }: FloorPlan3DProps) {
  const width = imageDimensions?.width || 1000;
  const heightDim = imageDimensions?.height || 1000;
  const [topDown, setTopDown] = React.useState(false);
  const [firstPerson, setFirstPerson] = React.useState(false);
  const [startMarker, setStartMarker] = React.useState<{x: number, z: number} | null>(null);

  const markerRef = useRef<SVGCircleElement>(null);
  const dirRef = useRef<SVGPathElement>(null);

  const splitWalls = React.useMemo(() => {
    if (!data) return [];
    let resultWalls = [...data.walls];
    
    data.doors.forEach(door => {
      const newWalls: typeof data.walls = [];
      resultWalls.forEach(wall => {
        const dist = (p1: any, p2: any) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const wallLen = dist(wall.start, wall.end);
        if (wallLen === 0) {
          newWalls.push(wall);
          return;
        }

        const getProjection = (p: any) => {
          const A = wall.start;
          const B = wall.end;
          const dot = (p.x - A.x) * (B.x - A.x) + (p.y - A.y) * (B.y - A.y);
          const t = Math.max(0, Math.min(1, dot / (wallLen * wallLen)));
          return {
            x: A.x + t * (B.x - A.x),
            y: A.y + t * (B.y - A.y),
            t: t
          };
        };

        const proj1 = getProjection(door.start);
        const proj2 = getProjection(door.end);

        const dist1 = dist(door.start, proj1);
        const dist2 = dist(door.end, proj2);

        if (dist1 < 40 && dist2 < 40) {
          if ((proj1.t > 0 && proj1.t < 1) || (proj2.t > 0 && proj2.t < 1) || (proj1.t === 0 && proj2.t === 1) || (proj1.t === 1 && proj2.t === 0)) {
            const tMin = Math.min(proj1.t, proj2.t);
            const tMax = Math.max(proj1.t, proj2.t);
            
            const ptMin = { x: wall.start.x + tMin * (wall.end.x - wall.start.x), y: wall.start.y + tMin * (wall.end.y - wall.start.y) };
            const ptMax = { x: wall.start.x + tMax * (wall.end.x - wall.start.x), y: wall.start.y + tMax * (wall.end.y - wall.start.y) };

            if (dist(wall.start, ptMin) > 5) {
              newWalls.push({ start: wall.start, end: ptMin });
            }
            if (dist(ptMax, wall.end) > 5) {
              newWalls.push({ start: ptMax, end: wall.end });
            }
          } else {
            newWalls.push(wall);
          }
        } else {
          newWalls.push(wall);
        }
      });
      resultWalls = newWalls;
    });
    return resultWalls;
  }, [data]);

  return (
    <div className="w-full h-full bg-slate-900 relative">
      {firstPerson && data && (
        <div className="absolute top-4 left-4 z-20 bg-white/90 backdrop-blur p-2 rounded-lg shadow-lg border border-slate-200" style={{ width: '200px', height: '200px' }}>
          <svg viewBox={`0 0 ${width} ${heightDim}`} className="w-full h-full">
            {data.walls.map((wall, i) => (
              <line 
                key={i} 
                x1={wall.start.x} y1={wall.start.y} 
                x2={wall.end.x} y2={wall.end.y} 
                stroke="#64748b" strokeWidth="15" strokeLinecap="round" 
              />
            ))}
            {data.doors.map((door, i) => (
              <line 
                key={i} 
                x1={door.start.x} y1={door.start.y} 
                x2={door.end.x} y2={door.end.y} 
                stroke="#fca5a5" strokeWidth="15" strokeLinecap="round" 
                opacity={showDoors ? 1 : 0.2}
              />
            ))}
            <circle ref={markerRef} r="20" fill="#3b82f6" />
            <path ref={dirRef} stroke="#3b82f6" strokeWidth="12" strokeLinecap="round" />
          </svg>
        </div>
      )}

      <div className="absolute top-4 right-4 z-10 flex gap-2">
        <button 
          onClick={() => {
            setFirstPerson(!firstPerson);
            if (!firstPerson) setTopDown(false);
          }}
          className={`p-2 backdrop-blur-md rounded-lg text-white transition-colors flex items-center gap-2 shadow-lg border border-white/20 ${firstPerson ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/10 hover:bg-white/20'}`}
          title="第一人稱視角"
        >
          <PersonStanding className="w-5 h-5" />
          <span className="text-sm font-medium">第一人稱</span>
        </button>
        <button 
          onClick={() => {
            setTopDown(true);
            setFirstPerson(false);
          }}
          className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-lg text-white transition-colors flex items-center gap-2 shadow-lg border border-white/20"
          title="俯瞰視角"
        >
          <View className="w-5 h-5" />
          <span className="text-sm font-medium">俯瞰視角</span>
        </button>
      </div>

      {firstPerson && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-black/50 backdrop-blur-md text-white px-6 py-3 rounded-full text-sm flex items-center gap-4 shadow-xl border border-white/10">
          <div className="flex items-center gap-2">
            <kbd className="bg-white/20 px-2 py-1 rounded text-xs font-mono">W/S</kbd>
            <kbd className="bg-white/20 px-2 py-1 rounded text-xs font-mono">↑/↓</kbd>
            <span>前進後退</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="bg-white/20 px-2 py-1 rounded text-xs font-mono">A/D</kbd>
            <kbd className="bg-white/20 px-2 py-1 rounded text-xs font-mono">←/→</kbd>
            <span>左右轉向</span>
          </div>
        </div>
      )}

      <Canvas camera={{ position: [0, 15, 20], fov: 50 }} shadows>
        {!firstPerson && <CameraController topDown={topDown} />}
        <FirstPersonController active={firstPerson} startMarker={startMarker} />
        {firstPerson && <PlayerTracker markerRef={markerRef} dirRef={dirRef} width={width} heightDim={heightDim} />}
        
        <ambientLight intensity={0.4} />
        <hemisphereLight skyColor="#ffffff" groundColor="#444444" intensity={0.5} />
        <directionalLight 
          position={[20, 30, 20]} 
          intensity={1.2} 
          castShadow 
          shadow-mapSize-width={2048} 
          shadow-mapSize-height={2048}
          shadow-camera-left={-40}
          shadow-camera-right={40}
          shadow-camera-top={40}
          shadow-camera-bottom={-40}
          shadow-bias={-0.0005}
        />
        <Environment preset="city" />
        
        {!firstPerson && (
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
        )}
        
        <Grid 
          infiniteGrid 
          fadeDistance={50} 
          sectionColor="#475569" 
          cellColor="#334155" 
        />
        
        {/* Floor */}
        <mesh 
          rotation={[-Math.PI / 2, 0, 0]} 
          position={[0, -0.01, 0]} 
          receiveShadow
          onDoubleClick={(e) => {
            if (!firstPerson) {
              setStartMarker({ x: e.point.x, z: e.point.z });
            }
          }}
        >
          <planeGeometry args={[100, 100]} />
          <meshStandardMaterial color="#1e293b" roughness={0.8} metalness={0.2} />
        </mesh>

        {!firstPerson && startMarker && (
          <mesh position={[startMarker.x, 0.1, startMarker.z]}>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshStandardMaterial color="#3b82f6" />
            <Html position={[0, 0.5, 0]} center>
              <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded whitespace-nowrap shadow-lg">
                出發點
              </div>
            </Html>
          </mesh>
        )}

        {data && (
          <group>
            {splitWalls.map((wall, i) => (
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
              <React.Fragment key={`door-group-${i}`}>
                {showDoors && (
                  <WallMesh 
                    start={door.start} 
                    end={door.end} 
                    height={wallHeight * 0.8} 
                    color="#fca5a5" 
                    thickness={wallThickness * 1.2}
                    imageDimensions={imageDimensions}
                  />
                )}
                {/* Wall above the door */}
                <WallMesh 
                  start={door.start} 
                  end={door.end} 
                  height={wallHeight * 0.2} 
                  yOffset={wallHeight * 0.8}
                  color="#e2e8f0" 
                  thickness={wallThickness}
                  imageDimensions={imageDimensions}
                />
              </React.Fragment>
            ))}
            {data.rooms?.map((room, i) => {
              const posX = (room.position.x - width / 2) * SCALE;
              const posZ = (room.position.y - heightDim / 2) * SCALE;
              return (
                <Html key={`room-label-${i}`} position={[posX, 0.1, posZ]} center distanceFactor={10}>
                  <div 
                    className="bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full font-bold shadow-lg border border-slate-200 whitespace-nowrap select-none"
                    style={{ 
                      fontSize: `${labelSize3D}px`,
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
