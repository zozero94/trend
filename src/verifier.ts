import { GoogleGenAI } from '@google/genai';
import { VerifiedLink, TrendCategory } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

/**
 * 1. 공식 판매처 / 예약 링크 / 오피셜 직통 사이트 지능형 발굴기
 */
export async function findOfficialOrBestLandingUrl(
  apiKey: string,
  topicKeyword: string,
  category: TrendCategory
): Promise<{
  officialSiteName: string;
  officialLandingUrl: string;
  isDirectLink: boolean;
}> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `당신은 대한민국 최고의 웹 링크 & 공식 판매처 아카이브 전문가입니다.
주제: "${topicKeyword}" (카테고리: ${category})

[지침]
독자가 헛걸음하지 않고 곧바로 접속할 수 있는 **가장 신뢰할 수 있는 공식 다이렉트 웹사이트**를 발굴하세요.
- 국립박물관 뮷즈/키링: 국립박물관 문화재단 뮷즈 공식몰 (https://www.museumshop.or.kr)
- 팝업스토어/핫플: 카카오맵/네이버 지도 예약 페이지 또는 공식 인스타그램/캐치테이블
- 브랜드 굿즈/신상: 해당 브랜드 공식 직영몰 또는 공식 프로모션 페이지
- 공연/스포츠/이벤트: 인터파크 티켓 또는 공식 예매처

반드시 다음 JSON 형식으로만 응답하세요:
{
  "officialSiteName": "공식몰/공식처 명칭 (예: 국립박물관 뮷즈 공식몰)",
  "officialLandingUrl": "https://...",
  "isDirectLink": true
}`;

  try {
    const res = await generateContentWithFallback(ai, {
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    });
    const parsed = safeJsonParse<{ officialSiteName: string; officialLandingUrl: string; isDirectLink: boolean }>(
      res.text || '{}',
      {
        officialSiteName: '공식 정보 검색',
        officialLandingUrl: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topicKeyword)}`,
        isDirectLink: false,
      }
    );
    return {
      officialSiteName: parsed.officialSiteName || '공식 정보 검색',
      officialLandingUrl: parsed.officialLandingUrl && parsed.officialLandingUrl.startsWith('http')
        ? parsed.officialLandingUrl
        : `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topicKeyword)}`,
      isDirectLink: parsed.isDirectLink ?? false,
    };
  } catch {
    return {
      officialSiteName: '공식 정보 검색',
      officialLandingUrl: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topicKeyword)}`,
      isDirectLink: false,
    };
  }
}

/**
 * 2. 4대 핵심 검색/구매/지도 랜딩 URL 생성기
 */
export function buildVerifiedTrendUrls(
  exactTopicKeyword: string,
  exactProductKeyword: string,
  officialLandingUrl?: string
) {
  const cleanKeyword = exactTopicKeyword.trim();
  const cleanProduct = exactProductKeyword.trim();

  return {
    officialLandingUrl: officialLandingUrl || `https://m.search.naver.com/search.naver?query=${encodeURIComponent(cleanKeyword)}`,
    naverSearchUrl: `https://m.search.naver.com/search.naver?query=${encodeURIComponent(cleanKeyword)}`,
    youtubeSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanKeyword)}`,
    naverMapUrl: `https://map.naver.com/v5/search/${encodeURIComponent(cleanKeyword)}`,
    coupangSearchUrl: `https://www.coupang.com/np/search?q=${encodeURIComponent(cleanProduct)}`,
  };
}

/**
 * 2.5 표준 검색 키워드 및 랜딩 정보 산출
 */
export async function sanitizeSearchKeywords(
  apiKey: string,
  topic: { keyword: string; headlineHook: string; category: TrendCategory }
) {
  const officialInfo = await findOfficialOrBestLandingUrl(apiKey, topic.keyword, topic.category);
  const urls = buildVerifiedTrendUrls(topic.keyword, topic.keyword, officialInfo.officialLandingUrl);

  return {
    exactTopicKeyword: topic.keyword,
    exactProductKeyword: topic.keyword,
    officialSiteName: officialInfo.officialSiteName,
    officialLandingUrl: officialInfo.officialLandingUrl,
    naverSearchUrl: urls.naverSearchUrl,
    youtubeSearchUrl: urls.youtubeSearchUrl,
    naverMapUrl: urls.naverMapUrl,
    coupangSearchUrl: urls.coupangSearchUrl,
  };
}

/**
 * 3. Playwright 고화질 캡처 + DOM 텍스트 추출 + Gemini Vision 멀티모달 정밀 팩트체크 엔진
 */
