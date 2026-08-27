import { TrendRawItem, TrendTopic, TrendCategory } from './types.js';
import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/**
 * 1. 구글 트렌드 대한민국 실시간 급상승 RSS 수집
 */
export async function fetchGoogleTrendsKR(): Promise<TrendRawItem[]> {
  const url = 'https://trends.google.com/trending/rss?geo=KR';
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: TrendRawItem[] = [];

    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of itemMatches) {
      const itemXml = match[1];
      const titleMatch = itemXml.match(/<title>([^<]+)<\/title>/);
      const snippetMatch = itemXml.match(/<description>([\s\S]*?)<\/description>/);
      const newsItemMatch = itemXml.match(/<ht:news_item_title>([^<]+)<\/ht:news_item_title>/);

      if (titleMatch) {
        const keyword = titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim();
        const snippet = newsItemMatch
          ? newsItemMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim()
          : snippetMatch
          ? snippetMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim()
          : '';

        items.push({
          source: 'google_trends',
          keyword,
          title: snippet || keyword,
          snippet,
        });
      }
    }
    return items.slice(0, 15);
  } catch (e) {
    console.warn('⚠️ Google Trends RSS 수집 실패:', e);
    return [];
  }
}

/**
 * 2. 유튜브 대한민국 인기 급상승 영상/쇼츠 RSS 수집
 */
export async function fetchYouTubeTrends(): Promise<TrendRawItem[]> {
  const channelFeed = 'https://www.youtube.com/feeds/videos.xml?channel_id=UCF_XFhS0Z4CshAieG6hF3Yg';
  try {
    const res = await fetch(channelFeed, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const items: TrendRawItem[] = [];

    const entryMatches = xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g);
    for (const match of entryMatches) {
      const entryXml = match[1];
      const titleMatch = entryXml.match(/<title>([^<]+)<\/title>/);
      const urlMatch = entryXml.match(/<link rel="alternate" href="([^"]+)"\/>/);

      if (titleMatch) {
        const title = titleMatch[1].trim();
        items.push({
          source: 'youtube',
          keyword: title.slice(0, 20),
          title,
          url: urlMatch ? urlMatch[1] : undefined,
        });
      }
    }
    return items.slice(0, 15);
  } catch (e) {
    console.warn('⚠️ YouTube Feed 수집 실패:', e);
    return [];
  }
}

/**
 * 3. 틱톡/릴스 챌린지 및 Z세대 숏폼 트렌드 수집
 */
export async function fetchTikTokAndReelsTrends(): Promise<TrendRawItem[]> {
  const fallbackKeywords = [
    { kw: '스퀴시 말랑이 챌린지', title: 'SNS 말랑이 수술 및 스퀴시 촉감놀이 챌린지' },
    { kw: '삐끼삐끼 댄스', title: '야구 직관 떼창 삐끼삐끼 응원 챌린지' },
    { kw: '성수 팝업스토어', title: '성수동 주말 웨이팅 오픈런 팝업스토어 총정리' },
    { kw: '다이소 품절대란 꿀템', title: 'SNS 화제의 다이소 뷰티 리들샷 및 정리 꿀템' },
    { kw: '두바이 픽스 초콜릿', title: '피스타치오 카다이프 두바이 초콜릿 편의점 신상' },
    { kw: '국립박물관 뮷즈 키링', title: 'MZ세대 오픈런 국새 키링 뮷즈 굿즈 대란' },
  ];

  try {
    const res = await fetch(
      'https://m.search.naver.com/search.naver?query=%EC%9D%B8%EC%8A%A4%ED%83%80+%EB%A6%B4%EC%8A%A4+%EC%B1%8C%EB%A6%B0%EC%A7%80+%EC%9C%A0%ED%96%89',
      {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) {
      return fallbackKeywords.map((f) => ({
        source: 'tiktok_reels',
        keyword: f.kw,
        title: f.title,
      }));
    }
    const html = await res.text();
    const titleRegex = /class="news_tit"[^>]*title="([^"]+)"/g;
    const extracted: TrendRawItem[] = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null && extracted.length < 8) {
      extracted.push({
        source: 'tiktok_reels',
        keyword: m[1].slice(0, 15),
        title: m[1],
      });
    }

    return extracted.length > 0
      ? extracted
      : fallbackKeywords.map((f) => ({
          source: 'tiktok_reels',
          keyword: f.kw,
          title: f.title,
        }));
  } catch {
    return fallbackKeywords.map((f) => ({
      source: 'tiktok_reels',
      keyword: f.kw,
      title: f.title,
    }));
  }
}

