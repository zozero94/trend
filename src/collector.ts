import Parser from 'rss-parser';
import { GoogleGenAI } from '@google/genai';
import { TrendRawItem, TrendTopic, TrendCategory } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

const parser = new Parser({
  timeout: 8000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
});

/**
 * 1. 구글 트렌드 대한민국 일별 급상승 검색어 RSS 수집
 */
export async function fetchGoogleTrendsKR(): Promise<TrendRawItem[]> {
  const items: TrendRawItem[] = [];
  const urls = [
    'https://trends.google.co.kr/trending/rss?geo=KR',
    'https://trends.google.com/trending/rss?geo=KR',
  ];

  for (const url of urls) {
    try {
      const feed = await parser.parseURL(url);
      if (feed.items && feed.items.length > 0) {
        feed.items.forEach((it, idx) => {
          if (it.title) {
            items.push({
              source: 'google_trends',
              keyword: it.title.trim(),
              title: it.title.trim(),
              snippet: it.contentSnippet || it.summary || '',
              rank: idx + 1,
              url: it.link,
            });
          }
        });
        break;
      }
    } catch (e) {
      console.warn(`[TrendCollector] Google Trends RSS (${url}) 실패, fallback 시도:`, e);
    }
  }

  return items;
}

/**
 * 2. 유튜브 인기 급상승 & 바이럴 쇼츠 키워드 수집
 */
