import React, { useState, useRef } from 'react';
import { FloorPlanData, Point } from '../lib/gemini';
import { ZoomIn, ZoomOut, Maximize, Hand, MousePointer2 } from 'lucide-react';

interface Props {
  data: FloorPlanData;
  onChange: (data: FloorPlanData) => void;
  imagePreview: string | null;
  drawMode: 'none' | 'wall' | 'curve' | 'door' | 'text';
  doorType: 'single' | 'double';
  onDrawComplete: () => void;
  selectedItems: { type: 'wall' | 'curvedWall' | 'door' | 'room', index: number }[];
  setSelectedItems: (items: { type: 'wall' | 'curvedWall' | 'door' | 'room', index: number }[]) => void;
  bgOpacity: number;
  lineOpacity: number;
  wallThickness: number;
  visibility: {
    walls: boolean;
    doors: boolean;
    rooms: boolean;
  };
  imageDimensions: { width: number, height: number } | null;
}

export function FloorPlan2D({ data, onChange, imagePreview, drawMode, doorType, onDrawComplete, selectedItems, setSelectedItems, bgOpacity, lineOpacity, wallThickness, visibility, imageDimensions }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<{ 
    type: 'wall' | 'curvedWall' | 'door' | 'room', 
    index: number, 
    point?: 'start' | 'end' | 'control' | 'center',
    dragStartPos?: Point
  } | null>(null);
  const [drawingStart, setDrawingStart] = useState<Point | null>(null);
  const [drawingEnd, setDrawingEnd] = useState<Point | null>(null);
  const [mousePos, setMousePos] = useState<Point | null>(null);
  
  // Zoom & Pan State
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point | null>(null);
  const [panToolActive, setPanToolActive] = useState(false);

  // Marquee Selection State
  const [marqueeStart, setMarqueeStart] = useState<Point | null>(null);
  const [marqueeEnd, setMarqueeEnd] = useState<Point | null>(null);

  // Text Editing Modal State
  const [editingRoom, setEditingRoom] = useState<{ index: number, name: string, fontSize: number, color: string } | null>(null);

  // Handle Keys
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedItems.length > 0) {
          const newData = { ...data };
          const wallsToDelete = selectedItems.filter(s => s.type === 'wall').map(s => s.index).sort((a, b) => b - a);
          const curvedWallsToDelete = selectedItems.filter(s => s.type === 'curvedWall').map(s => s.index).sort((a, b) => b - a);
          const doorsToDelete = selectedItems.filter(s => s.type === 'door').map(s => s.index).sort((a, b) => b - a);
          const roomsToDelete = selectedItems.filter(s => s.type === 'room').map(s => s.index).sort((a, b) => b - a);

          wallsToDelete.forEach(idx => newData.walls.splice(idx, 1));
          curvedWallsToDelete.forEach(idx => newData.curvedWalls?.splice(idx, 1));
          doorsToDelete.forEach(idx => newData.doors.splice(idx, 1));
          roomsToDelete.forEach(idx => newData.rooms.splice(idx, 1));

          onChange(newData);
          setSelectedItems([]);
        }
      } else if (e.key === 'Escape') {
        setDrawingStart(null);
        onDrawComplete();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data, selectedItems, onChange, setSelectedItems, onDrawComplete]);

  const getMouseCoords = (e: React.MouseEvent | MouseEvent): Point => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    
    if (!cursor) return { x: 0, y: 0 };

    return {
      x: cursor.x,
      y: cursor.y
    };
  };

  const snapToGrid = (p: Point, start: Point): Point => {
    const dx = Math.abs(p.x - start.x);
    const dy = Math.abs(p.y - start.y);
    if (dx > dy) {
      return { x: p.x, y: start.y };
    } else {
      return { x: start.x, y: p.y };
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const coords = getMouseCoords(e);
    
    if (panToolActive || e.button === 1) {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (drawMode !== 'none') {
      if (drawMode === 'door') {
        // Find nearest wall to place door on
        let nearestWallIdx = -1;
        let minDist = Infinity;
        let projection: Point | null = null;

        data.walls.forEach((wall, i) => {
          const dist = distToSegment(coords, wall.start, wall.end);
          if (dist < minDist && dist < 20) {
            minDist = dist;
            nearestWallIdx = i;
            projection = projectPointOnSegment(coords, wall.start, wall.end);
          }
        });

        if (nearestWallIdx !== -1 && projection) {
          // SCALE is 0.02, so 1m = 50 units. 
          // Single door: 0.9m = 45 units. Double door: 1.8m = 90 units.
          const doorWidth = doorType === 'single' ? 45 : 90;
          const wall = data.walls[nearestWallIdx];
          const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
          const start = {
            x: projection.x - (doorWidth / 2) * Math.cos(angle),
            y: projection.y - (doorWidth / 2) * Math.sin(angle)
          };
          const end = {
            x: projection.x + (doorWidth / 2) * Math.cos(angle),
            y: projection.y + (doorWidth / 2) * Math.sin(angle)
          };
          const newData = { ...data };
          newData.doors.push({ start, end });
          onChange(newData);
          onDrawComplete();
          return;
        }
      }

      if (drawMode === 'text') {
        const newData = { ...data };
        newData.rooms = newData.rooms || [];
        newData.rooms.push({
          name: '新空間',
          position: coords,
          fontSize: 14,
          color: '#334155'
        });
        onChange(newData);
        onDrawComplete();
        return;
      }

      if (drawMode === 'wall' && drawingStart) {
        // Continuous drawing: don't reset drawingStart on mouseDown
      } else if (drawMode === 'curve') {
        if (!drawingStart) {
          setDrawingStart(coords);
        } else if (!drawingEnd) {
          setDrawingEnd(coords);
        } else {
          // Finalize curve
          const newData = { ...data };
          newData.curvedWalls = newData.curvedWalls || [];
          newData.curvedWalls.push({
            start: drawingStart,
            end: drawingEnd,
            control: coords
          });
          onChange(newData);
          setDrawingStart(null);
          setDrawingEnd(null);
          onDrawComplete();
        }
      } else {
        setDrawingStart(coords);
      }
      setMousePos(coords);
    } else {
      // Marquee selection start
      setMarqueeStart(coords);
      setMarqueeEnd(coords);
      if (!e.shiftKey) {
        setSelectedItems([]);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    let coords = getMouseCoords(e);
    
    if (e.shiftKey && drawingStart && drawMode !== 'none') {
      coords = snapToGrid(coords, drawingStart);
    }
    
    setMousePos(coords);

    if (isPanning && panStart) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (dragging) {
      const newData = { ...data };
      if (dragging.type === 'wall') {
        // ... existing wall logic
      } else if (dragging.type === 'curvedWall') {
        const wall = newData.curvedWalls![dragging.index];
        if (dragging.point === 'start') wall.start = coords;
        else if (dragging.point === 'end') wall.end = coords;
        else if (dragging.point === 'control') wall.control = coords;
        else if (dragging.point === 'center' && dragging.dragStartPos) {
          const dx = coords.x - dragging.dragStartPos.x;
          const dy = coords.y - dragging.dragStartPos.y;
          wall.start = { x: wall.start.x + dx, y: wall.start.y + dy };
          wall.end = { x: wall.end.x + dx, y: wall.end.y + dy };
          wall.control = { x: wall.control.x + dx, y: wall.control.y + dy };
          setDragging({ ...dragging, dragStartPos: coords });
        }
      } else if (dragging.type === 'door') {
        const door = newData.doors[dragging.index];
        if (dragging.point === 'start') {
          let newStart = coords;
          if (e.shiftKey) {
            const dx = Math.abs(newStart.x - door.end.x);
            const dy = Math.abs(newStart.y - door.end.y);
            if (dx > dy) newStart = { x: newStart.x, y: door.end.y };
            else newStart = { x: door.end.x, y: newStart.y };
          }
          door.start = newStart;
        } else if (dragging.point === 'end') {
          let newEnd = coords;
          if (e.shiftKey) {
            const dx = Math.abs(newEnd.x - door.start.x);
            const dy = Math.abs(newEnd.y - door.start.y);
            if (dx > dy) newEnd = { x: newEnd.x, y: door.start.y };
            else newEnd = { x: door.start.x, y: newEnd.y };
          }
          door.end = newEnd;
        } else if (dragging.point === 'center' && dragging.dragStartPos) {
          let dx = coords.x - dragging.dragStartPos.x;
          let dy = coords.y - dragging.dragStartPos.y;

          if (e.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }

          door.start = { x: door.start.x + dx, y: door.start.y + dy };
          door.end = { x: door.end.x + dx, y: door.end.y + dy };
          setDragging({ ...dragging, dragStartPos: { x: dragging.dragStartPos.x + dx, y: dragging.dragStartPos.y + dy } });
        }
      } else if (dragging.type === 'room' && dragging.dragStartPos) {
        let dx = coords.x - dragging.dragStartPos.x;
        let dy = coords.y - dragging.dragStartPos.y;
        
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }

        const room = newData.rooms[dragging.index];
        newData.rooms[dragging.index] = {
          ...room,
          position: { x: room.position.x + dx, y: room.position.y + dy }
        };
        setDragging({ ...dragging, dragStartPos: { x: dragging.dragStartPos.x + dx, y: dragging.dragStartPos.y + dy } });
      }
      onChange(newData);
    }

    if (marqueeStart) {
      setMarqueeEnd(coords);
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (drawMode !== 'none' && drawingStart && mousePos) {
      let coords = getMouseCoords(e);
      if (e.shiftKey) coords = snapToGrid(coords, drawingStart);

      if (drawMode === 'curve') {
        // Curve mode handles its own clicks in mouseDown
        return;
      }

      if (Math.hypot(coords.x - drawingStart.x, coords.y - drawingStart.y) > 10) {
        const newItem = { start: drawingStart, end: coords };
        const newData = { ...data };
        if (drawMode === 'wall') {
          newData.walls.push(newItem);
          setDrawingStart(coords); // Continue drawing from the end point
        } else if (drawMode === 'door') {
          newData.doors.push(newItem);
          setDrawingStart(null);
          onDrawComplete();
        }
        onChange(newData);
      } else {
        setDrawingStart(null);
        onDrawComplete();
      }
    }

    if (marqueeStart && marqueeEnd) {
      const x1 = Math.min(marqueeStart.x, marqueeEnd.x);
      const y1 = Math.min(marqueeStart.y, marqueeEnd.y);
      const x2 = Math.max(marqueeStart.x, marqueeEnd.x);
      const y2 = Math.max(marqueeStart.y, marqueeEnd.y);

      const isInside = (p: Point) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;

      const newSelection = [...(e.shiftKey ? selectedItems : [])];
      
      data.walls.forEach((wall, i) => {
        if (isInside(wall.start) && isInside(wall.end)) {
          if (!newSelection.some(s => s.type === 'wall' && s.index === i)) {
            newSelection.push({ type: 'wall', index: i });
          }
        }
      });

      data.curvedWalls?.forEach((wall, i) => {
        if (isInside(wall.start) && isInside(wall.end) && isInside(wall.control)) {
          if (!newSelection.some(s => s.type === 'curvedWall' && s.index === i)) {
            newSelection.push({ type: 'curvedWall', index: i });
          }
        }
      });

      data.doors.forEach((door, i) => {
        if (isInside(door.start) && isInside(door.end)) {
          if (!newSelection.some(s => s.type === 'door' && s.index === i)) {
            newSelection.push({ type: 'door', index: i });
          }
        }
      });

      data.rooms?.forEach((room, i) => {
        if (isInside(room.position)) {
          if (!newSelection.some(s => s.type === 'room' && s.index === i)) {
            newSelection.push({ type: 'room', index: i });
          }
        }
      });

      setSelectedItems(newSelection);
      setMarqueeStart(null);
      setMarqueeEnd(null);
    }

    setDragging(null);
  };

  const distToSegment = (p: Point, v: Point, w: Point) => {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
  };

  const projectPointOnSegment = (p: Point, v: Point, w: Point): Point => {
    const l2 = Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    if (l2 === 0) return v;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return {
      x: v.x + t * (w.x - v.x),
      y: v.y + t * (w.y - v.y)
    };
  };

  const handleRoomClick = (index: number) => {
    const room = data.rooms[index];
    setEditingRoom({
      index,
      name: room.name,
      fontSize: room.fontSize || 14,
      color: room.color || '#334155'
    });
  };

  const saveRoomEdit = () => {
    if (!editingRoom) return;
    const newData = { ...data };
    newData.rooms[editingRoom.index] = {
      ...newData.rooms[editingRoom.index],
      name: editingRoom.name,
      fontSize: editingRoom.fontSize,
      color: editingRoom.color
    };
    onChange(newData);
    setEditingRoom(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(scale * delta, 0.5), 10);
    
    if (newScale === scale) return;

    // Zoom towards mouse position
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // New Offset = MousePos - (MousePos - OldOffset) * (NewScale / OldScale)
    const ratio = newScale / scale;
    const newOffsetX = mouseX - (mouseX - offset.x) * ratio;
    const newOffsetY = mouseY - (mouseY - offset.y) * ratio;

    setOffset({ x: newOffsetX, y: newOffsetY });
    setScale(newScale);
  };

  const resetView = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const strokeW = wallThickness / 0.02;
  const selectedStrokeW = strokeW + 4;

  const width = imageDimensions?.width || 1000;
  const height = imageDimensions?.height || 1000;

  return (
    <div className="w-full h-full bg-slate-200 overflow-hidden flex flex-col items-center justify-center p-8 relative">
      {/* Canvas Toolbar */}
      <div className="absolute top-6 right-6 z-20 flex flex-col gap-3 ios-glass p-2 rounded-2xl shadow-xl border border-white/20">
        <button onClick={() => setScale(prev => Math.min(prev * 1.2, 10))} className="p-2 hover:bg-black/5 rounded-xl transition-colors text-slate-600" title="放大">
          <ZoomIn className="w-5 h-5" />
        </button>
        <button onClick={() => setScale(prev => Math.max(prev / 1.2, 0.5))} className="p-2 hover:bg-black/5 rounded-xl transition-colors text-slate-600" title="縮小">
          <ZoomOut className="w-5 h-5" />
        </button>
        <button onClick={resetView} className="p-2 hover:bg-black/5 rounded-xl transition-colors text-slate-600" title="重置視角">
          <Maximize className="w-5 h-5" />
        </button>
        <div className="h-px bg-black/10 mx-1 my-1" />
        <button 
          onClick={() => { setPanToolActive(!panToolActive); onDrawComplete(); setDrawingStart(null); }} 
          className={`p-2 rounded-xl transition-colors ${panToolActive ? 'bg-ios-blue text-white' : 'hover:bg-black/5 text-slate-600'}`} 
          title="平移工具"
        >
          <Hand className="w-5 h-5" />
        </button>
        <button 
          onClick={() => { setPanToolActive(false); setDrawingStart(null); }} 
          className={`p-2 rounded-xl transition-colors ${!panToolActive && drawMode === 'none' ? 'bg-ios-blue text-white' : 'hover:bg-black/5 text-slate-600'}`} 
          title="選取工具"
        >
          <MousePointer2 className="w-5 h-5" />
        </button>
      </div>

      <div 
        className="relative w-full max-w-4xl bg-white shadow-2xl border border-slate-300 rounded-sm overflow-hidden"
        style={{ aspectRatio: `${width} / ${height}` }}
        onWheel={handleWheel}
      >
        {/* Room Edit Modal Overlay */}
        {editingRoom && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
            <div className="ios-card p-6 w-80 space-y-5 shadow-2xl">
              <h3 className="text-lg font-bold text-slate-800 text-center">編輯空間屬性</h3>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">空間名稱</label>
                  <input 
                    type="text" 
                    value={editingRoom.name} 
                    onChange={(e) => setEditingRoom({...editingRoom, name: e.target.value})}
                    className="ios-input"
                    placeholder="例如：客廳"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">字體大小 (px)</label>
                  <input 
                    type="number" 
                    value={editingRoom.fontSize} 
                    onChange={(e) => setEditingRoom({...editingRoom, fontSize: parseInt(e.target.value) || 12})}
                    className="ios-input"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">文字顏色</label>
                  <div className="flex gap-3 items-center ios-input">
                    <input 
                      type="color" 
                      value={editingRoom.color} 
                      onChange={(e) => setEditingRoom({...editingRoom, color: e.target.value})}
                      className="w-6 h-6 p-0 border-0 rounded-full cursor-pointer overflow-hidden"
                    />
                    <span className="text-sm font-mono text-slate-600">{editingRoom.color}</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => setEditingRoom(null)}
                  className="ios-button-secondary flex-1 py-3"
                >
                  取消
                </button>
                <button 
                  onClick={saveRoomEdit}
                  className="ios-button-primary flex-1 py-3"
                >
                  儲存
                </button>
              </div>
            </div>
          </div>
        )}

        <div 
          className="w-full h-full transition-transform duration-75 ease-out origin-top-left"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className={`absolute inset-0 w-full h-full ${drawMode !== 'none' ? 'cursor-crosshair' : panToolActive ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
            style={{ zIndex: 10 }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={(e) => { e.preventDefault(); setDrawingStart(null); onDrawComplete(); }}
          >
            {imagePreview && (
              <image 
                href={imagePreview} 
                x="0"
                y="0"
                width={width}
                height={height}
                opacity={bgOpacity}
                preserveAspectRatio="none"
                pointerEvents="none"
              />
            )}

            {/* Grid for reference */}
            <g stroke="#e2e8f0" strokeWidth="1" opacity="0.5">
              {Array.from({ length: Math.ceil(width / 100) + 1 }).map((_, i) => (
                <line key={`grid-v-${i}`} x1={i * 100} y1="0" x2={i * 100} y2={height} />
              ))}
              {Array.from({ length: Math.ceil(height / 100) + 1 }).map((_, i) => (
                <line key={`grid-h-${i}`} x1="0" y1={i * 100} x2={width} y2={i * 100} />
              ))}
            </g>

            {/* Curved Walls */}
            {visibility.walls && data.curvedWalls?.map((wall, i) => {
              const isSelected = selectedItems.some(s => s.type === 'curvedWall' && s.index === i);
              const path = `M ${wall.start.x} ${wall.start.y} Q ${wall.control.x} ${wall.control.y} ${wall.end.x} ${wall.end.y}`;
              return (
                <g key={`curved-wall-${i}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke={isSelected ? "#3b82f6" : "#334155"}
                    strokeWidth={isSelected ? selectedStrokeW : strokeW}
                    strokeLinecap="round"
                    strokeOpacity={lineOpacity}
                    className="cursor-pointer transition-colors"
                    onMouseDown={(e) => { 
                      if (panToolActive || drawMode !== 'none') return;
                      e.stopPropagation(); 
                      const coords = getMouseCoords(e);
                      if (e.shiftKey) {
                        setSelectedItems([...selectedItems, { type: 'curvedWall', index: i }]);
                      } else {
                        setSelectedItems([{ type: 'curvedWall', index: i }]);
                      }
                      setDragging({ type: 'curvedWall', index: i, point: 'center', dragStartPos: coords });
                    }}
                  />
                  {isSelected && selectedItems.length === 1 && (
                    <>
                      <circle cx={wall.start.x} cy={wall.start.y} r={strokeW} fill="#2563eb" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'curvedWall', index: i, point: 'start' }); }} />
                      <circle cx={wall.end.x} cy={wall.end.y} r={strokeW} fill="#2563eb" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'curvedWall', index: i, point: 'end' }); }} />
                      <circle cx={wall.control.x} cy={wall.control.y} r={strokeW} fill="#f59e0b" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'curvedWall', index: i, point: 'control' }); }} />
                    </>
                  )}
                </g>
              );
            })}

            {/* Walls */}
            {visibility.walls && data.walls.map((wall, i) => {
              const isSelected = selectedItems.some(s => s.type === 'wall' && s.index === i);
              return (
                <g key={`wall-${i}`}>
                  <line
                    x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y}
                    stroke={isSelected ? "#3b82f6" : "#334155"}
                    strokeWidth={isSelected ? selectedStrokeW : strokeW}
                    strokeLinecap="round"
                    strokeOpacity={lineOpacity}
                    className="cursor-pointer transition-colors"
                    onMouseDown={(e) => { 
                      if (panToolActive || drawMode !== 'none') return;
                      e.stopPropagation(); 
                      const coords = getMouseCoords(e);
                      if (e.shiftKey) {
                        setSelectedItems([...selectedItems, { type: 'wall', index: i }]);
                      } else {
                        setSelectedItems([{ type: 'wall', index: i }]);
                      }
                      setDragging({ type: 'wall', index: i, point: 'center', dragStartPos: coords });
                    }}
                  />
                  {isSelected && selectedItems.length === 1 && (
                    <>
                      <circle cx={wall.start.x} cy={wall.start.y} r={strokeW} fill="#2563eb" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'wall', index: i, point: 'start' }); }} />
                      <circle cx={wall.end.x} cy={wall.end.y} r={strokeW} fill="#2563eb" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'wall', index: i, point: 'end' }); }} />
                    </>
                  )}
                </g>
              );
            })}

            {/* Doors */}
            {visibility.doors && data.doors.map((door, i) => {
              const isSelected = selectedItems.some(s => s.type === 'door' && s.index === i);
              return (
                <g key={`door-${i}`}>
                  <line
                    x1={door.start.x} y1={door.start.y} x2={door.end.x} y2={door.end.y}
                    stroke={isSelected ? "#ef4444" : "#f87171"}
                    strokeWidth={isSelected ? selectedStrokeW : strokeW}
                    strokeLinecap="round"
                    strokeOpacity={lineOpacity}
                    className="cursor-pointer transition-colors"
                    onMouseDown={(e) => { 
                      if (panToolActive || drawMode !== 'none') return;
                      e.stopPropagation(); 
                      const coords = getMouseCoords(e);
                      if (e.shiftKey) {
                        setSelectedItems([...selectedItems, { type: 'door', index: i }]);
                      } else {
                        setSelectedItems([{ type: 'door', index: i }]);
                      }
                      setDragging({ type: 'door', index: i, point: 'center', dragStartPos: coords });
                    }}
                  />
                  {isSelected && selectedItems.length === 1 && (
                    <>
                      <circle cx={door.start.x} cy={door.start.y} r={strokeW} fill="#dc2626" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'door', index: i, point: 'start' }); }} />
                      <circle cx={door.end.x} cy={door.end.y} r={strokeW} fill="#dc2626" className="cursor-move"
                        onMouseDown={(e) => { e.stopPropagation(); setDragging({ type: 'door', index: i, point: 'end' }); }} />
                    </>
                  )}
                </g>
              );
            })}

            {/* Rooms */}
            {visibility.rooms && data.rooms?.map((room, i) => {
              const isSelected = selectedItems.some(s => s.type === 'room' && s.index === i);
              return (
                <g key={`room-${i}`} className="cursor-move">
                  <text
                    x={room.position.x}
                    y={room.position.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    className={`select-none font-bold transition-all ${isSelected ? 'drop-shadow-md' : ''}`}
                    style={{ 
                      pointerEvents: 'all',
                      fontSize: `${room.fontSize || 14}px`,
                      fill: isSelected ? '#3b82f6' : (room.color || '#334155')
                    }}
                    onMouseDown={(e) => {
                      if (panToolActive || drawMode !== 'none') return;
                      e.stopPropagation();
                      if (e.shiftKey) {
                        setSelectedItems([...selectedItems, { type: 'room', index: i }]);
                      } else {
                        setSelectedItems([{ type: 'room', index: i }]);
                      }
                      const coords = getMouseCoords(e);
                      setDragging({ type: 'room', index: i, point: 'center', dragStartPos: coords });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleRoomClick(i);
                    }}
                  >
                    {room.name}
                  </text>
                  {isSelected && (
                    <circle 
                      cx={room.position.x} 
                      cy={room.position.y} 
                      r="4" 
                      fill="none" 
                      stroke="#3b82f6" 
                      strokeWidth="1" 
                      strokeDasharray="2,2" 
                    />
                  )}
                </g>
              );
            })}

            {/* Drawing Preview */}
            {drawMode !== 'none' && drawingStart && mousePos && (
              <>
                {drawMode === 'curve' ? (
                  <>
                    {!drawingEnd ? (
                      <line
                        x1={drawingStart.x} y1={drawingStart.y} x2={mousePos.x} y2={mousePos.y}
                        stroke="#3b82f6" strokeWidth={strokeW} strokeDasharray="10,10" opacity="0.7"
                      />
                    ) : (
                      <path
                        d={`M ${drawingStart.x} ${drawingStart.y} Q ${mousePos.x} ${mousePos.y} ${drawingEnd.x} ${drawingEnd.y}`}
                        fill="none" stroke="#3b82f6" strokeWidth={strokeW} strokeDasharray="10,10" opacity="0.7"
                      />
                    )}
                  </>
                ) : (
                  <line
                    x1={drawingStart.x} y1={drawingStart.y} x2={mousePos.x} y2={mousePos.y}
                    stroke={drawMode === 'wall' ? "#3b82f6" : "#ef4444"}
                    strokeWidth={strokeW}
                    strokeDasharray="10,10"
                    strokeLinecap="round"
                    opacity="0.7"
                  />
                )}
              </>
            )}

            {/* Marquee Selection Box */}
            {marqueeStart && marqueeEnd && (
              <rect
                x={Math.min(marqueeStart.x, marqueeEnd.x)}
                y={Math.min(marqueeStart.y, marqueeEnd.y)}
                width={Math.abs(marqueeStart.x - marqueeEnd.x)}
                height={Math.abs(marqueeStart.y - marqueeEnd.y)}
                fill="rgba(59, 130, 246, 0.1)"
                stroke="#3b82f6"
                strokeWidth="1"
                strokeDasharray="4,4"
              />
            )}
          </svg>
        </div>
      </div>
      
      <div className="mt-6 flex flex-wrap justify-center gap-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest ios-glass px-6 py-3 rounded-full border border-white/20 shadow-sm">
        <span className="flex items-center gap-2"><kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm text-slate-600">滾輪</kbd> 縮放</span>
        <span className="flex items-center gap-2"><kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm text-slate-600">中鍵/拖曳</kbd> 平移</span>
        <span className="flex items-center gap-2"><kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm text-slate-600">Shift</kbd> 正交/多選</span>
        <span className="flex items-center gap-2"><kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm text-slate-600">右鍵</kbd> 結束繪製</span>
        <span className="flex items-center gap-2"><kbd className="bg-white/80 px-1.5 py-0.5 rounded border shadow-sm text-slate-600">雙擊文字</kbd> 編輯</span>
      </div>
    </div>
  );
}
