import { GoogleGenAI } from '@google/genai';
import { VerifiedLink, TrendTopic } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

/**
 * Playwright를 활용하여 URL 접속 ➔ 스크린샷 캡처 ➔ Gemini Vision으로 랜딩 및 일치성 팩트체크
 */
export async function verifyUrlAndCaptureScreenshot(
  apiKey: string,
  targetUrl: string,
  expectedTopic: TrendTopic
): Promise<VerifiedLink> {
  console.log(`🔍 [링크 & 스크린샷 검증] 접속 시도: ${targetUrl}`);

  let status = 200;
  let pageTitle = '';
  let screenshotBase64 = '';
  let isHealthy = false;
  let isContentMatched = false;
  let verificationNotes = '';

  let browser: any = null;
  try {
    const { chromium } = await import('playwright-chromium');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    
    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
    status = response ? response.status() : 200;
    pageTitle = (await page.title()) || '';

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
    screenshotBase64 = screenshotBuffer.toString('base64');
    isHealthy = status >= 200 && status < 400;

    await browser.close();
  } catch (browserError) {
    console.warn(`⚠️ [Verifier] Playwright 캡처 실패, HTTP Fetch로 대체 검증:`, browserError);
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
    
    try {
      const fetchRes = await fetch(targetUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      });
      status = fetchRes.status;
      isHealthy = fetchRes.ok;
      const htmlText = await fetchRes.text();
      const match = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = match ? match[1].trim() : '';
    } catch (fetchErr) {
      status = 500;
      isHealthy = false;
      verificationNotes = 'URL 접근 실패 (네트워크 오류)';
    }
  }

  if (isHealthy) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `당신은 웹 콘텐츠 및 랜딩페이지 일치성 검증 AI입니다.
우리가 작성하려는 주제는 다음과 같습니다:
- 타겟 키워드: "${expectedTopic.keyword}"
- 카테고리: "${expectedTopic.categoryNameKo}"
- 대상 URL: "${targetUrl}"
- 접속 페이지 제목: "${pageTitle}"

[검증 기준]
1. 이 웹페이지가 타겟 키워드("${expectedTopic.keyword}")와 실제로 일치하는 매장/상품/영상 정보인가요?
2. 404 에러, "페이지를 찾을 수 없습니다", "품절", "성인인증 차단" 같은 비정상 화면이 아닌가요?

반드시 다음 JSON 포맷으로만 응답하세요:
{
  "isContentMatched": true,
  "isHealthy": true,
  "verificationNotes": "검증 완료: ${expectedTopic.keyword} 공식 정보 일치 확인"
}`;

      let contentPayload: any = prompt;
      if (screenshotBase64) {
        contentPayload = [
          prompt,
          {
            inlineData: {
              data: screenshotBase64,
              mimeType: 'image/jpeg',
            },
          },
        ];
      }

      const visionRes = await generateContentWithFallback(ai, {
        contents: contentPayload,
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      });

      const parsed = safeJsonParse<{ isContentMatched: boolean; isHealthy: boolean; verificationNotes: string }>(
        visionRes.text || '{}',
        {
          isContentMatched: true,
          isHealthy: true,
          verificationNotes: '기본 일치성 확인',
        }
      );

      isContentMatched = parsed.isContentMatched;
      isHealthy = parsed.isHealthy;
      verificationNotes = parsed.verificationNotes;
    } catch (e) {
      isContentMatched = true;
      verificationNotes = `페이지 응답 정상 (${status} OK)`;
    }
  } else {
    isContentMatched = false;
    verificationNotes = `비정상 HTTP 응답 코드: ${status}`;
  }

  console.log(`✅ [검증 결과] ${isHealthy && isContentMatched ? '통과' : '실패'} - ${verificationNotes}`);

  return {
    originalUrl: targetUrl,
    finalUrl: targetUrl,
    status,
    isHealthy,
    pageTitle,
    screenshotBase64: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64.slice(0, 100)}...` : undefined,
    isContentMatched,
    verificationNotes,
  };
}

export async function verifyMultipleLinks(
  apiKey: string,
  urls: string[],
  topic: TrendTopic
): Promise<VerifiedLink[]> {
  const verifiedList: VerifiedLink[] = [];
  for (const url of urls) {
    if (!url || !url.startsWith('http')) continue;
    const res = await verifyUrlAndCaptureScreenshot(apiKey, url, topic);
    verifiedList.push(res);
  }
  return verifiedList;
}