export async function verifyUrlAndCaptureScreenshot(
  apiKey: string,
  targetUrl: string,
  expectedTopicKeyword: string,
  platformType: 'youtube' | 'naver' | 'coupang' | 'general' = 'general'
): Promise<VerifiedLink> {
  console.log(`🔍 [멀티모달 랜딩 검증] ${platformType.toUpperCase()} 정밀 팩트체크: ${targetUrl}`);

  let status = 200;
  let pageTitle = '';
  let domText = '';
  let screenshotBase64 = '';
  let isHealthy = false;
  let isContentMatched = false;
  let relevanceScore = 0;
  let suggestedCorrection = '';
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

    domText = await page.evaluate(() => {
      return document.body ? document.body.innerText.replace(/\s+/g, ' ').slice(0, 1500) : '';
    });

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 85 });
    screenshotBase64 = screenshotBuffer.toString('base64');
    isHealthy = status >= 200 && status < 400;

    // 가짜/파킹 도메인/빈 페이지 1차 감지
    const isParkingOrDead =
      domText.length < 30 ||
      /lander|parking|buy this domain|domain is for sale|redirecting|parked domain/i.test(domText) ||
      /lander|parking/i.test(pageTitle);

    if (isParkingOrDead) {
      isHealthy = false;
      isContentMatched = false;
      relevanceScore = 0;
      verificationNotes = '파킹 도메인 또는 빈 리다이렉트 페이지 감지';
    }
  } catch (browserError) {
    console.warn(`⚠️ [Verifier] Playwright 브라우저 캡처 실패, HTTP Fetch로 대체 검증:`, browserError);

    try {
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      });
      status = fetchRes.status;
      isHealthy = fetchRes.ok;
      const htmlText = await fetchRes.text();
      const match = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = match ? match[1].trim() : '';
      domText = htmlText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 1500);

      if (
        domText.length < 30 ||
        /lander|parking|buy this domain|domain is for sale|redirecting/i.test(domText) ||
        /lander|parking/i.test(pageTitle)
      ) {
        isHealthy = false;
        isContentMatched = false;
        relevanceScore = 0;
        verificationNotes = '파킹 도메인 또는 빈 리다이렉트 감지';
      }
    } catch {
      status = 500;
      isHealthy = false;
      verificationNotes = 'URL 접근 실패 (네트워크 오류)';
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
  }

  if (isHealthy) {
    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `당신은 대한민국 최고의 웹 링크 & 시각 감리관(Visual Link Auditor)입니다.
우리가 작성하려는 핵심 주제: "${expectedTopicKeyword}"
검증 대상 URL: "${targetUrl}" (플랫폼: ${platformType})
웹페이지 제목: "${pageTitle}"
웹페이지 텍스트 요약: "${domText.slice(0, 800)}"

[정밀 시각 & 텍스트 검증 지침]
첨부된 실제 웹페이지 스크린샷과 추출된 텍스트를 정밀 분석하여 다음을 판정하세요:
1. **정상 랜딩 여부 (isHealthy)**: 404 에러, 403 차단, Akamai 차단(Incident Code 등), 빈 검색 결과, 도메인 파킹(Lander) 화면이면 반드시 false!
2. **주제 일치성 (isContentMatched)**: 화면에 타겟 주제("${expectedTopicKeyword}")와 관련된 실제 콘텐츠나 상품이 확실히 노출되는지 판정. 빈 화면이나 무관한 페이지면 반드시 false!
3. **일치성 점수 (relevanceScore)**: 0~100점 (80점 이상이면 통과, 70점 미만은 불일치/탈락).
4. **보정 제안 (suggestedCorrection)**: 불일치 시 올바른 키워드나 대안 URL 제안.

반드시 다음 JSON 포맷으로만 응답하세요:
{
  "isHealthy": true,
  "isContentMatched": true,
  "relevanceScore": 95,
  "suggestedCorrection": "",
  "verificationNotes": "검증 상세 사유 요약"
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

      const parsed = safeJsonParse<{
        isHealthy: boolean;
        isContentMatched: boolean;
        relevanceScore: number;
        suggestedCorrection: string;
        verificationNotes: string;
      }>(visionRes.text || '{}', {
        isHealthy: false,
        isContentMatched: false,
        relevanceScore: 0,
        suggestedCorrection: '',
        verificationNotes: '비전 응답 파싱 실패',
      });

      isHealthy = parsed.isHealthy ?? false;
      isContentMatched = parsed.isContentMatched ?? false;
      relevanceScore = parsed.relevanceScore ?? 0;
      suggestedCorrection = parsed.suggestedCorrection || '';
      verificationNotes = parsed.verificationNotes || '검증 완료';
    } catch (e) {
      isHealthy = false;
      isContentMatched = false;
      relevanceScore = 0;
      verificationNotes = `비전 검증 예외 발생`;
    }
  } else {
    isContentMatched = false;
    relevanceScore = 0;
    verificationNotes = verificationNotes || `비정상 HTTP 응답 코드: ${status}`;
  }

  let linkType: 'DIRECT_OFFICIAL' | 'VERIFIED_SEARCH' | 'MAP_PLACE' | 'PURCHASE_CTA' = 'VERIFIED_SEARCH';
  if (platformType === 'general') {
    linkType = isHealthy && isContentMatched && relevanceScore >= 75 ? 'DIRECT_OFFICIAL' : 'VERIFIED_SEARCH';
  } else if (platformType === 'coupang') {
    linkType = 'PURCHASE_CTA';
  }

  const resultStatusIcon = isHealthy && isContentMatched && relevanceScore >= 70 ? '✅ 통과' : '⚠️ 주의/불일치';
  console.log(`   └ [${platformType.toUpperCase()} 검증] ${resultStatusIcon} (${relevanceScore}점 | ${linkType}) - ${verificationNotes}`);

  return {
    originalUrl: targetUrl,
    finalUrl: targetUrl,
    status,
    isHealthy,
    pageTitle,
    screenshotBase64: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64.slice(0, 100)}...` : undefined,
    isContentMatched,
    relevanceScore,
    suggestedCorrection,
    verificationNotes,
    linkType,
  };
}

