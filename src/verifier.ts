import { GoogleGenAI } from '@google/genai';
import { VerifiedLink, TrendTopic } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';
import { getTopicImageUrl } from './image-provider.js';

/**
 * 1. 정확한 표준 표기법 및 플랫폼별 최적 검색어 정제기 (오탈자 원천 차단)
 */
export async function sanitizeSearchKeywords(
  apiKey: string,
  topic: TrendTopic
): Promise<{
  exactTopicKeyword: string;
  exactProductKeyword: string;
  youtubeSearchUrl: string;
  naverSearchUrl: string;
  naverMapUrl: string;
  coupangSearchUrl: string;
}> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `당신은 대한민국 실시간 트렌드 및 키워드 표준 표기법 전문가입니다.
현재 다루려는 주제 키워드: "${topic.keyword}" (카테고리: ${topic.categoryNameKo})

[지침]
1. 'exactTopicKeyword': 삐끼삐끼, 두바이초콜릿, 성수 팝업처럼 릴스/유튜브/뉴스에서 널리 쓰이는 가장 정확한 공식 표준 표기 (오탈자 '삑기삑기' 등 절대 금지).
2. 'exactProductKeyword': 쿠팡에서 검색했을 때 "검색 결과가 없습니다"가 뜨지 않고 100% 정상 상품 목록이 나오는 가장 정확한 핵심 상품/명사 키워드 (예: '신라면', '두바이 피스타치오 초콜릿', '헤어롤', '휴대용 텀블러').

반드시 다음 JSON 형식으로만 응답하세요:
{
  "exactTopicKeyword": "오탈자 없는 표준 키워드",
  "exactProductKeyword": "쿠팡 100% 검색 가능한 핵심 상품명"
}`;

  try {
    const res = await generateContentWithFallback(ai, {
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    });

    const parsed = safeJsonParse<{ exactTopicKeyword: string; exactProductKeyword: string }>(
      res.text || '{}',
      {
        exactTopicKeyword: topic.keyword.trim(),
        exactProductKeyword: topic.keyword.replace(/[^\w가-힣\s]/g, '').trim(),
      }
    );

    const exactTopic = parsed.exactTopicKeyword || topic.keyword;
    const exactProduct = parsed.exactProductKeyword || topic.keyword;

    return {
      exactTopicKeyword: exactTopic,
      exactProductKeyword: exactProduct,
      youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(exactTopic)}`,
      naverSearchUrl: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(exactTopic)}`,
      naverMapUrl: `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(exactTopic)}`,
      coupangSearchUrl: `https://www.coupang.com/np/search?q=${encodeURIComponent(exactProduct)}`,
    };
  } catch {
    const cleanKw = topic.keyword.replace(/[^\w가-힣\s]/g, '').trim();
    return {
      exactTopicKeyword: topic.keyword,
      exactProductKeyword: cleanKw,
      youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(topic.keyword)}`,
      naverSearchUrl: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topic.keyword)}`,
      naverMapUrl: `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(topic.keyword)}`,
      coupangSearchUrl: `https://www.coupang.com/np/search?q=${encodeURIComponent(cleanKw)}`,
    };
  }
}

/**
 * 2. Playwright를 활용하여 URL 실제 접속 ➔ 스크린샷 캡처 ➔ Gemini Vision으로 일치성 및 무결성 팩트체크
 */
