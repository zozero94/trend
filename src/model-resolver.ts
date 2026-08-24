import { GoogleGenAI } from '@google/genai';

/**
 * 2026 최신 Gemini 공식 가용 모델 우선순위 풀
 */
export const CANDIDATE_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-pro-latest',
];

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

  for (const modelName of CANDIDATE_MODELS) {
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
      console.warn(`⚠️ [Gemini Fallback] 모델 "${modelName}" 호출 실패 (${err?.status || err?.name || ''}: ${errMsg.slice(0, 100)}) -> 다음 가용 모델로 즉시 전환 중...`);
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
  }

  throw new Error(`[Gemini] 8종 전체 가용 모델 호출 실패. 마지막 오류: ${lastError?.message || lastError}`);
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
