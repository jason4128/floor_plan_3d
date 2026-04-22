import React, { useState, useRef } from 'react';
import { Upload, SlidersHorizontal, Loader2, Image as ImageIcon, Edit3, Box, Plus, Trash2, MousePointer2, Download, FileJson, Share2, Eye, EyeOff, Settings, X, Undo2, Redo2, CheckSquare, Cloud, FolderOpen, ChevronLeft, ChevronRight, Ruler } from 'lucide-react';
import { FloorPlan3D } from './components/FloorPlan3D';
import { FloorPlan2D } from './components/FloorPlan2D';
import { analyzeFloorPlan, FloorPlanData } from './lib/gemini';
import { db } from './lib/firebase';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

type Step = 'upload' | 'edit2d' | 'view3d';
type DrawMode = 'none' | 'wall' | 'curve' | 'door' | 'text' | 'scale';

export default function App() {
  const [step, setStep] = useState<Step>('upload');
  const [wallHeight, setWallHeight] = useState(2.3);
  const [wallThickness, setWallThickness] = useState(0.3);
  const [labelSize3D, setLabelSize3D] = useState(16);
  const [showDoors, setShowDoors] = useState(true);
  const [bgOpacity, setBgOpacity] = useState(0.5);
  const [lineOpacity, setLineOpacity] = useState(1.0);
  const [visibility, setVisibility] = useState({
    walls: true,
    doors: true,
    rooms: true,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [data, setData] = useState<FloorPlanData | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [base64Data, setBase64Data] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>(() => localStorage.getItem('gemini_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [showCloudProjects, setShowCloudProjects] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [cloudProjectIdInput, setCloudProjectIdInput] = useState('');
  const [savedProjects, setSavedProjects] = useState<{id: string, date: string}[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('saved_projects') || '[]');
    } catch {
      return [];
    }
  });
  
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  
  // History for Undo/Redo
  const [history, setHistory] = useState<FloorPlanData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const updateData = (newData: FloorPlanData, skipHistory = false) => {
    setData(newData);
    setHasUnsavedChanges(true);
    if (!skipHistory) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(newData)));
      // Limit history size
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const autoSaveProject = async () => {
    if (!data) return;
    setIsAutoSaving(true);
    try {
      let projectId = currentProjectId;
      if (!projectId) {
        projectId = Math.random().toString(36).substring(2, 15);
        setCurrentProjectId(projectId);
        window.history.pushState({}, '', `?p=${projectId}`);
      }

      let finalImagePreview = imagePreview;
      let finalBase64Data = base64Data;

      if (imagePreview && !currentProjectId) {
        // Only compress image on FIRST save (when projectId is generated) to avoid lag
        const sizeInBytes = Math.round((imagePreview.length * 3) / 4);
        const MAX_SIZE = 800000; // ~800KB
        if (sizeInBytes > MAX_SIZE) {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = imagePreview;
          });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (ctx) {
            let width = img.width;
            let height = img.height;
            let quality = 0.7;
            const MAX_DIM = 1200;
            if (width > MAX_DIM || height > MAX_DIM) {
              const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
              width = Math.floor(width * ratio);
              height = Math.floor(height * ratio);
            }
            canvas.width = width;
            canvas.height = height;
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            finalImagePreview = canvas.toDataURL('image/jpeg', quality);
            while (Math.round((finalImagePreview.length * 3) / 4) > MAX_SIZE && quality > 0.1) {
              quality -= 0.1;
              finalImagePreview = canvas.toDataURL('image/jpeg', quality);
            }
            finalBase64Data = finalImagePreview.split(',')[1];
            setImagePreview(finalImagePreview); // Save back to state
            setBase64Data(finalBase64Data);
          }
        }
      }

      const projectData = {
        userId: 'anonymous',
        data,
        imagePreview: finalImagePreview || null,
        base64Data: finalBase64Data || null,
        fileType: fileType || null,
        wallHeight,
        wallThickness,
        imageDimensions: imageDimensions || null,
        updatedAt: serverTimestamp()
      };
      
      await setDoc(doc(db, 'projects', projectId), projectData, { merge: true });
      
      // Update saved projects list for returning users
      const newProject = { id: projectId, date: new Date().toISOString() };
      setSavedProjects(prev => {
        const filtered = prev.filter(p => p.id !== projectId);
        const updated = [newProject, ...filtered].slice(0, 20);
        localStorage.setItem('saved_projects', JSON.stringify(updated));
        return updated;
      });
      
      setHasUnsavedChanges(false);
    } catch (error) {
      console.error("Autosave Error:", error);
    } finally {
      setIsAutoSaving(false);
    }
  };

  React.useEffect(() => {
    if (step !== 'upload') {
      setHasUnsavedChanges(true);
    }
  }, [wallHeight, wallThickness, labelSize3D, showDoors, step]);

  React.useEffect(() => {
    if (hasUnsavedChanges && data && step !== 'upload') {
      const timer = setTimeout(() => {
        autoSaveProject();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [hasUnsavedChanges, data, wallHeight, wallThickness, imagePreview]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setData(JSON.parse(JSON.stringify(history[newIndex])));
      setHasUnsavedChanges(true);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setData(JSON.parse(JSON.stringify(history[newIndex])));
      setHasUnsavedChanges(true);
    }
  };

  // Keyboard shortcuts for Undo/Redo
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        if (data) {
          e.preventDefault();
          const all: { type: 'wall' | 'curvedWall' | 'door' | 'room', index: number }[] = [];
          data.walls.forEach((_, i) => all.push({ type: 'wall', index: i }));
          data.curvedWalls?.forEach((_, i) => all.push({ type: 'curvedWall', index: i }));
          data.doors.forEach((_, i) => all.push({ type: 'door', index: i }));
          data.rooms.forEach((_, i) => all.push({ type: 'room', index: i }));
          setSelectedItems(all);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex, data]);

  // Check for shared project ID in URL
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('p');
    if (projectId) {
      setCurrentProjectId(projectId);
      const loadSharedProject = async () => {
        setIsProcessing(true);
        try {
          const docRef = doc(db, 'projects', projectId);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const project = docSnap.data();
            setData(project.data);
            setImagePreview(project.imagePreview);
            setBase64Data(project.base64Data);
            setFileType(project.fileType);
            setWallHeight(project.wallHeight || 3);
            setWallThickness(project.wallThickness || 0.3);
            if (project.imageDimensions) {
              setImageDimensions(project.imageDimensions);
            } else {
              setImageDimensions({ width: 1000, height: 1000 });
            }
            setStep('view3d');
            setIsSidebarOpen(false);
          } else {
            alert("找不到分享的專案。");
          }
        } catch (error) {
          console.error("Error loading shared project:", error);
        } finally {
          setIsProcessing(false);
        }
      };
      loadSharedProject();
    }
  }, []);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [doorType, setDoorType] = useState<'single' | 'double'>('single');
  const [selectedItems, setSelectedItems] = useState<{ type: 'wall' | 'curvedWall' | 'door' | 'room', index: number }[]>([]);

  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileType(file.type);
    
    if (file.type === 'application/pdf') {
      setIsProcessing(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        if (context) {
          await page.render({ canvasContext: context, viewport, canvas }).promise;
          const base64 = canvas.toDataURL('image/jpeg');
          setImagePreview(base64);
          setBase64Data(base64.split(',')[1]);
          setImageDimensions({ width: canvas.width, height: canvas.height });
        }
      } catch (error) {
        console.error("PDF rendering failed:", error);
        alert("PDF 讀取失敗，請嘗試使用圖片格式。");
      } finally {
        setIsProcessing(false);
      }
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        
        const img = new Image();
        img.onload = () => {
          setImageDimensions({ width: img.width, height: img.height });
          setImagePreview(result);
          setBase64Data(result.split(',')[1]);
        };
        img.src = result;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleScaleChange = (factor: number) => {
    if (imageDimensions) {
      setImageDimensions({
        width: imageDimensions.width * factor,
        height: imageDimensions.height * factor
      });
    }
    if (data) {
      const newData = { ...data };
      newData.walls = newData.walls.map(w => ({
        start: { x: w.start.x * factor, y: w.start.y * factor },
        end: { x: w.end.x * factor, y: w.end.y * factor }
      }));
      if (newData.curvedWalls) {
        newData.curvedWalls = newData.curvedWalls.map(w => ({
          start: { x: w.start.x * factor, y: w.start.y * factor },
          end: { x: w.end.x * factor, y: w.end.y * factor },
          control: { x: w.control.x * factor, y: w.control.y * factor }
        }));
      }
      newData.doors = newData.doors.map(d => ({
        start: { x: d.start.x * factor, y: d.start.y * factor },
        end: { x: d.end.x * factor, y: d.end.y * factor }
      }));
      newData.rooms = newData.rooms.map(r => ({
        ...r,
        position: { x: r.position.x * factor, y: r.position.y * factor }
      }));
      updateData(newData);
    }
  };

  const handleAnalyze = async () => {
    if (!base64Data) return;
    
    if (!userApiKey) {
      setShowSettings(true);
      alert("請先設定 Gemini API Key 才能使用 AI 分析功能。");
      return;
    }

    setIsProcessing(true);
    try {
      const extractedData = await analyzeFloorPlan(base64Data, fileType, userApiKey);
      
      if (imageDimensions) {
        const scaleX = imageDimensions.width / 1000;
        const scaleY = imageDimensions.height / 1000;
        const scalePoint = (p: {x: number, y: number}) => ({ x: p.x * scaleX, y: p.y * scaleY });

        extractedData.walls = extractedData.walls.map(w => ({ start: scalePoint(w.start), end: scalePoint(w.end) }));
        extractedData.doors = extractedData.doors.map(d => ({ start: scalePoint(d.start), end: scalePoint(d.end) }));
        if (extractedData.rooms) {
          extractedData.rooms = extractedData.rooms.map(r => ({ ...r, position: scalePoint(r.position) }));
        }
      }

      updateData(extractedData);
      setStep('edit2d'); // Move to 2D edit step
    } catch (error: any) {
      console.error("Error processing floor plan:", error);
      let errorMessage = "處理平面圖失敗，請重試。";
      
      if (error.message?.includes("503") || error.message?.includes("UNAVAILABLE")) {
        errorMessage = "AI 伺服器目前繁忙中 (503)，請稍候幾分鐘再試一次。";
      } else if (error.message?.includes("API Key")) {
        errorMessage = "API Key 無效或未設定，請檢查設定。";
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSelected = () => {
    if (!data || selectedItems.length === 0) return;
    const newData = JSON.parse(JSON.stringify(data));
    
    // Sort indices in descending order to avoid index shift issues
    const wallsToDelete = selectedItems.filter(item => item.type === 'wall').map(item => item.index).sort((a, b) => b - a);
    const curvedWallsToDelete = selectedItems.filter(item => item.type === 'curvedWall').map(item => item.index).sort((a, b) => b - a);
    const doorsToDelete = selectedItems.filter(item => item.type === 'door').map(item => item.index).sort((a, b) => b - a);
    const roomsToDelete = selectedItems.filter(item => item.type === 'room').map(item => item.index).sort((a, b) => b - a);

    wallsToDelete.forEach(index => newData.walls.splice(index, 1));
    curvedWallsToDelete.forEach(index => newData.curvedWalls?.splice(index, 1));
    doorsToDelete.forEach(index => newData.doors.splice(index, 1));
    roomsToDelete.forEach(index => newData.rooms.splice(index, 1));

    updateData(newData);
    setSelectedItems([]);
  };

  const handleClearAll = () => {
    if (!data) return;
    if (window.confirm('確定要清除所有牆面與門嗎？')) {
      updateData({ walls: [], doors: [], rooms: [] });
      setSelectedItems([]);
    }
  };

  const handleDownloadProject = () => {
    if (!data) return;
    const project = {
      data,
      imagePreview,
      base64Data,
      fileType,
      wallHeight,
      wallThickness,
      imageDimensions
    };
    const blob = new Blob([JSON.stringify(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `floorplan-project-${new Date().getTime()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleShare = async () => {
    if (!data) return;

    if (hasUnsavedChanges || !currentProjectId) {
      await autoSaveProject();
    }
    
    // Fallback to ensuring currentProjectId exists
    if (!currentProjectId) {
      console.error("No project ID generated.");
      return;
    }

    const url = `${window.location.origin}${window.location.pathname}?p=${currentProjectId}`;
    setShareUrl(url);

    try {
      await navigator.clipboard.writeText(url);
      alert(`專案已自動儲存在雲端並產生分享網址！\n網址已複製到剪貼簿：\n${url}\n\n您也可以在「雲端專案」中找到此專案。`);
    } catch {
      alert(`專案已自動儲存在雲端！您的網址：\n${url}`);
    }
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = JSON.parse(e.target?.result as string);
        updateData(project.data);
        setImagePreview(project.imagePreview);
        setBase64Data(project.base64Data);
        setFileType(project.fileType);
        setWallHeight(project.wallHeight || 3);
        setWallThickness(project.wallThickness || 0.3);
        if (project.imageDimensions) {
          setImageDimensions(project.imageDimensions);
        } else {
          setImageDimensions({ width: 1000, height: 1000 });
        }
        setStep('edit2d');
      } catch (error) {
        console.error("Error importing project:", error);
        alert("匯入專案失敗，請確認檔案格式正確。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen w-full bg-[#F2F2F7] text-black overflow-hidden font-sans">
      {/* Left Panel: Controls */}
      <div className={`relative flex-shrink-0 transition-all duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${isSidebarOpen ? 'w-[320px]' : 'w-0'} z-20`}>
        <div className={`absolute inset-0 w-[320px] bg-white/80 backdrop-blur-xl border-r border-slate-200/50 flex flex-col overflow-hidden transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1)] ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="p-6 pt-10">
            <div className="flex justify-between items-start">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-black flex items-center gap-2">
                  <ImageIcon className="w-6 h-6 text-ios-blue" />
                  工程平面圖
                </h1>
                <p className="text-[13px] font-medium text-ios-gray mt-1">
                  3D 平面轉換工具
                </p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setShowCloudProjects(true)}
                  className="p-2 hover:bg-slate-100 rounded-full text-slate-400"
                  title="雲端專案"
                >
                  <Cloud className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setShowSettings(true)}
                  className="p-2 hover:bg-slate-100 rounded-full text-slate-400"
                  title="設定 API Key"
                >
                  <Settings className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-6">
            {/* Step 1: Upload */}
            <div className={`space-y-3 ${step !== 'upload' ? 'opacity-50' : ''}`}>
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ios-gray flex items-center gap-2 px-1">
              <Upload className="w-3.5 h-3.5" /> 1. 上傳平面圖
            </h2>
            {step === 'upload' ? (
              <div className="space-y-4">
                <div 
                  className="ios-card p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-slate-50 transition-all border-dashed border-2 border-slate-200"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleFileUpload}
                  />
                  <Upload className="w-8 h-8 text-ios-blue mb-2" />
                  <span className="text-sm font-semibold text-slate-700">
                    {imagePreview ? '重新上傳' : '點擊上傳'}
                  </span>
                  <span className="text-[11px] text-ios-gray mt-1">支援 JPG, PNG, WEBP 或 PDF</span>
                </div>

                <div className="flex flex-col gap-2">
                  {imagePreview && (
                    <button 
                      onClick={handleAnalyze}
                      disabled={isProcessing}
                      className="ios-button-primary w-full flex items-center justify-center gap-2 shadow-md shadow-ios-blue/20"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          AI 分析中...
                        </>
                      ) : (
                        <>
                          <Edit3 className="w-5 h-5" /> 分析牆面
                        </>
                      )}
                    </button>
                  )}
                  
                  <button 
                    onClick={() => {
                      setData({ walls: [], doors: [], rooms: [] });
                      setStep('edit2d');
                    }}
                    className="ios-button-secondary w-full flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> 直接手繪平面圖
                  </button>
                  
                  <button 
                    onClick={() => importInputRef.current?.click()}
                    className="ios-button-secondary w-full flex items-center justify-center gap-2"
                  >
                    <FileJson className="w-4 h-4" /> 匯入專案 (.json)
                    <input 
                      type="file" 
                      ref={importInputRef} 
                      className="hidden" 
                      accept="application/json"
                      onChange={handleImportProject}
                    />
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <button 
                  onClick={() => { setStep('upload'); setData(null); setImagePreview(null); setBase64Data(null); }}
                  className="ios-button-secondary w-full"
                >
                  上傳新平面圖
                </button>
                <button 
                  onClick={handleDownloadProject}
                  className="ios-button-secondary w-full flex items-center justify-center gap-2 text-ios-blue"
                >
                  <Download className="w-4 h-4" /> 下載專案檔
                </button>
                <button 
                  onClick={handleShare}
                  disabled={isSaving}
                  className="ios-button-secondary w-full flex items-center justify-center gap-2 text-green-600 border-green-100 bg-green-50/30"
                >
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                  分享專案
                </button>
              </div>
            )}
          </div>

          {/* Step 2: 2D Edit */}
          {data && (
            <div className={`space-y-4 ${step === 'view3d' ? 'opacity-50' : ''}`}>
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ios-gray flex items-center gap-2 px-1">
                <Edit3 className="w-3.5 h-3.5" /> 2. 確認與編輯
              </h2>
              
              {step === 'edit2d' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setDrawMode('none')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium transition-all ${drawMode === 'none' ? 'bg-ios-blue text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}`}
                    >
                      <MousePointer2 className="w-4 h-4" /> 選取
                    </button>
                    <button 
                      onClick={() => setDrawMode('scale')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium transition-all ${drawMode === 'scale' ? 'bg-ios-blue text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}`}
                    >
                      <Ruler className="w-4 h-4" /> 比例
                    </button>
                    <button 
                      onClick={handleDeleteSelected}
                      disabled={selectedItems.length === 0}
                      className="flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium bg-white text-red-500 border border-slate-200 active:bg-red-50 disabled:opacity-30 transition-all"
                    >
                      <Trash2 className="w-4 h-4" /> 刪除
                    </button>
                    <button 
                      onClick={() => setDrawMode('wall')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium transition-all ${drawMode === 'wall' ? 'bg-ios-blue text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}`}
                    >
                      <Plus className="w-4 h-4" /> 牆壁
                    </button>
                    <button 
                      onClick={() => setDrawMode('curve')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium transition-all ${drawMode === 'curve' ? 'bg-ios-blue text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}`}
                    >
                      <Plus className="w-4 h-4" /> 曲線牆
                    </button>
                    <button 
                      onClick={() => setDrawMode('door')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium transition-all ${drawMode === 'door' ? 'bg-ios-blue text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}`}
                    >
                      <Plus className="w-4 h-4" /> 門
                    </button>
                    <button 
                      onClick={() => setDrawMode('text')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium transition-all ${drawMode === 'text' ? 'bg-ios-blue text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 active:bg-slate-50'}`}
                    >
                      <Plus className="w-4 h-4" /> 文字
                    </button>
                    
                    {drawMode === 'door' && (
                      <div className="col-span-2 flex gap-1 bg-slate-100 p-1 rounded-[10px]">
                        <button
                          onClick={() => setDoorType('single')}
                          className={`flex-1 py-1.5 px-2 rounded-[8px] text-[11px] font-semibold transition-all ${doorType === 'single' ? 'bg-white text-ios-blue shadow-sm' : 'text-ios-gray hover:text-slate-700'}`}
                        >
                          單開門 (90cm)
                        </button>
                        <button
                          onClick={() => setDoorType('double')}
                          className={`flex-1 py-1.5 px-2 rounded-[8px] text-[11px] font-semibold transition-all ${doorType === 'double' ? 'bg-white text-ios-blue shadow-sm' : 'text-ios-gray hover:text-slate-700'}`}
                        >
                          雙開門 (180cm)
                        </button>
                      </div>
                    )}

                    <div className="flex gap-1 col-span-2">
                      <button 
                        onClick={handleUndo}
                        disabled={historyIndex <= 0}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium bg-white text-slate-600 border border-slate-200 active:bg-slate-50 disabled:opacity-30 transition-all"
                        title="復原 (Ctrl+Z)"
                      >
                        <Undo2 className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={handleRedo}
                        disabled={historyIndex >= history.length - 1}
                        className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium bg-white text-slate-600 border border-slate-200 active:bg-slate-50 disabled:opacity-30 transition-all"
                        title="重做 (Ctrl+Shift+Z)"
                      >
                        <Redo2 className="w-4 h-4" />
                      </button>
                    </div>
                    
                    <div className="col-span-2 space-y-1.5">
                      <p className="text-[10px] font-bold text-ios-gray uppercase px-1 tracking-wider">全選</p>
                      <div className="grid grid-cols-3 gap-1.5">
                        <button 
                          onClick={() => setSelectedItems(data.walls.map((_, i) => ({ type: 'wall', index: i })))}
                          className="flex items-center justify-center gap-1 py-2 px-2 rounded-[10px] text-[10px] font-bold bg-white text-slate-600 border border-slate-200 active:bg-ios-blue/5 active:text-ios-blue transition-all"
                        >
                          牆面
                        </button>
                        <button 
                          onClick={() => setSelectedItems(data.doors.map((_, i) => ({ type: 'door', index: i })))}
                          className="flex items-center justify-center gap-1 py-2 px-2 rounded-[10px] text-[10px] font-bold bg-white text-slate-600 border border-slate-200 active:bg-ios-blue/5 active:text-ios-blue transition-all"
                        >
                          門
                        </button>
                        <button 
                          onClick={() => setSelectedItems((data.rooms || []).map((_, i) => ({ type: 'room', index: i })))}
                          className="flex items-center justify-center gap-1 py-2 px-2 rounded-[10px] text-[10px] font-bold bg-white text-slate-600 border border-slate-200 active:bg-ios-blue/5 active:text-ios-blue transition-all"
                        >
                          文字
                        </button>
                      </div>
                    </div>

                    <button 
                      onClick={handleClearAll}
                      className="col-span-2 flex items-center justify-center gap-2 py-2 px-3 rounded-[10px] text-sm font-medium bg-white text-red-500 border border-red-100 active:bg-red-50 transition-all"
                    >
                      <Trash2 className="w-4 h-4" /> 一鍵清除所有
                    </button>
                  </div>

                  <div className="ios-card p-4 space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-700">牆面厚度</label>
                        <span className="text-xs font-mono text-ios-gray bg-slate-100 px-1.5 py-0.5 rounded">{wallThickness.toFixed(2)}m</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1.0" 
                        step="0.05" 
                        value={wallThickness}
                        onChange={(e) => setWallThickness(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ios-blue"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-700">線條透明度</label>
                        <span className="text-xs font-mono text-ios-gray bg-slate-100 px-1.5 py-0.5 rounded">{Math.round(lineOpacity * 100)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="1" 
                        step="0.05" 
                        value={lineOpacity}
                        onChange={(e) => setLineOpacity(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ios-blue"
                      />
                    </div>

                    <div className="space-y-3 pt-2 border-t border-slate-50">
                      <h3 className="text-[11px] font-bold text-ios-gray uppercase tracking-wider">圖層顯示</h3>
                      <div className="grid grid-cols-3 gap-2">
                        <button 
                          onClick={() => setVisibility({...visibility, walls: !visibility.walls})}
                          className={`flex flex-col items-center gap-1 p-2 rounded-[12px] border transition-all ${visibility.walls ? 'bg-ios-blue/5 border-ios-blue/20 text-ios-blue' : 'bg-slate-50 border-slate-100 text-ios-gray'}`}
                        >
                          {visibility.walls ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          <span className="text-[10px] font-bold">牆面</span>
                        </button>
                        <button 
                          onClick={() => setVisibility({...visibility, doors: !visibility.doors})}
                          className={`flex flex-col items-center gap-1 p-2 rounded-[12px] border transition-all ${visibility.doors ? 'bg-ios-blue/5 border-ios-blue/20 text-ios-blue' : 'bg-slate-50 border-slate-100 text-ios-gray'}`}
                        >
                          {visibility.doors ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          <span className="text-[10px] font-bold">門</span>
                        </button>
                        <button 
                          onClick={() => setVisibility({...visibility, rooms: !visibility.rooms})}
                          className={`flex flex-col items-center gap-1 p-2 rounded-[12px] border transition-all ${visibility.rooms ? 'bg-ios-blue/5 border-ios-blue/20 text-ios-blue' : 'bg-slate-50 border-slate-100 text-ios-gray'}`}
                        >
                          {visibility.rooms ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                          <span className="text-[10px] font-bold">文字</span>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-700">底圖透明度</label>
                        <span className="text-xs font-mono text-ios-gray bg-slate-100 px-1.5 py-0.5 rounded">{Math.round(bgOpacity * 100)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05" 
                        value={bgOpacity}
                        onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ios-blue"
                      />
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <button 
                      onClick={() => setStep('view3d')}
                      className="ios-button-primary w-full flex items-center justify-center gap-2 py-3 shadow-lg shadow-ios-blue/25"
                    >
                      <Box className="w-5 h-5" /> 生成 3D 視圖
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setStep('edit2d')}
                  className="ios-button-secondary w-full"
                >
                  返回 2D 編輯器
                </button>
              )}
            </div>
          )}

          {/* Step 3: 3D Controls */}
          {step === 'view3d' && (
            <div className="space-y-4">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ios-gray flex items-center gap-2 px-1">
                <SlidersHorizontal className="w-3.5 h-3.5" /> 3. 3D 控制
              </h2>
              
              <div className="ios-card p-4 space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-700">牆面高度</label>
                    <span className="text-xs font-mono text-ios-gray bg-slate-100 px-1.5 py-0.5 rounded">{wallHeight.toFixed(1)}m</span>
                  </div>
                  <input 
                    type="range" 
                    min="2.1" 
                    max="6" 
                    step="0.1" 
                    value={wallHeight}
                    onChange={(e) => setWallHeight(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ios-blue"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-700">牆面厚度</label>
                    <span className="text-xs font-mono text-ios-gray bg-slate-100 px-1.5 py-0.5 rounded">{wallThickness.toFixed(2)}m</span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="1.0" 
                    step="0.05" 
                    value={wallThickness}
                    onChange={(e) => setWallThickness(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ios-blue"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-semibold text-slate-700">3D 標籤大小</label>
                    <span className="text-xs font-mono text-ios-gray bg-slate-100 px-1.5 py-0.5 rounded">{labelSize3D}px</span>
                  </div>
                  <input 
                    type="range" 
                    min="8" 
                    max="48" 
                    step="1" 
                    value={labelSize3D}
                    onChange={(e) => setLabelSize3D(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-ios-blue"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-50">
                  <label className="text-xs font-semibold text-slate-700">顯示門</label>
                  <button
                    onClick={() => setShowDoors(!showDoors)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showDoors ? 'bg-ios-blue' : 'bg-slate-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${showDoors ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>
              </div>

              <div className="p-3 bg-ios-blue/5 text-ios-blue text-[11px] rounded-[12px] border border-ios-blue/10 leading-relaxed">
                <p className="font-bold mb-1 flex items-center gap-1">
                  <Box className="w-3 h-3" /> 使用提示
                </p>
                <ul className="list-disc pl-4 space-y-1 opacity-80">
                  <li>在 3D 視角中雙擊地板，可設置第一人稱的出發點。</li>
                  <li>使用滑鼠中鍵可平移視角。</li>
                </ul>
              </div>
            </div>
          )}
          
          {/* Stats */}
          {data && (
            <div className="space-y-3 pt-4 border-t border-slate-100 mt-auto">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="ios-card py-2 px-1">
                  <div className="text-lg font-bold text-slate-800">{data.walls.length}</div>
                  <div className="text-[9px] font-bold text-ios-gray uppercase tracking-wider">牆壁</div>
                </div>
                <div className="ios-card py-2 px-1">
                  <div className="text-lg font-bold text-red-500">{data.doors.length}</div>
                  <div className="text-[9px] font-bold text-ios-gray uppercase tracking-wider">門</div>
                </div>
                <div className="ios-card py-2 px-1">
                  <div className="text-lg font-bold text-ios-blue">{data.rooms?.length || 0}</div>
                  <div className="text-[9px] font-bold text-ios-gray uppercase tracking-wider">空間</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
      
      {/* Sidebar Toggle Button */}
      <button
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className={`absolute top-1/2 -translate-y-1/2 z-30 ios-glass border border-white/20 shadow-xl rounded-full p-2 text-slate-500 hover:text-ios-blue transition-all duration-300 flex items-center justify-center`}
        style={{ left: isSidebarOpen ? '304px' : '0px', transform: isSidebarOpen ? 'translateY(-50%)' : 'translate(16px, -50%)' }}
        title={isSidebarOpen ? "隱藏側邊欄" : "顯示側邊欄"}
      >
        {isSidebarOpen ? <ChevronLeft className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
      </button>

      {/* Right Panel: Viewport */}
      <div className="flex-1 relative bg-slate-900">
        {step === 'upload' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 flex-col gap-6 bg-ios-bg p-8">
            {imagePreview ? (
              <div className="relative w-full h-full flex items-center justify-center">
                {fileType === 'application/pdf' ? (
                  <div className="flex flex-col items-center gap-6">
                    <div className="w-40 h-52 ios-card flex items-center justify-center shadow-2xl border-white/40">
                      <span className="text-3xl font-bold text-slate-300 uppercase tracking-widest">PDF</span>
                    </div>
                    <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">PDF 文件已就緒</p>
                  </div>
                ) : (
                  <img 
                    src={imagePreview} 
                    alt="Preview" 
                    className="max-w-full max-h-full object-contain shadow-2xl rounded-2xl border-4 border-white/20"
                  />
                )}
                <div className="absolute top-6 left-6 ios-glass px-4 py-1.5 rounded-full text-[10px] font-bold text-ios-blue uppercase tracking-widest border border-white/20 shadow-sm">
                  Preview Mode
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="w-32 h-32 ios-glass rounded-full flex items-center justify-center shadow-2xl border-white/20">
                  <ImageIcon className="w-10 h-10 text-ios-blue/40" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-xl font-bold text-slate-800">開始您的工程平面圖</p>
                  <p className="text-sm font-medium text-slate-400">請在左側上傳圖片或 PDF 文件</p>
                </div>
              </div>
            )}
          </div>
        )}
        
        {step === 'edit2d' && data && (
          <FloorPlan2D 
            data={data} 
            onChange={(newData) => updateData(newData)} 
            imagePreview={imagePreview}
            drawMode={drawMode}
            setDrawMode={setDrawMode}
            doorType={doorType}
            onDrawComplete={() => setDrawMode('none')}
            selectedItems={selectedItems}
            setSelectedItems={setSelectedItems}
            bgOpacity={bgOpacity}
            lineOpacity={lineOpacity}
            wallThickness={wallThickness}
            visibility={visibility}
            imageDimensions={imageDimensions}
            onScaleChange={handleScaleChange}
          />
        )}

        {step === 'view3d' && data && (
          <FloorPlan3D data={data} wallHeight={wallHeight} wallThickness={wallThickness} imageDimensions={imageDimensions} labelSize3D={labelSize3D} showDoors={showDoors} onChange={updateData} />
        )}

        {/* Settings Modal */}
        {showSettings && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
            <div className="ios-card w-full max-w-md shadow-2xl overflow-hidden border-white/40">
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-white/50">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-ios-blue" />
                  API 設定
                </h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-black/5 rounded-full text-slate-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">Gemini API Key</label>
                  <input 
                    type="password"
                    value={userApiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUserApiKey(val);
                      localStorage.setItem('gemini_api_key', val);
                    }}
                    placeholder="輸入您的 API Key..."
                    className="ios-input font-mono"
                  />
                  <p className="text-[11px] text-slate-400 leading-relaxed px-1">
                    此金鑰將儲存在您的瀏覽器中，用於 AI 分析平面圖。
                  </p>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="ios-button-primary w-full py-4 text-base"
                >
                  儲存並關閉
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Cloud Projects Modal */}
        {showCloudProjects && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-sm p-4">
            <div className="ios-card w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[80vh] border-white/40">
              <div className="p-6 border-b border-black/5 flex justify-between items-center bg-white/50">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Cloud className="w-5 h-5 text-ios-blue" />
                  雲端專案
                </h3>
                <button 
                  onClick={() => setShowCloudProjects(false)}
                  className="p-2 hover:bg-black/5 rounded-full text-slate-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6 overflow-y-auto">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider ml-1">開啟舊檔 (輸入專案 ID 或網址)</label>
                  <div className="flex gap-3">
                    <input 
                      type="text"
                      value={cloudProjectIdInput}
                      onChange={(e) => setCloudProjectIdInput(e.target.value)}
                      placeholder="例如: abc123xyz"
                      className="ios-input flex-1 font-mono text-sm"
                    />
                    <button 
                      onClick={() => {
                        let id = cloudProjectIdInput.trim();
                        if (id.includes('?p=')) {
                          id = id.split('?p=')[1].split('&')[0];
                        }
                        if (id) {
                          window.location.href = `${window.location.origin}${window.location.pathname}?p=${id}`;
                        }
                      }}
                      className="ios-button-primary px-6"
                    >
                      載入
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-black/5 pb-2 ml-1">最近儲存的專案</h4>
                  {savedProjects.length === 0 ? (
                    <p className="text-sm text-slate-400 italic text-center py-8">尚無儲存紀錄</p>
                  ) : (
                    <div className="space-y-3">
                      {savedProjects.map((p) => (
                        <div key={p.id} className="flex items-center justify-between p-4 bg-white/40 rounded-2xl border border-white/60 hover:border-ios-blue/30 transition-all shadow-sm">
                          <div className="flex flex-col">
                            <span className="text-sm font-mono font-bold text-slate-700">{p.id}</span>
                            <span className="text-[10px] font-medium text-slate-400">{new Date(p.date).toLocaleString()}</span>
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => {
                                const url = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
                                navigator.clipboard.writeText(url);
                                alert('網址已複製！');
                              }}
                              className="p-2.5 text-slate-400 hover:text-ios-blue hover:bg-white rounded-xl transition-all shadow-sm"
                              title="複製連結"
                            >
                              <Share2 className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => {
                                window.location.href = `${window.location.origin}${window.location.pathname}?p=${p.id}`;
                              }}
                              className="p-2.5 text-slate-400 hover:text-ios-blue hover:bg-white rounded-xl transition-all shadow-sm"
                              title="開啟專案"
                            >
                              <FolderOpen className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