export async function fetchYouTubeTrends(): Promise<TrendRawItem[]> {
  const items: TrendRawItem[] = [];
  const ytFeeds = [
    { name: '인기급상승', url: 'https://www.youtube.com/feeds/videos.xml?chart=mostpopular' },
  ];

  for (const feedInfo of ytFeeds) {
    try {
      const feed = await parser.parseURL(feedInfo.url);
      (feed.items || []).slice(0, 15).forEach((it, idx) => {
        if (it.title) {
          items.push({
            source: 'youtube',
            keyword: it.title.replace(/[#\[\(].*?[\]\)]/g, '').trim(),
            title: it.title.trim(),
            snippet: it.contentSnippet || '',
            rank: idx + 1,
            url: it.link,
          });
        }
      });
    } catch (e) {
      // pass
    }
  }

  return items;
}

/**
 * 3. 네이버 및 커뮤니티 바이럴 트렌드 수집
 */
export async function fetchNaverAndCommunityTrends(): Promise<TrendRawItem[]> {
  const items: TrendRawItem[] = [];
  const rssList = [
    'https://news.google.com/rss/search?q=%22%EB%A6%B4%EC%8A%A4%22+OR+%22%EC%87%BC%EC%B8%A0%22+OR+%22%ED%92%88%EC%A0%88%EB%8C%80%EB%9E%80%22+OR+%22%EC%9B%A8%EC%9D%B4%ED%8C%85%22&hl=ko&gl=KR&ceid=KR:ko',
    'https://news.google.com/rss/search?q=%22%ED%95%AB%ED%94%8C%22+OR+%22%EB%82%B4%EB%8F%88%EB%82%B4%EC%82%B0%22+OR+%22%EA%BF%80%ED%85%9C%22&hl=ko&gl=KR&ceid=KR:ko',
  ];

  for (const rss of rssList) {
    try {
      const feed = await parser.parseURL(rss);
      (feed.items || []).slice(0, 10).forEach((it, idx) => {
        if (it.title) {
          items.push({
            source: 'naver_datalab',
            keyword: it.title.split(' - ')[0].trim(),
            title: it.title.trim(),
            snippet: it.contentSnippet || '',
            rank: idx + 1,
            url: it.link,
          });
        }
      });
    } catch (e) {
      // pass
    }
  }

  return items;
}

/**
 * 4. 3대 소스 교집합 가중치 1등 주제 선별 (최근 발행 글 중복 100% 원천 차단)
 */
export async function selectTopTrendTopic(
  apiKey: string,
  alreadyPublishedTitles: string[] = []
): Promise<TrendTopic> {
  console.log('📡 [트렌드 수집기] 구글 트렌드, 유튜브, 네이버 3대 소스 동시 수집 중...');
  
  const [googleItems, ytItems, naverItems] = await Promise.all([
    fetchGoogleTrendsKR(),
    fetchYouTubeTrends(),
    fetchNaverAndCommunityTrends(),
  ]);

  let allItems = [...googleItems, ...ytItems, ...naverItems];
  console.log(`📊 수집 완료: 구글(${googleItems.length}건), 유튜브(${ytItems.length}건), 네이버/바이럴(${naverItems.length}건) -> 총 ${allItems.length}개 후보`);

  // 1. 최근 발행된 글 목록과 중복되는 키워드 1차 코드 레벨 필터링
  if (alreadyPublishedTitles.length > 0) {
    console.log(`🔍 [중복 방지 필터링] 최근 발행된 ${alreadyPublishedTitles.length}개 포스트 제목 대조 중...`);
    allItems = allItems.filter((item) => {
      const isDup = alreadyPublishedTitles.some((title) => {
        const cleanTitle = title.replace(/[^\w가-힣]/g, '').toLowerCase();
        const cleanKw = item.keyword.replace(/[^\w가-힣]/g, '').toLowerCase();
        return cleanTitle.includes(cleanKw) || (cleanKw.length >= 3 && cleanTitle.includes(cleanKw.slice(0, 3)));
      });
      return !isDup;
    });
    console.log(`✅ 중복 제외 후 남은 신규 트렌드 후보: ${allItems.length}개`);
  }

  const prompt = `당신은 대한민국 최고의 트렌드 큐레이터이자 바이럴 분석가입니다.
아래는 오늘 실시간으로 수집된 [구글 트렌드], [유튜브 쇼츠/인기영상], [네이버/커뮤니티 바이럴] 신규 후보 데이터입니다.

[수집된 신규 트렌드 후보 풀]
${JSON.stringify(allItems.slice(0, 40), null, 2)}

[🚫 절대 중복 금지 목록 - 최근 이미 발행된 포스팅]
${alreadyPublishedTitles.length > 0 ? alreadyPublishedTitles.slice(0, 20).map((t) => `- ${t}`).join('\n') : '없음'}

[선별 기준]
1. ★ **신규 대세 주제 필수**: 위 [절대 중복 금지 목록]에 이미 발행된 키워드/소재는 100% 배제하고, 아직 다루지 않은 완전히 새로운 차순위 대세 트렌드 1개를 선정하세요.
2. ★ **교차 교집합 최우선**: 구글, 유튜브, 네이버 중 2개 이상의 소스에서 공통적으로 유행하거나 검색량이 폭발하고 있는 대세 주제를 고르세요.
3. **카테고리 분류**: 다음 3가지 중 하나로 명확히 분류하세요:
   - 'HOT_PLACE': 성수/홍대/강남 등 SNS 화제의 맛집, 신상 카페, 팝업스토어, 여행지
   - 'SHOPPING_ITEM': 다이소 대란템, 올리브영 꿀템, 쿠팡 인기템, 신상 전자기기/패션
   - 'MEME_TREND': 릴스/쇼츠 유행어, 밈 챌린지, 화제의 인물/사건 이슈
4. **후킹 포인트 도출**: 점심시간(12:00) 직장인/학생이 홀린 듯이 클릭할 수밖에 없는 어그로/호기심 자극 포인트 작성.
5. **검색 쿼리 생성**: 사실 확인(위치, 가격, 구매처, 팩트체크)을 위해 웹에서 검색할 키워드 3~4개 생성.

반드시 다음 JSON 형식으로만 응답하세요:
{
  "keyword": "선정된 새로운 핵심 키워드",
  "category": "HOT_PLACE | SHOPPING_ITEM | MEME_TREND",
  "categoryNameKo": "SNS 핫플레이스/맛집 (또는 바이럴 꿀템/쇼핑, 화제의 밈/이슈)",
  "headlineHook": "어그로 후킹 핵심 요약",
  "sources": ["youtube", "google_trends"],
  "matchScore": 95,
  "searchQueries": ["키워드 위치", "키워드 가격", "키워드 솔직 후기"]
}`;

  const ai = new GoogleGenAI({ apiKey });
  const response = await generateContentWithFallback(ai, {
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.4,
    },
  });

  const fallbackCandidate = allItems[0]?.keyword || '실시간 화제의 신상 트렌드';

  const parsed = safeJsonParse<TrendTopic>(response.text || '{}', {
    keyword: fallbackCandidate,
    category: 'HOT_PLACE' as TrendCategory,
    categoryNameKo: 'SNS 핫플레이스/맛집',
    headlineHook: `${fallbackCandidate} 솔직 후기 및 완벽 분석`,
    sources: ['google_trends', 'youtube'],
    matchScore: 90,
    searchQueries: [`${fallbackCandidate} 위치`, `${fallbackCandidate} 웨이팅`, `${fallbackCandidate} 후기`],
  });

  return parsed;
}