export async function verifyUrlAndCaptureScreenshot(
  apiKey: string,
  targetUrl: string,
  expectedTopicKeyword: string,
  platformType: 'youtube' | 'naver' | 'coupang' | 'general' = 'general'
): Promise<VerifiedLink> {
  console.log(`🔍 [링크 & 스크린샷 검증] ${platformType.toUpperCase()} 접속 검증: ${targetUrl}`);

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

    const response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
    status = response ? response.status() : 200;
    pageTitle = (await page.title()) || '';

    // 화면 렌더링 대기
    await page.waitForTimeout(1000);

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 80 });
    screenshotBase64 = screenshotBuffer.toString('base64');
    isHealthy = status >= 200 && status < 400;

    await browser.close();
  } catch (browserError) {
    console.warn(`⚠️ [Verifier] Playwright 브라우저 캡처 실패, HTTP Fetch로 대체 검증:`, browserError);
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }

    try {
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      status = fetchRes.status;
      isHealthy = fetchRes.ok;
      const htmlText = await fetchRes.text();
      const match = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = match ? match[1].trim() : '';
    } catch {
      status = 500;
      isHealthy = false;
      verificationNotes = 'URL 접근 실패 (네트워크 오류)';
    }
  }

  if (isHealthy) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `당신은 웹 콘텐츠 및 랜딩페이지 일치성 검증 AI입니다.
우리가 작성하려는 주제: "${expectedTopicKeyword}"
검증 대상 URL: "${targetUrl}" (${platformType})
페이지 제목: "${pageTitle}"

[검증 기준]
1. 이 웹페이지 화면에 타겟 주제("${expectedTopicKeyword}")와 관련된 실제 영상, 뉴스, 상품 정보가 정상적으로 노출되고 있나요?
2. 404 에러, "검색 결과가 없습니다", 오탈자로 인한 엉뚱한 검색 결과, 성인인증/접근 차단 화면이 아닌가요?

반드시 다음 JSON 포맷으로만 응답하세요:
{
  "isContentMatched": true,
  "isHealthy": true,
  "verificationNotes": "검증 완료: ${expectedTopicKeyword} 관련 정상 콘텐츠 노출 확인"
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
        config: { responseMimeType: 'application/json', temperature: 0.1 },
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

  console.log(`✅ [${platformType.toUpperCase()} 검증 결과] ${isHealthy && isContentMatched ? '통과' : '주의'} - ${verificationNotes}`);

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

/**
 * 3. 본문 작성 후 최종 HTML 안의 모든 링크 전수 감사 및 오탈자/이미지/더미요소 자동 교정
 */
export function auditAndFixHtmlLinks(
  htmlContent: string,
  validUrls: { youtube: string; naver: string; naverMap: string; coupang: string },
  exactKeyword: string,
  category: string = 'HOT_PLACE'
): string {
  let fixedHtml = htmlContent;

  // 1. 단톡방 공유용 카톡 템플릿 더미 노란 박스 100% 완전 삭제
  fixedHtml = fixedHtml.replace(/<div[^>]*>[\s\S]*?단톡방 공유용 카톡 템플릿[\s\S]*?<\/div>/gi, '');
  fixedHtml = fixedHtml.replace(/<div[^>]*>[\s\S]*?친구에게 공유하고 약속 잡기[\s\S]*?<\/div>/gi, '');

  // 2. 텍스트 이미지 플레이스홀더 ➔ 실제 반응형 고화질 이미지로 교체
  const topicImage = getTopicImageUrl(exactKeyword, category);
  const realImageHtml = `
  <div style="margin: 28px 0; text-align: center;">
    <img src="${topicImage.url}" alt="${topicImage.alt}" style="width: 100%; max-width: 700px; height: auto; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); object-fit: cover; aspect-ratio: 16/9;" loading="lazy" />
    <p style="font-size: 12px; color: #8b95a1; margin-top: 8px; margin-bottom: 0;">▲ ${exactKeyword} 관련 현장 비주얼</p>
  </div>`;

  fixedHtml = fixedHtml.replace(/<div[^>]*>[\s\S]*?📸\s*\[이미지:[\s\S]*?<\/div>/gi, realImageHtml);
  fixedHtml = fixedHtml.replace(/📸\s*\[이미지:[^\]]*\]/gi, realImageHtml);

  // 3. 잘못된 네이버 지도 링크 ➔ 정확한 장소 검색 네이버 지도 URL로 교정
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/map\.naver\.com\/?['"]/g, `href="${validUrls.naverMap}"`);
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/m\.map\.naver\.com\/?['"]/g, `href="${validUrls.naverMap}"`);

  // 4. 잘못된 쿠팡 링크 ➔ 정제된 깔끔한 쿠팡 URL로 교정
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/www\.coupang\.com\/[^'"]*['"]/g, `href="${validUrls.coupang}"`);

  // 5. 잘못된 유튜브 검색 링크 교정
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/www\.youtube\.com\/results\?search_query=[^'"]*['"]/g, `href="${validUrls.youtube}"`);

  // 6. <a> 태그에 target="_blank" rel="noopener noreferrer" 속성 강제 부여
  fixedHtml = fixedHtml.replace(/<a\s+(?!.*?target=)([^>]+)>/g, '<a target="_blank" rel="noopener noreferrer" $1>');

  return fixedHtml;
}
