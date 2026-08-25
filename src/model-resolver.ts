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
let activeWorkingModel: string | null = null;

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
  const pool = await getDynamicModelPool(ai);
  // Fast-path: 직전에 성공했던 모델을 최우선으로 배치
  const modelsToTry = activeWorkingModel
    ? [activeWorkingModel, ...pool.filter((m) => m !== activeWorkingModel)]
    : pool;

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: params.config,
      });
      activeWorkingModel = modelName;
      return response;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode;
      const errMsg = err?.message || String(err);

      // 400, 401, 403, API_KEY_INVALID, SAFETY 등 재시도 불가 치명적 오류는 즉시 throw
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        errMsg.includes('API_KEY_INVALID') ||
        errMsg.includes('SAFETY')
      ) {
        throw new Error(`[Gemini Fatal] 재시도 불가 오류 발생 (${status || 'AUTH/SAFETY'}): ${errMsg}`);
      }

      console.warn(`⚠️ [Gemini Fallback] 모델 "${modelName}" 호출 실패 (${status || err?.name || ''}: ${errMsg.slice(0, 100)}) -> 다음 가용 모델로 자동 전환...`);
      await new Promise((r) => setTimeout(r, 800));
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

export function cleanText(text: string): string {
  return (text || '')
    .replace(/^["']|["']$/g, '')
    .replace(/\*\*/g, '')
    .trim();
}

export function cleanHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/^```html\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\\r/g, '')
    .trim();
}

/**
 * JSON 파싱 실패 시에도 순수 HTML 본문과 제목을 100% 정제 추출하는 복구 파서
 */
export function extractCleanTrendPostFromRawText(
  rawText: string,
  defaultTitle: string,
  category: any,
  categoryNameKo: string,
  tags: string[],
  verifiedLinks: any[] = [],
  coupangUrl?: string
): any {
  // 1. 정상 JSON 파싱 시도
  const parsed = safeJsonParse<any>(rawText, null);
  if (parsed && parsed.title && parsed.htmlContent) {
    return {
      title: cleanText(parsed.title),
      summary: cleanText(parsed.summary || '최신 트렌드 심층 분석'),
      htmlContent: cleanHtml(parsed.htmlContent),
      category,
      categoryNameKo,
      tags: Array.isArray(parsed.tags) && parsed.tags.length > 0 ? parsed.tags : tags,
      metaDescription: cleanText(parsed.metaDescription || parsed.summary || defaultTitle),
      verifiedLinks,
      coupangUrl: parsed.coupangUrl || coupangUrl,
    };
  }

  // 2. 정규식을 통한 비정형 JSON 복구 (Unescaped string 파싱)
  let title = defaultTitle;
  const titleMatch = rawText.match(/"title"\s*:\s*"([^"]+)"/);
  if (titleMatch) title = titleMatch[1];

  let summary = '실시간 트렌드 및 최신 정보 심층 분석';
  const summaryMatch = rawText.match(/"summary"\s*:\s*"([^"]+)"/);
  if (summaryMatch) summary = summaryMatch[1];

  let htmlContent = '';
  const htmlMatch = rawText.match(/"htmlContent"\s*:\s*"([\s\S]*)/);
  if (htmlMatch) {
    let rawHtml = htmlMatch[1];
    rawHtml = rawHtml
      .replace(/"\s*,\s*"\w+"[\s\S]*$/, '')
      .replace(/"\s*}\s*```?$/, '')
      .replace(/"\s*$/, '');
    htmlContent = cleanHtml(rawHtml);
  } else {
    // 3. 본문 내 순수 HTML 태그 영역만 탐색
    const tagMatch = rawText.match(/(<(div|p|h2|h1|section)[\s\S]*<\/(div|p|h2|h1|section)>)/);
    if (tagMatch) {
      htmlContent = cleanHtml(tagMatch[1]);
    } else {
      // JSON 키워드 찌꺼기 완전 제거
      const sanitized = rawText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .replace(/\{\s*"title"[\s\S]*?"htmlContent"\s*:\s*"?/gi, '')
        .replace(/"\s*,\s*"(tags|summary|metaDescription)"[\s\S]*$/, '')
        .trim();
      htmlContent = `<p>${sanitized.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>')}</p>`;
    }
  }

  return {
    title: cleanText(title),
    summary: cleanText(summary),
    htmlContent,
    category,
    categoryNameKo,
    tags,
    metaDescription: cleanText(summary),
    verifiedLinks,
    coupangUrl,
  };
}

export const extractCleanPostFromRawText = extractCleanTrendPostFromRawText;
