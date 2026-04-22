import React, { useRef, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Html, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { FloorPlanData } from '../lib/gemini';
import { View, PersonStanding, X, Plus, Trash2 } from 'lucide-react';

interface FloorPlan3DProps {
  data: FloorPlanData | null;
  wallHeight: number;
  wallThickness: number;
  imageDimensions: { width: number, height: number } | null;
  labelSize3D: number;
  showDoors?: boolean;
  onChange?: (data: FloorPlanData) => void;
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
  const lightRef = useRef<THREE.SpotLight>(null);

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

    const handleKeyDown = (e: KeyboardEvent) => { 
      keys.current[e.code] = true; 
      if (e.code === 'Escape') {
        // We can't easily call setFirstPerson from here without passing it down
        // but we can dispatch a custom event or rely on the parent's state
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => { keys.current[e.code] = false; };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      keys.current = {};
    };
  }, [active, camera, startMarker]);

  useFrame((state, delta) => {
    if (!active) return;

    const moveSpeed = 5 * delta;
    const turnSpeed = 2.5 * delta;

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

    if (lightRef.current) {
      lightRef.current.position.copy(camera.position);
      const targetPos = camera.position.clone().add(direction);
      lightRef.current.target.position.copy(targetPos);
      lightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    active ? (
      <group>
        <spotLight
          ref={lightRef}
          intensity={2.5}
          distance={25}
          angle={0.7}
          penumbra={0.5}
          castShadow
          shadow-bias={-0.0001}
          color="#ffffff"
        />
      </group>
    ) : null
  );
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
      <meshStandardMaterial 
        color={color} 
        transparent={transparent} 
        opacity={opacity} 
        roughness={0.4} 
        metalness={0.2} 
        envMapIntensity={1}
      />
    </mesh>
  );
}

function CurvedWallMesh({ 
  start, 
  control, 
  end, 
  height, 
  imageDimensions,
  thickness = 0.3,
  color = '#e2e8f0'
}: { 
  start: {x: number, y: number}, 
  control: {x: number, y: number}, 
  end: {x: number, y: number}, 
  height: number, 
  imageDimensions: { width: number, height: number } | null,
  thickness?: number,
  color?: string
}) {
  const segments = 20;
  const points: {x: number, y: number}[] = [];
  
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Quadratic Bezier formula: (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
    const x = Math.pow(1 - t, 2) * start.x + 2 * (1 - t) * t * control.x + Math.pow(t, 2) * end.x;
    const y = Math.pow(1 - t, 2) * start.y + 2 * (1 - t) * t * control.y + Math.pow(t, 2) * end.y;
    points.push({ x, y });
  }

  return (
    <group>
      {points.slice(0, -1).map((p, i) => (
        <WallMesh 
          key={i}
          start={p}
          end={points[i + 1]}
          height={height}
          thickness={thickness}
          imageDimensions={imageDimensions}
          color={color}
        />
      ))}
    </group>
  );
}

export function FloorPlan3D({ data, wallHeight, wallThickness, imageDimensions, labelSize3D, showDoors = true, onChange }: FloorPlan3DProps) {
  const width = imageDimensions?.width || 1000;
  const heightDim = imageDimensions?.height || 1000;
  const [topDown, setTopDown] = React.useState(false);
  const [firstPerson, setFirstPerson] = React.useState(false);
  const [startMarker, setStartMarker] = React.useState<{x: number, z: number} | null>(null);
  const [selectedRoomIndex, setSelectedRoomIndex] = React.useState<number | null>(null);
  const [newNoteText, setNewNoteText] = React.useState("");

  const markerRef = useRef<SVGCircleElement>(null);
  const dirRef = useRef<SVGPathElement>(null);

  const selectedRoom = selectedRoomIndex !== null && data ? data.rooms[selectedRoomIndex] : null;

  const handleAddNote = () => {
    if (!newNoteText.trim() || selectedRoomIndex === null || !data || !onChange) return;
    const newData = JSON.parse(JSON.stringify(data));
    const room = newData.rooms[selectedRoomIndex];
    room.notes = room.notes || [];
    room.notes.push(newNoteText.trim());
    onChange(newData);
    setNewNoteText("");
  };

  const handleDeleteNote = (noteIndex: number) => {
    if (selectedRoomIndex === null || !data || !onChange) return;
    const newData = JSON.parse(JSON.stringify(data));
    const room = newData.rooms[selectedRoomIndex];
    if (room.notes) {
      room.notes.splice(noteIndex, 1);
      onChange(newData);
    }
  };

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
        <div className="absolute top-6 left-6 z-20 ios-glass w-48 h-48 rounded-2xl border border-white/20 shadow-2xl overflow-hidden pointer-events-none">
          <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:10px_10px]" />
          <div className="relative w-full h-full p-2">
            <svg viewBox={`0 0 ${width} ${heightDim}`} className="w-full h-full drop-shadow-sm">
              {data.walls.map((wall, i) => (
                <line 
                  key={`mini-wall-${i}`} 
                  x1={wall.start.x} y1={wall.start.y} 
                  x2={wall.end.x} y2={wall.end.y} 
                  stroke="#1e293b" strokeWidth="25" strokeLinecap="round" 
                />
              ))}
              {data.curvedWalls?.map((wall, i) => (
                <path 
                  key={`mini-curved-${i}`}
                  d={`M ${wall.start.x} ${wall.start.y} Q ${wall.control.x} ${wall.control.y} ${wall.end.x} ${wall.end.y}`}
                  fill="none"
                  stroke="#1e293b" strokeWidth="25" strokeLinecap="round" 
                />
              ))}
              {data.doors.map((door, i) => (
                <line 
                  key={i} 
                  x1={door.start.x} y1={door.start.y} 
                  x2={door.end.x} y2={door.end.y} 
                  stroke="#ef4444" strokeWidth="25" strokeLinecap="round" 
                  opacity={showDoors ? 1 : 0.2}
                />
              ))}
              <circle ref={markerRef} r="30" fill="#007AFF" />
              <path ref={dirRef} stroke="#007AFF" strokeWidth="20" strokeLinecap="round" />
            </svg>
          </div>
          <div className="absolute bottom-2 left-0 right-0 text-center">
            <span className="text-[9px] font-bold text-ios-blue uppercase tracking-widest">Mini Map</span>
          </div>
        </div>
      )}

      <div className="absolute top-6 right-6 z-20 flex flex-col gap-3">
        <button 
          onClick={() => {
            setFirstPerson(!firstPerson);
            if (!firstPerson) setTopDown(false);
          }}
          className={`ios-button-secondary w-12 h-12 flex items-center justify-center shadow-lg ${firstPerson ? 'bg-ios-blue text-white' : ''}`}
          title="第一人稱視角"
        >
          <PersonStanding className="w-6 h-6" />
        </button>
        <button 
          onClick={() => {
            setTopDown(true);
            setFirstPerson(false);
          }}
          className="ios-button-secondary w-12 h-12 flex items-center justify-center shadow-lg"
          title="俯瞰視角"
        >
          <View className="w-6 h-6" />
        </button>
      </div>

      {firstPerson && (
        <div className="absolute bottom-6 left-6 z-20 ios-glass p-4 rounded-2xl border border-white/20 shadow-xl max-w-xs">
          <div className="flex items-center gap-2 mb-3 border-b border-white/10 pb-2">
            <div className="w-2 h-2 bg-ios-blue rounded-full animate-pulse" />
            <span className="text-sm font-bold text-slate-800">第一人稱模式</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-[10px] text-slate-600 font-medium">
            <div className="flex items-center gap-2">
              <kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm">W/A/S/D</kbd>
              <span>移動</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm">滑鼠</kbd>
              <span>環視</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm">ESC</kbd>
              <span>退出</span>
            </div>
          </div>
        </div>
      )}

      <Canvas camera={{ position: [0, 15, 20], fov: 50 }} shadows>
        {!firstPerson && <CameraController topDown={topDown} />}
        <FirstPersonController active={firstPerson} startMarker={startMarker} />
        {firstPerson && <PlayerTracker markerRef={markerRef} dirRef={dirRef} width={width} heightDim={heightDim} />}
        
        <ambientLight intensity={0.4} />
        <hemisphereLight color="#ffffff" groundColor="#222222" intensity={0.5} />
        <directionalLight 
          position={[15, 25, 15]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize-width={2048} 
          shadow-mapSize-height={2048}
          shadow-camera-left={-50}
          shadow-camera-right={50}
          shadow-camera-top={50}
          shadow-camera-bottom={-50}
          shadow-bias={-0.0001}
        />
        <pointLight position={[-15, 15, -15]} intensity={0.8} color="#ffffff" />
        
        {firstPerson && (
          <group position={startMarker ? [startMarker.x, 1.6, startMarker.z] : [0, 1.6, 5]}>
            <spotLight
              position={[0, 0, 0]}
              angle={0.6}
              penumbra={0.5}
              intensity={2}
              distance={20}
              castShadow
              shadow-bias={-0.0001}
            />
          </group>
        )}
        
        <ContactShadows 
          position={[0, -0.01, 0]} 
          opacity={0.4} 
          scale={40} 
          blur={2} 
          far={4.5} 
        />
        
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
            {data.curvedWalls?.map((wall, i) => (
              <CurvedWallMesh 
                key={`curved-wall-${i}`}
                start={wall.start}
                control={wall.control}
                end={wall.end}
                height={wallHeight}
                thickness={wallThickness}
                imageDimensions={imageDimensions}
              />
            ))}
            {data.doors.map((door, i) => {
              const doorHeight = Math.min(2.1, wallHeight);
              const wallAboveHeight = Math.max(0, wallHeight - 2.1);
              return (
                <React.Fragment key={`door-group-${i}`}>
                  {showDoors && (
                    <WallMesh 
                      start={door.start} 
                      end={door.end} 
                      height={doorHeight} 
                      color="#fca5a5" 
                      thickness={wallThickness * 1.2}
                      imageDimensions={imageDimensions}
                    />
                  )}
                  {/* Wall above the door */}
                  {wallAboveHeight > 0 && (
                    <WallMesh 
                      start={door.start} 
                      end={door.end} 
                      height={wallAboveHeight} 
                      yOffset={doorHeight}
                      color="#e2e8f0" 
                      thickness={wallThickness}
                      imageDimensions={imageDimensions}
                    />
                  )}
                </React.Fragment>
              );
            })}
            {data.rooms?.map((room, i) => {
              const posX = (room.position.x - width / 2) * SCALE;
              const posZ = (room.position.y - heightDim / 2) * SCALE;
              return (
                <Html key={`room-label-${i}`} position={[posX, 0.1, posZ]} center distanceFactor={10}>
                  <div 
                    onClick={() => setSelectedRoomIndex(i)}
                    className="bg-white/90 backdrop-blur-sm px-3 py-1 rounded-full font-bold shadow-lg border border-slate-200 whitespace-nowrap select-none cursor-pointer hover:bg-blue-50 hover:text-blue-600 transition-colors"
                    style={{ 
                      fontSize: `${labelSize3D}px`,
                      color: room.color || '#1e293b'
                    }}
                  >
                    {room.name}
                    {room.notes && room.notes.length > 0 && (
                      <span className="ml-2 bg-blue-100 text-blue-700 text-[0.7em] px-1.5 py-0.5 rounded-full">
                        {room.notes.length}
                      </span>
                    )}
                  </div>
                </Html>
              );
            })}
          </group>
        )}
      </Canvas>

      {/* Room Notes Modal/Sidebar */}
      {selectedRoom && selectedRoomIndex !== null && (
        <div className="absolute top-6 right-24 z-50 w-80 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-bold text-slate-800 text-lg">{selectedRoom.name} - 設計註記</h3>
            <button 
              onClick={() => setSelectedRoomIndex(null)}
              className="p-1 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="p-4 flex-1 max-h-[60vh] overflow-y-auto space-y-3">
            {selectedRoom.notes && selectedRoom.notes.length > 0 ? (
              selectedRoom.notes.map((note, idx) => (
                <div key={idx} className="group relative bg-slate-50 border border-slate-100 p-3 rounded-xl flex items-start justify-between gap-2 shadow-sm transition-all hover:shadow-md">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{note}</p>
                  <button
                    onClick={() => handleDeleteNote(idx)}
                    className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                    title="刪除註記"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            ) : (
              <div className="text-center py-6 text-slate-400 text-sm italic">
                目前沒有任何註記，點擊下方新增。
              </div>
            )}
          </div>

          <div className="p-4 border-t border-slate-100 bg-white">
            <div className="flex gap-2">
              <input
                type="text"
                value={newNoteText}
                onChange={(e) => setNewNoteText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddNote();
                  }
                }}
                placeholder="輸入討論事項..."
                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ios-blue text-sm"
              />
              <button 
                onClick={handleAddNote}
                disabled={!newNoteText.trim()}
                className="bg-ios-blue text-white p-2 rounded-xl disabled:opacity-50 transition-colors shadow-sm"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
