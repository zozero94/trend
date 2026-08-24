import { GoogleGenAI } from '@google/genai';

/**
 * 2026 최신 Gemini 공식 가용 모델 우선순위 풀
 */
export const CANDIDATE_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-pro',
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
      const isRetryable =
        err?.status === 503 ||
        err?.message?.includes('503') ||
        err?.status === 500 ||
        err?.message?.includes('500') ||
        err?.status === 502 ||
        err?.message?.includes('502') ||
        err?.message?.includes('high demand') ||
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.status === 404 ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('fetch failed') ||
        err?.message?.includes('ECONNRESET') ||
        err?.message?.includes('ETIMEDOUT');

      if (isRetryable) {
        console.warn(`[Gemini] 모델 ${modelName} 호출 실패 (${err?.message?.slice(0, 80)}) -> 다음 가용 모델로 자동 전환 중...`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      throw err;
    }
  }

  throw new Error(`[Gemini] 모든 가용 모델 호출 실패. 마지막 오류: ${lastError?.message || lastError}`);
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