/**
 * 4. 네이버 쇼핑/오픈마켓 및 커뮤니티 바이럴 키워드 수집
 */
export async function fetchNaverAndCommunityTrends(): Promise<TrendRawItem[]> {
  try {
    const res = await fetch(
      'https://m.search.naver.com/search.naver?query=%EC%8B%A4%EC%8B%9C%EA%B0%84+%ED%99%94%EC%A0%9C%EC%9D%98+%ED%8A%B8%EB%A0%8C%EB%93%9C',
      {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const titleRegex = /class="news_tit"[^>]*title="([^"]+)"/g;
    const items: TrendRawItem[] = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null && items.length < 10) {
      items.push({
        source: 'naver_datalab',
        keyword: m[1].slice(0, 15),
        title: m[1],
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}

/**
 * 주제 및 키워드가 최근 발행된 글들과 유사/중복인지 정밀 검증
 */
export function isTopicDuplicate(targetKeyword: string, pastTitles: string[]): boolean {
  if (!targetKeyword || !pastTitles || pastTitles.length === 0) return false;

  const cleanTarget = targetKeyword.replace(/[^\w가-힣]/g, '').toLowerCase();
  if (!cleanTarget) return false;

  // 1) 2글자 이상 핵심 명사 토큰 및 복합어 서브토큰 분리
  const rawWords = targetKeyword
    .split(/[\s,·\-_/]+/)
    .map((w) => w.replace(/[^\w가-힣]/g, '').toLowerCase())
    .filter((w) => w.length >= 2);

  const subTokens = new Set<string>();
  for (const w of rawWords) {
    subTokens.add(w);
    if (w.length >= 4) {
      subTokens.add(w.slice(0, 2));
      subTokens.add(w.slice(2));
      subTokens.add(w.slice(0, w.length - 1));
    }
  }
  const tokenList = Array.from(subTokens).filter((t) => t.length >= 2);

  for (const title of pastTitles) {
    const cleanTitle = title.replace(/[^\w가-힣]/g, '').toLowerCase();

    // 2) 전체 키워드 포함 대조
    if (cleanTitle.includes(cleanTarget) || (cleanTarget.length >= 4 && cleanTarget.includes(cleanTitle))) {
      return true;
    }

    // 3) 핵심 2글자 이상 토큰이 제목에서 2개 이상 매칭되는 경우 (예: "성수" + "팝업")
    const matchedTokens = tokenList.filter((t) => cleanTitle.includes(t));
    if (matchedTokens.length >= 2) {
      return true;
    }

    // 4) 3글자 이상 고유 고유명사 토큰 일치 (예: "두바이", "말랑이", "삐끼삐끼", "암백신", "성수동")
    for (const token of rawWords) {
      if (token.length >= 3 && cleanTitle.includes(token)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 5. 5대 소스 전수 수집 및 최근 발행 글 필터링
 */
export async function collectAllTrendSources(alreadyPublishedTitles: string[] = []): Promise<TrendRawItem[]> {
  console.log('📡 [트렌드 5대 소스 수집기] 구글, 유튜브, 틱톡, 릴스, 네이버 전수 동시 수집 중...');

  const [googleItems, ytItems, tiktokReelsItems, naverItems] = await Promise.all([
    fetchGoogleTrendsKR(),
    fetchYouTubeTrends(),
    fetchTikTokAndReelsTrends(),
    fetchNaverAndCommunityTrends(),
  ]);

  let allItems = [...googleItems, ...ytItems, ...tiktokReelsItems, ...naverItems];
  console.log(`📊 5대 소스 수집 완료: 구글(${googleItems.length}건), 유튜브(${ytItems.length}건), 틱톡/릴스(${tiktokReelsItems.length}건), 네이버/바이럴(${naverItems.length}건) -> 총 ${allItems.length}개 후보`);

  // 최근 발행된 글 목록과 중복되는 키워드 1차 필터링
  if (alreadyPublishedTitles.length > 0) {
    console.log(`🔍 [중복 방지 필터링] 최근 발행된 ${alreadyPublishedTitles.length}개 포스트 제목 대조 중...`);
    allItems = allItems.filter((item) => {
      const isDup = isTopicDuplicate(item.keyword, alreadyPublishedTitles) || isTopicDuplicate(item.title, alreadyPublishedTitles);
      if (isDup) {
        console.log(`   └ [1차 배제] 기발행 유사 키워드 제외: "${item.keyword}"`);
      }
      return !isDup;
    });
    console.log(`✅ 중복 제외 후 남은 신규 트렌드 후보: ${allItems.length}개`);
  }

  return allItems;
}

/**
 * 6. 상위 N대 트렌드 후보군 동시 선별 (순차적 폴백용)
 */
export async function selectTopTrendCandidates(
  apiKey: string,
  alreadyPublishedTitles: string[] = [],
  count: number = 3
): Promise<TrendTopic[]> {
  const allItems = await collectAllTrendSources(alreadyPublishedTitles);

  const prompt = `당신은 대한민국 최고의 트렌드 큐레이터이자 바이럴 분석가입니다.
아래는 오늘 실시간으로 수집된 [구글 트렌드], [유튜브 쇼츠/인기영상], [틱톡/릴스 챌린지], [네이버/커뮤니티 바이럴] 신규 후보 데이터입니다.

[수집된 신규 트렌드 후보 풀]
${JSON.stringify(allItems.slice(0, 45), null, 2)}

[🚫 절대 중복 금지 목록 - 최근 이미 발행된 포스팅]
${alreadyPublishedTitles.length > 0 ? alreadyPublishedTitles.slice(0, 25).map((t) => `- ${t}`).join('\n') : '없음'}

[선별 기준]
1. ★ **신규 대세 주제 선별**: 위 [절대 중복 금지 목록]에 이미 발행된 키워드/소재는 100% 배제하고, 아직 다루지 않은 완전히 새로운 실시간 대세 트렌드 상위 ${count}개를 우선순위대로 선별하세요.
2. ★ **5대 소스 교차 교집합 최우선**: 구글, 유튜브, 틱톡, 릴스, 네이버 중 2개 이상의 소스에서 공통적으로 유행하거나 검색량이 폭발하고 있는 대세 주제를 고르세요.
3. **카테고리 분류**: 'HOT_PLACE', 'SHOPPING_ITEM', 'MEME_TREND' 중 하나로 분류하세요.
4. **후킹 포인트 도출**: 점심시간(12:00) 직장인/학생이 홀린 듯이 클릭할 수밖에 없는 어그로/호기심 자극 포인트 작성.

반드시 다음 JSON 배열 형식으로만 응답하세요 (총 ${count}개):
[
  {
    "keyword": "선정된 새로운 핵심 키워드 1",
    "category": "HOT_PLACE | SHOPPING_ITEM | MEME_TREND",
    "categoryNameKo": "SNS 핫플레이스/맛집 (또는 바이럴 꿀템/쇼핑, 화제의 밈/이슈)",
    "headlineHook": "어그로 후킹 핵심 요약",
    "sources": ["tiktok_reels", "youtube", "google_trends"],
    "matchScore": 95,
    "searchQueries": ["키워드 위치", "키워드 가격", "키워드 솔직 후기"]
  }, ...
]`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await generateContentWithFallback(ai, {
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });

  const rawList = safeJsonParse<any[]>(response.text || '[]', []);
  if (Array.isArray(rawList) && rawList.length > 0) {
    return rawList.map((rawObj, i) => ({
      keyword: rawObj?.keyword || allItems[i]?.keyword || `실시간 화제의 신상 트렌드 ${i + 1}`,
      category: (rawObj?.category as TrendCategory) || ('HOT_PLACE' as TrendCategory),
      categoryNameKo: rawObj?.categoryNameKo || 'SNS 핫플레이스 & 라이프 트렌드',
      headlineHook: rawObj?.headlineHook || `${rawObj?.keyword || '트렌드'} 솔직 후기 및 완벽 분석`,
      sources: Array.isArray(rawObj?.sources) && rawObj.sources.length > 0 ? rawObj.sources : ['tiktok_reels', 'youtube'],
      matchScore: typeof rawObj?.matchScore === 'number' ? rawObj.matchScore : 90,
      searchQueries: Array.isArray(rawObj?.searchQueries) && rawObj.searchQueries.length > 0
        ? rawObj.searchQueries
        : [`${rawObj?.keyword} 위치`, `${rawObj?.keyword} 가격`, `${rawObj?.keyword} 솔직 후기`],
    }));
  }

  // 폴백 시 3개의 유효한 후보 유지
  return allItems.slice(0, count).map((item, idx) => ({
    keyword: item.keyword,
    category: 'HOT_PLACE',
    categoryNameKo: 'SNS 핫플레이스 & 라이프 트렌드',
    headlineHook: `${item.keyword} 솔직 후기 및 완벽 분석`,
    sources: ['tiktok_reels', 'youtube'],
    matchScore: 90,
    searchQueries: [`${item.keyword} 위치`, `${item.keyword} 가격`, `${item.keyword} 솔직 후기`],
  }));
}

/**
 * 7. 단일 1위 트렌드 주제 선정
 */
export async function selectTopTrendTopic(
  apiKey: string,
  alreadyPublishedTitles: string[] = []
): Promise<TrendTopic> {
  const candidates = await selectTopTrendCandidates(apiKey, alreadyPublishedTitles, 1);
  return candidates[0];
}

/**
 * 8. 사용자 지정 키워드 구조화
 */
export async function resolveCustomTopic(
  apiKey: string,
  keyword: string
): Promise<TrendTopic> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `사용자가 직접 지정한 키워드: "${keyword}"
이 키워드를 분석하여 트렌드 카테고리와 후킹 포인트, 검색 쿼리를 JSON으로 도출하세요.

형식:
{
  "keyword": "${keyword}",
  "category": "HOT_PLACE | SHOPPING_ITEM | MEME_TREND",
  "categoryNameKo": "SNS 핫플레이스/맛집 (또는 바이럴 꿀템/쇼핑, 화제의 밈/이슈)",
  "headlineHook": "어그로 후킹 1줄",
  "sources": ["google_trends"],
  "matchScore": 99,
  "searchQueries": ["${keyword} 위치", "${keyword} 가격", "${keyword} 정보"]
}`;

  try {
    const res = await generateContentWithFallback(ai, {
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.2 },
    });
    const parsed = safeJsonParse<any>(res.text || '{}', {});
    return {
      keyword,
      category: parsed.category || 'HOT_PLACE',
      categoryNameKo: parsed.categoryNameKo || '라이프 & 트렌드',
      headlineHook: parsed.headlineHook || `${keyword} 완벽 분석 및 솔직 후기`,
      sources: ['google_trends'],
      matchScore: 99,
      searchQueries: parsed.searchQueries || [`${keyword} 정보`, `${keyword} 후기`],
    };
  } catch {
    return {
      keyword,
      category: 'HOT_PLACE',
      categoryNameKo: '라이프 & 트렌드',
      headlineHook: `${keyword} 완벽 분석 및 솔직 후기`,
      sources: ['google_trends'],
      matchScore: 99,
      searchQueries: [`${keyword} 정보`, `${keyword} 후기`],
    };
  }
}