/**
 * 4. 본문 작성 후 최종 HTML 내 불필요한 더미 박스 100% 제거 및 Akamai WAF 방어선(ReferrerPolicy) 완비
 */
export function auditAndFixHtmlLinks(
  htmlContent: string,
  validUrls: { youtube: string; naver: string; naverMap: string; coupang: string; officialLandingUrl?: string },
  exactKeyword: string,
  category: string = 'HOT_PLACE'
): string {
  let fixedHtml = htmlContent;

  // 1. 단톡방 공유용 카톡 템플릿 더미 노란 박스 100% 완전 삭제
  fixedHtml = fixedHtml.replace(/<div[^>]*>[\s\S]*?단톡방 공유용 카톡 템플릿[\s\S]*?<\/div>/gi, '');
  fixedHtml = fixedHtml.replace(/<div[^>]*>[\s\S]*?친구에게 공유하고 약속 잡기[\s\S]*?<\/div>/gi, '');

  // 2. 텍스트 이미지 플레이스홀더 / 빈 회색 박스 / 대괄호 사진 안내문 100% 완전 삭제 (정상 가이드 소제목 보존)
  fixedHtml = fixedHtml.replace(/<!--[\s\S]*?-->/gi, '');
  fixedHtml = fixedHtml.replace(/\[\s*(사진|이미지|포토존|비주얼)\s*(영역|가이드|설명|안내)?\s*\]/gi, '');
  fixedHtml = fixedHtml.replace(/<div[^>]*>[\s\S]*?(📸|\[이미지:|Alt:|이미지 가이드|포토존|사진 영역)[\s\S]*?<\/div>/gi, '');
  fixedHtml = fixedHtml.replace(/📸\s*\[[^\]]*\]/gi, '');
  fixedHtml = fixedHtml.replace(/<p[^>]*>[\s\S]*?(📸|사진 영역|이미지 영역)[\s\S]*?<\/p>/gi, '');

  // 3. 잘못된 네이버 지도 링크 ➔ 정확한 장소 검색 네이버 지도 URL로 교정
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/map\.naver\.com\/?['"]/g, `href="${validUrls.naverMap}"`);
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/m\.map\.naver\.com\/?['"]/g, `href="${validUrls.naverMap}"`);

  // 4. 공식 직통 URL 치환 (존재 시)
  if (validUrls.officialLandingUrl) {
    fixedHtml = fixedHtml.replace(/href=['"]https?:\/\/(?:www\.)?(?:museumshop|official|smartstore|brand)[^'"]*['"]/gi, `href="${validUrls.officialLandingUrl}"`);
  }

  // 5. 쿠팡 링크 WAF 차단(Incident Code D21752C_...) 방어: 모든 변형(단축링크 포함) 교정
  fixedHtml = fixedHtml.replace(
    /href=['"]https:\/\/(?:(?:www|m)\.coupang\.com|link\.coupang\.com|coupa\.ng)\/[^'"]*['"]/gi,
    `href="${validUrls.coupang}"`
  );

  // 6. 잘못된 유튜브 검색 링크 교정
  fixedHtml = fixedHtml.replace(/href=['"]https:\/\/www\.youtube\.com\/results\?search_query=[^'"]*['"]/g, `href="${validUrls.youtube}"`);

  // 7. XSS 인라인 이벤트 핸들러 및 javascript: 차단
  fixedHtml = fixedHtml.replace(/\s*on\w+=["'][^"']*["']/gi, '');
  fixedHtml = fixedHtml.replace(/href=["']javascript:[^"']*["']/gi, 'href="#"');

  // 8. 모든 외부 링크에 target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" 부여
  fixedHtml = fixedHtml.replace(/<a\s+([^>]*?)>/gi, (match, attrs) => {
    let cleanAttrs = attrs;
    cleanAttrs = cleanAttrs.replace(/\s*(target|rel|referrerpolicy)=['"][^'"]*['"]/gi, '');
    return `<a ${cleanAttrs} target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer">`;
  });

  return fixedHtml.trim();
}
