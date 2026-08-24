import { GoogleGenAI } from '@google/genai';

/**
 * 1. 구글 공식 무버전 최신 기본 별칭 (버전 업데이트 시에도 항상 최신 안정 버전을 가리킴)
 */
export const DEFAULT_OFFICIAL_ALIASES = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-pro-latest',
];

let cachedDiscoveredModels: string[] | null = null;
let lastDiscoveryTime: number = 0;

/**
 * 2. 구글 서버에서 현재 실제 가용한 텍스트 모델을 실시간 자동 발굴 (화이트리스트 관리 제로)
 */
export async function getDynamicModelPool(ai: GoogleGenAI): Promise<string[]> {
  const now = Date.now();
  if (cachedDiscoveredModels && now - lastDiscoveryTime < 1800000) {
    return cachedDiscoveredModels;
  }

  try {
    const list = await ai.models.list();
    const discovered: string[] = [];
    for await (const m of list) {
      const name = m.name?.replace(/^models\//, '');
      if (
        name &&
        (name.includes('flash') || name.includes('pro')) &&
        !name.includes('tts') &&
        !name.includes('image') &&
        !name.includes('audio') &&
        !name.includes('embedding') &&
        !name.includes('robotics') &&
        !name.includes('preview')
      ) {
        discovered.push(name);
      }
    }

    // 기본 공식 별칭을 최우선으로 두고, 발굴된 실시간 모델 목록을 후순위 결합
    const merged = Array.from(new Set([...DEFAULT_OFFICIAL_ALIASES, ...discovered]));
    cachedDiscoveredModels = merged;
    lastDiscoveryTime = now;
    return merged;
  } catch {
    return DEFAULT_OFFICIAL_ALIASES;
  }
}

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: {
      systemInstruction?: string;
      responseMimeType?: string;
      temperature?: number;
      maxOutputTokens?: number;
    };
  }
) {
  let lastError: any = null;
  const modelsToTry = await getDynamicModelPool(ai);

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: params.config,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.warn(`⚠️ [Gemini Fallback] 모델 "${modelName}" 호출 실패 (${err?.status || err?.name || ''}: ${errMsg.slice(0, 100)}) -> 다음 가용 모델로 자동 전환...`);
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
  }

  throw new Error(`[Gemini] 전체 가용 모델(${modelsToTry.join(', ')}) 호출 실패. 마지막 오류: ${lastError?.message || lastError}`);
}

export function safeJsonParse<T>(rawText: string, fallback: T): T {
  if (!rawText) return fallback;
  try {
    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    }
    return JSON.parse(cleaned) as T;
  } catch (e) {
    try {
      const sanitized = rawText
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, (c) => (c === '\n' || c === '\r' || c === '\t' ? c : ''))
        .trim();
      return JSON.parse(sanitized) as T;
    } catch (e2) {
      const jsonMatch = rawText.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as T;
        } catch {
          return fallback;
        }
      }
      return fallback;
    }
  }
}
