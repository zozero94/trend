import { GoogleGenAI } from '@google/genai';

export const GEMINI_MODEL_CANDIDATES = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
];

export async function generateContentWithFallback(
  ai: GoogleGenAI,
  requestParams: any
): Promise<any> {
  let lastError: any = null;

  for (const model of GEMINI_MODEL_CANDIDATES) {
    try {
      const response = await ai.models.generateContent({
        model,
        ...requestParams,
      });
      return response;
    } catch (err: any) {
      lastError = err;
      console.warn(`⚠️ [Gemini Failover] 모델 ${model} 호출 실패, 다음 모델로 대체:`, err?.message || err);
    }
  }

  throw new Error(`모든 Gemini 모델 후보 호출 실패. 마지막 에러: ${lastError?.message || lastError}`);
}

export function safeJsonParse<T>(jsonStr: string, fallback: T): T {
  try {
    const cleaned = jsonStr
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    return JSON.parse(cleaned) as T;
  } catch {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
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
