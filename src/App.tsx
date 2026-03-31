import React, { useState, useRef } from 'react';
import { Upload, SlidersHorizontal, Loader2, Image as ImageIcon, Edit3, Box, Plus, Trash2, MousePointer2, Download, FileJson, Share2, LogIn, LogOut, Eye, EyeOff, Settings, X } from 'lucide-react';
import { FloorPlan3D } from './components/FloorPlan3D';
import { FloorPlan2D } from './components/FloorPlan2D';
import { analyzeFloorPlan, FloorPlanData } from './lib/gemini';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as pdfjsLib from 'pdfjs-dist';

// Set up PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

type Step = 'upload' | 'edit2d' | 'view3d';
type DrawMode = 'none' | 'wall' | 'door' | 'text';

export default function App() {
  const [step, setStep] = useState<Step>('upload');
  const [wallHeight, setWallHeight] = useState(3);
  const [wallThickness, setWallThickness] = useState(0.3);
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
  const [user, setUser] = useState<User | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>(() => localStorage.getItem('gemini_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  
  // Auth listener
  React.useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
    });
    return () => unsubscribe();
  }, []);

  // Check for shared project ID in URL
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('p');
    if (projectId) {
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
            setStep('edit2d');
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
  const [selectedItems, setSelectedItems] = useState<{ type: 'wall' | 'door' | 'room', index: number }[]>([]);

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
        setImagePreview(result);
        setBase64Data(result.split(',')[1]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAnalyze = async () => {
    if (!base64Data) return;

    setIsProcessing(true);
    try {
      const extractedData = await analyzeFloorPlan(base64Data, fileType, userApiKey);
      setData(extractedData);
      setStep('edit2d'); // Move to 2D edit step
    } catch (error) {
      console.error("Error processing floor plan:", error);
      alert(error instanceof Error ? error.message : "處理平面圖失敗，請重試。");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteSelected = () => {
    if (!data || selectedItems.length === 0) return;
    const newData = { ...data };
    
    // Sort indices in descending order to avoid index shift issues
    const wallsToDelete = selectedItems.filter(item => item.type === 'wall').map(item => item.index).sort((a, b) => b - a);
    const doorsToDelete = selectedItems.filter(item => item.type === 'door').map(item => item.index).sort((a, b) => b - a);
    const roomsToDelete = selectedItems.filter(item => item.type === 'room').map(item => item.index).sort((a, b) => b - a);

    wallsToDelete.forEach(index => newData.walls.splice(index, 1));
    doorsToDelete.forEach(index => newData.doors.splice(index, 1));
    roomsToDelete.forEach(index => newData.rooms.splice(index, 1));

    setData(newData);
    setSelectedItems([]);
  };

  const handleClearAll = () => {
    if (!data) return;
    if (window.confirm('確定要清除所有牆面與門嗎？')) {
      setData({ walls: [], doors: [], rooms: [] });
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
      wallThickness
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

    setIsSaving(true);
    try {
      const projectId = Math.random().toString(36).substring(2, 15);
      const projectData = {
        userId: user ? user.uid : 'anonymous',
        data,
        imagePreview,
        base64Data,
        fileType,
        wallHeight,
        wallThickness,
        createdAt: serverTimestamp()
      };
      
      await setDoc(doc(db, 'projects', projectId), projectData);
      
      const url = `${window.location.origin}${window.location.pathname}?p=${projectId}`;
      setShareUrl(url);
      
      // Copy to clipboard
      await navigator.clipboard.writeText(url);
      alert(`專案已儲存並產生分享網址！網址已複製到剪貼簿：\n${url}`);
    } catch (error) {
      console.error("Error sharing project:", error);
      alert("分享失敗，請確認資料庫權限。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const project = JSON.parse(e.target?.result as string);
        setData(project.data);
        setImagePreview(project.imagePreview);
        setBase64Data(project.base64Data);
        setFileType(project.fileType);
        setWallHeight(project.wallHeight || 3);
        setWallThickness(project.wallThickness || 0.3);
        setStep('edit2d');
      } catch (error) {
        console.error("Error importing project:", error);
        alert("匯入專案失敗，請確認檔案格式正確。");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex h-screen w-full bg-slate-50 text-slate-900 overflow-hidden">
      {/* Left Panel: Controls */}
      <div className="w-80 bg-white border-r border-slate-200 shadow-sm flex flex-col z-10">
        <div className="p-6 border-b border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <ImageIcon className="w-6 h-6 text-blue-600" />
                平面圖轉 3D
              </h1>
              <p className="text-sm text-slate-500 mt-1">
                將 2D 平面圖轉換為 3D 模型。
              </p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setShowSettings(true)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400"
                title="設定 API Key"
              >
                <Settings className="w-4 h-4" />
              </button>
              {user ? (
                <button 
                  onClick={() => signOut(auth)}
                  className="p-2 hover:bg-slate-100 rounded-full text-slate-400"
                  title={`已登入: ${user.email}`}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              ) : (
                <button 
                  onClick={() => signInWithGoogle()}
                  className="p-2 hover:bg-blue-50 rounded-full text-blue-600"
                  title="登入"
                >
                  <LogIn className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 flex-1 overflow-y-auto flex flex-col gap-6">
          {/* Step 1: Upload */}
          <div className={`space-y-3 ${step !== 'upload' ? 'opacity-50' : ''}`}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Upload className="w-4 h-4" /> 1. 上傳平面圖
            </h2>
            {step === 'upload' ? (
              <div className="space-y-4">
                <div 
                  className="border-2 border-dashed border-slate-300 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-slate-50 hover:border-blue-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={handleFileUpload}
                  />
                  <Upload className="w-8 h-8 text-slate-400 mb-2" />
                  <span className="text-sm font-medium text-slate-700">
                    {imagePreview ? '重新上傳' : '點擊上傳'}
                  </span>
                  <span className="text-xs text-slate-500 mt-1">支援 JPG, PNG, WEBP 或 PDF</span>
                </div>

                <div className="flex flex-col gap-2">
                  {imagePreview && (
                    <button 
                      onClick={handleAnalyze}
                      disabled={isProcessing}
                      className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center justify-center gap-2"
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
                    className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    <Plus className="w-4 h-4" /> 直接手繪平面圖
                  </button>
                  
                  <button 
                    onClick={() => importInputRef.current?.click()}
                    className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
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
                  className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                >
                  上傳新平面圖
                </button>
                <button 
                  onClick={handleDownloadProject}
                  className="w-full py-2 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 border border-blue-100"
                >
                  <Download className="w-4 h-4" /> 下載專案檔
                </button>
                <button 
                  onClick={handleShare}
                  disabled={isSaving}
                  className="w-full py-2 px-4 bg-green-50 hover:bg-green-100 text-green-700 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 border border-green-100 disabled:opacity-50"
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
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Edit3 className="w-4 h-4" /> 2. 確認與編輯
              </h2>
              
              {step === 'edit2d' ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <button 
                      onClick={() => setDrawMode('none')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${drawMode === 'none' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                    >
                      <MousePointer2 className="w-4 h-4" /> 選取
                    </button>
                    <button 
                      onClick={handleDeleteSelected}
                      disabled={selectedItems.length === 0}
                      className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium bg-slate-50 text-red-600 border border-slate-200 hover:bg-red-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Trash2 className="w-4 h-4" /> 刪除
                    </button>
                    <button 
                      onClick={() => setDrawMode('wall')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${drawMode === 'wall' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                    >
                      <Plus className="w-4 h-4" /> 牆壁
                    </button>
                    <button 
                      onClick={() => setDrawMode('door')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${drawMode === 'door' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                    >
                      <Plus className="w-4 h-4" /> 門
                    </button>
                    <button 
                      onClick={() => setDrawMode('text')}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${drawMode === 'text' ? 'bg-amber-100 text-amber-700 border border-amber-200' : 'bg-slate-50 text-slate-600 border border-slate-200 hover:bg-slate-100'}`}
                    >
                      <Plus className="w-4 h-4" /> 文字
                    </button>
                    <button 
                      onClick={handleClearAll}
                      className="col-span-2 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium bg-red-50 text-red-700 border border-red-100 hover:bg-red-100 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" /> 一鍵清除所有
                    </button>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-medium text-slate-700">牆面厚度</label>
                      <span className="text-sm text-slate-500">{wallThickness.toFixed(2)}m</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1.0" 
                      step="0.05" 
                      value={wallThickness}
                      onChange={(e) => setWallThickness(parseFloat(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex justify-between">
                      <label className="text-sm font-medium text-slate-700">線條透明度</label>
                      <span className="text-sm text-slate-500">{Math.round(lineOpacity * 100)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="1" 
                      step="0.05" 
                      value={lineOpacity}
                      onChange={(e) => setLineOpacity(parseFloat(e.target.value))}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="space-y-4 pt-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                        <SlidersHorizontal className="w-4 h-4" /> 圖層顯示
                      </h3>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button 
                        onClick={() => setVisibility({...visibility, walls: !visibility.walls})}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${visibility.walls ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                      >
                        {visibility.walls ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        <span className="text-[10px] font-bold">牆面</span>
                      </button>
                      <button 
                        onClick={() => setVisibility({...visibility, doors: !visibility.doors})}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${visibility.doors ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                      >
                        {visibility.doors ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        <span className="text-[10px] font-bold">門</span>
                      </button>
                      <button 
                        onClick={() => setVisibility({...visibility, rooms: !visibility.rooms})}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${visibility.rooms ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-400'}`}
                      >
                        {visibility.rooms ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        <span className="text-[10px] font-bold">文字</span>
                      </button>
                    </div>

                    <div className="space-y-2 pt-2">
                      <div className="flex justify-between">
                        <label className="text-sm font-medium text-slate-700">底圖透明度</label>
                        <span className="text-sm text-slate-500">{Math.round(bgOpacity * 100)}%</span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="1" 
                        step="0.05" 
                        value={bgOpacity}
                        onChange={(e) => setBgOpacity(parseFloat(e.target.value))}
                        className="w-full accent-blue-600"
                      />
                    </div>
                  </div>
                  
                  <div className="pt-2">
                    <button 
                      onClick={() => setStep('view3d')}
                      className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Box className="w-5 h-5" /> 生成 3D 視圖
                    </button>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => setStep('edit2d')}
                  className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm font-medium transition-colors"
                >
                  返回 2D 編輯器
                </button>
              )}
            </div>
          )}

          {/* Step 3: 3D Controls */}
          {step === 'view3d' && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4" /> 3. 3D 控制
              </h2>
              
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-sm font-medium text-slate-700">牆面高度</label>
                  <span className="text-sm text-slate-500">{wallHeight.toFixed(1)}m</span>
                </div>
                <input 
                  type="range" 
                  min="1" 
                  max="6" 
                  step="0.1" 
                  value={wallHeight}
                  onChange={(e) => setWallHeight(parseFloat(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-sm font-medium text-slate-700">牆面厚度</label>
                  <span className="text-sm text-slate-500">{wallThickness.toFixed(2)}m</span>
                </div>
                <input 
                  type="range" 
                  min="0.1" 
                  max="1.0" 
                  step="0.05" 
                  value={wallThickness}
                  onChange={(e) => setWallThickness(parseFloat(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </div>
            </div>
          )}
          
          {/* Stats */}
          {data && (
            <div className="space-y-3 pt-4 border-t border-slate-100 mt-auto">
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-slate-50 p-2 rounded-lg border border-slate-100">
                  <div className="text-xl font-bold text-slate-700">{data.walls.length}</div>
                  <div className="text-xs text-slate-500">牆壁</div>
                </div>
                <div className="bg-red-50 p-2 rounded-lg border border-red-100">
                  <div className="text-xl font-bold text-red-700">{data.doors.length}</div>
                  <div className="text-xs text-red-500">門</div>
                </div>
                <div className="bg-blue-50 p-2 rounded-lg border border-blue-100">
                  <div className="text-xl font-bold text-blue-700">{data.rooms?.length || 0}</div>
                  <div className="text-xs text-blue-500">空間</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Viewport */}
      <div className="flex-1 relative bg-slate-900">
        {step === 'upload' && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 flex-col gap-4 bg-slate-50 p-8">
            {imagePreview ? (
              <div className="relative w-full h-full flex items-center justify-center">
                {fileType === 'application/pdf' ? (
                  <div className="flex flex-col items-center gap-4 text-slate-400">
                    <div className="w-32 h-40 bg-slate-100 border-2 border-slate-200 rounded-lg flex items-center justify-center shadow-sm">
                      <span className="text-xl font-bold text-slate-300 uppercase">PDF</span>
                    </div>
                    <p className="text-sm font-medium text-slate-500">PDF 文件已上傳，點擊「分析牆面」開始</p>
                  </div>
                ) : (
                  <img 
                    src={imagePreview} 
                    alt="Preview" 
                    className="max-w-full max-h-full object-contain shadow-lg rounded-sm"
                  />
                )}
                <div className="absolute top-4 left-4 bg-white/80 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-semibold text-slate-600 border border-slate-200 shadow-sm">
                  預覽模式
                </div>
              </div>
            ) : (
              <>
                <div className="w-24 h-24 border-4 border-dashed border-slate-300 rounded-full flex items-center justify-center">
                  <ImageIcon className="w-8 h-8 text-slate-400" />
                </div>
                <p className="text-lg font-medium text-slate-600">請上傳平面圖以開始</p>
              </>
            )}
          </div>
        )}
        
        {step === 'edit2d' && data && (
          <FloorPlan2D 
            data={data} 
            onChange={setData} 
            imagePreview={imagePreview}
            drawMode={drawMode}
            onDrawComplete={() => setDrawMode('none')}
            selectedItems={selectedItems}
            setSelectedItems={setSelectedItems}
            bgOpacity={bgOpacity}
            lineOpacity={lineOpacity}
            wallThickness={wallThickness}
            visibility={visibility}
          />
        )}

        {step === 'view3d' && data && (
          <FloorPlan3D data={data} wallHeight={wallHeight} wallThickness={wallThickness} />
        )}

        {/* Settings Modal */}
        {showSettings && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-600" />
                  API 設定
                </h3>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-slate-700">Gemini API Key</label>
                  <input 
                    type="password"
                    value={userApiKey}
                    onChange={(e) => {
                      const val = e.target.value;
                      setUserApiKey(val);
                      localStorage.setItem('gemini_api_key', val);
                    }}
                    placeholder="輸入您的 API Key..."
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono"
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    此金鑰將儲存在您的瀏覽器中，用於 AI 分析平面圖。
                    如果您在 GitHub Pages 上使用，請務必在此設定金鑰。
                  </p>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold transition-all shadow-lg shadow-blue-200"
                >
                  儲存並關閉
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
