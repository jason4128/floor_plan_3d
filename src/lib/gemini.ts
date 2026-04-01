import { GoogleGenAI, Type } from "@google/genai";

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  start: Point;
  end: Point;
}

export interface Door {
  start: Point;
  end: Point;
}

export interface Room {
  name: string;
  position: Point;
  fontSize?: number;
  color?: string;
}

export interface FloorPlanData {
  walls: Wall[];
  doors: Door[];
  rooms: Room[];
}

export async function analyzeFloorPlan(base64Image: string, mimeType: string, customApiKey?: string, modelName: string = "gemini-3.1-pro-preview"): Promise<FloorPlanData> {
  const apiKey = customApiKey || process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error("Missing Gemini API Key. Please provide it in the settings.");
  }

  const ai = new GoogleGenAI({ apiKey });

  const prompt = `你是一位專業的建築工程師與室內設計師。請精確分析這張工程平面圖。
  1. 辨識所有結構牆（粗線）與隔間牆（細線）。
  2. 辨識所有門的開口位置與寬度。
  3. 辨識所有空間名稱（如：客廳、臥室、廚房、衛浴、陽台等）及其中心位置。
  請以圖片左上角為原點 (0, 0)，將座標標準化為 1000 x 1000 的網格系統。
  忽略家具、衛浴設備、電氣符號，除非它們定義了房間邊界。
  請輸出一個 JSON 格式的數據：
  {
    "walls": [{"start": {"x": 0-1000, "y": 0-1000}, "end": {"x": 0-1000, "y": 0-1000}}],
    "doors": [{"start": {"x": 0-1000, "y": 0-1000}, "end": {"x": 0-1000, "y": 0-1000}}],
    "rooms": [{"name": "空間名稱", "position": {"x": 0-1000, "y": 0-1000}}]
  }
  確保座標精確反映圖面結構，牆線應盡可能相連以形成封閉空間。僅輸出 JSON。`;

  const response = await ai.models.generateContent({
    model: modelName,
    contents: {
      parts: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType,
          },
        },
        {
          text: prompt,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          walls: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: {
                  type: Type.OBJECT,
                  properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                  required: ["x", "y"],
                },
                end: {
                  type: Type.OBJECT,
                  properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                  required: ["x", "y"],
                },
              },
              required: ["start", "end"],
            },
          },
          doors: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: {
                  type: Type.OBJECT,
                  properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                  required: ["x", "y"],
                },
                end: {
                  type: Type.OBJECT,
                  properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                  required: ["x", "y"],
                },
              },
              required: ["start", "end"],
            },
          },
          rooms: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING },
                position: {
                  type: Type.OBJECT,
                  properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } },
                  required: ["x", "y"],
                },
              },
              required: ["name", "position"],
            },
          },
        },
        required: ["walls", "doors", "rooms"],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Failed to generate content.");
  }

  try {
    return JSON.parse(text) as FloorPlanData;
  } catch (e) {
    console.error("Failed to parse JSON:", text);
    throw new Error("Invalid JSON response from AI.");
  }
}
