import 'dotenv/config';
import { selectTopTrendTopic } from './collector.js';
import {
  sanitizeSearchKeywords,
  verifyUrlAndCaptureScreenshot,
  auditAndFixHtmlLinks,
} from './verifier.js';
import { generateInitialTrendPost } from './ai.js';
import { executeTwoRoundTrendReviewLoop } from './reviewer.js';
import { BloggerClient } from './blogger.js';
import { TelegramNotifier } from './telegram.js';
import { TrendTopic, TrendCategory } from './types.js';
import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

async function resolveCustomTopic(apiKey: string, customKeyword: string): Promise<TrendTopic> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `사용자가 지정한 실시간 트렌드 키워드: "${customKeyword}"
이 키워드에 대해 다음 3가지 중 가장 적합한 카테고리를 판별하고, 호기심/클릭을 유발하는 어그로 후킹 포인트와 검색 쿼리를 작성하세요:
- 'HOT_PLACE': 맛집, 핫플, 카페
- 'SHOPPING_ITEM': 꿀템, 신제품, 쇼핑, 구매템
- 'MEME_TREND': 화제의 밈, 과학/의학/바이오 이슈, 시사이슈, 신기술

반드시 다음 JSON 형식으로만 응답하세요:
{
  "keyword": "${customKeyword}",
  "category": "HOT_PLACE | SHOPPING_ITEM | MEME_TREND",
  "categoryNameKo": "화제의 핫이슈 (또는 바이럴 꿀템, 핫플레이스)",
  "headlineHook": "어그로 후킹 핵심 요약",
  "sources": ["google_trends", "youtube", "naver_datalab"],
  "matchScore": 100,
  "searchQueries": ["${customKeyword} 원리", "${customKeyword} 최신 근황", "${customKeyword} 진실과 거짓"]
}`;

  try {
    const res = await generateContentWithFallback(ai, {
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.3 },
    });
    return safeJsonParse<TrendTopic>(res.text || '{}', {
      keyword: customKeyword,
      category: 'MEME_TREND' as TrendCategory,
      categoryNameKo: '화제의 핫이슈 & 트렌드',
      headlineHook: `${customKeyword}의 진실과 핵심 총정리`,
      sources: ['google_trends', 'youtube', 'naver_datalab'],
      matchScore: 100,
      searchQueries: [`${customKeyword} 최신`, `${customKeyword} 팩트체크`],
    });
  } catch {
    return {
      keyword: customKeyword,
      category: 'MEME_TREND' as TrendCategory,
      categoryNameKo: '화제의 핫이슈 & 트렌드',
      headlineHook: `${customKeyword}의 진실과 핵심 총정리`,
      sources: ['google_trends', 'youtube', 'naver_datalab'],
      matchScore: 100,
      searchQueries: [`${customKeyword} 최신`, `${customKeyword} 팩트체크`],
    };
  }
}

async function runTrendPipeline() {
  console.log('\n================================================================');
  console.log('🚀 [트렌드 자동화 파이프라인] 실시간 핫플·꿀템·밈·이슈 포스팅 가동');
  console.log('================================================================');

  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY;
  const bloggerBlogId = process.env.BLOGGER_BLOG_ID || process.env.TREND_BLOGGER_BLOG_ID;
  const bloggerClientId = process.env.BLOGGER_CLIENT_ID;
  const bloggerClientSecret = process.env.BLOGGER_CLIENT_SECRET;
  const bloggerRefreshToken = process.env.BLOGGER_REFRESH_TOKEN;
  const coupangPartnersId = process.env.COUPANG_PARTNERS_ID || 'AF2968960';
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;

  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY(또는 GOOGLE_GENAI_API_KEY)가 설정되지 않았습니다. GitHub Secrets를 확인해 주세요.');
  }

  // Blogger 2호점 최근 발행 글 목록 조회 (중복 주제 원천 차단)
  let recentTitles: string[] = [];
  if (bloggerBlogId && bloggerClientId && bloggerClientSecret && bloggerRefreshToken) {
    try {
      const blogger = new BloggerClient(bloggerBlogId, bloggerClientId, bloggerClientSecret, bloggerRefreshToken);
      const recentPosts = await blogger.getPosts(30);
      recentTitles = recentPosts.map((p) => p.title).filter(Boolean);
      console.log(`📋 [Blogger 2호점 연동] 최근 발행된 글 ${recentTitles.length}건 확인 완료 (중복 방지 목록에 반영)`);
    } catch (e) {
      console.warn('⚠️ 최근 포스트 목록 조회 실패 (신규 후보 전체 대상으로 진행):', e);
    }
  }

  // 커스텀 키워드 인자 확인 (--keyword="암백신" 또는 환경변수 CUSTOM_KEYWORD)
  const keywordArg = process.argv.find((a) => a.startsWith('--keyword='));
  const customKeyword = keywordArg ? keywordArg.split('=')[1].replace(/["']/g, '') : process.env.CUSTOM_KEYWORD;

  let topic: TrendTopic;
  if (customKeyword) {
    console.log(`\n🎯 [지정 키워드 모드] 사용자가 지정한 키워드로 분석 진행: "${customKeyword}"`);
    topic = await resolveCustomTopic(geminiApiKey, customKeyword);
  } else {
    // --- 1단계: 3대 소스 교집합 1등 트렌드 주제 자동 선정 (중복 100% 제외) ---
    console.log('\n[1단계] 실시간 대세 트렌드 키워드 수집 및 교집합 분석 (기존 글 제외)...');
    topic = await selectTopTrendTopic(geminiApiKey, recentTitles);
  }

  console.log(`🎯 최종 선정 주제: "${topic.keyword}" (${topic.categoryNameKo})`);
  console.log(`   - 후킹 포인트: ${topic.headlineHook}`);
  console.log(`   - 탐지 소스: ${topic.sources.join(', ')} (신뢰도 점수: ${topic.matchScore}점)`);

  // --- 2단계: 표준 키워드 정제 & Playwright 스크린샷 3대 플랫폼+공식출처 전수 크로스체크 ---
  console.log('\n[2단계] 표준 키워드 정제 및 Playwright 스크린샷 4대 랜딩(공식처·네이버·유튜브·쿠팡) 전수 검증...');
  const sanitized = await sanitizeSearchKeywords(geminiApiKey, topic);
  console.log(`   - 오탈자 없는 표준 키워드: "${sanitized.exactTopicKeyword}"`);
  console.log(`   - 쿠팡 100% 검색용 상품명: "${sanitized.exactProductKeyword}"`);
  console.log(`   - 🏛️ 공식 오피셜 출처/예약처: "${sanitized.officialSiteName}" (${sanitized.officialLandingUrl})`);

  const verifiedLinks = await Promise.all([
    verifyUrlAndCaptureScreenshot(geminiApiKey, sanitized.officialLandingUrl, sanitized.exactTopicKeyword, 'general'),
    verifyUrlAndCaptureScreenshot(geminiApiKey, sanitized.naverSearchUrl, sanitized.exactTopicKeyword, 'naver'),
    verifyUrlAndCaptureScreenshot(geminiApiKey, sanitized.youtubeSearchUrl, sanitized.exactTopicKeyword, 'youtube'),
    verifyUrlAndCaptureScreenshot(geminiApiKey, sanitized.coupangSearchUrl, sanitized.exactProductKeyword, 'coupang'),
  ]);

  // --- 3단계: CTR 극대화 후킹 초안 생성 ---
  console.log('\n[3단계] 클릭률 극대화 후킹 초안 작성 중...');
  const initialPost = await generateInitialTrendPost(
    geminiApiKey,
    topic,
    verifiedLinks,
    sanitized.coupangSearchUrl,
    coupangPartnersId
  );
  console.log(`📄 작성된 초안 제목: "${initialPost.title}"`);

  // --- 4단계: 16인 트렌드/바이럴 에이전트 최소 2회+80점 돌파 감수 및 리라이팅 ---
  console.log('\n[4단계] 16인의 바이럴/트렌드 전문가 감수 루프 실행 (최소 2회 + 80점 돌파제)...');
  const reviewResult = await executeTwoRoundTrendReviewLoop(geminiApiKey, initialPost, topic);
  const { finalPost, reviewSummary, passed, finalScore } = reviewResult;

  // ★ [품질 방어선] 80점 미만 시 블로거 등록 및 발행 승인 원천 차단 (반려 처리)
  if (!passed) {
    console.error(`\n🚫 [품질 기준 미달] 16인 종합 점수(${finalScore}점)가 통과 기준(80점)에 미달하여 발행을 중단(반려)합니다.`);
    if (telegramBotToken && telegramChatId) {
      const telegram = new TelegramNotifier(telegramBotToken, telegramChatId, bloggerBlogId || '');
      await telegram.sendMessage(
        `🚫 <b>[트렌드 2호점] 원고 품질 미달 자동 반려</b>\n\n` +
        `📌 <b>주제:</b> ${topic.keyword} (${topic.categoryNameKo})\n` +
        `📝 <b>제목:</b> ${finalPost.title}\n` +
        `📊 <b>16인 감수 최종 평점:</b> <b>${finalScore}점</b> / 100점 (기준: 80점)\n\n` +
        `⚠️ <b>반려 사유:</b> 16인의 전문 감수단 심사에서 4라운드 동안 목표 점수(80점)를 달성하지 못하여 구글 블로그 등록 및 발행이 자동 중단(반려)되었습니다.\n\n` +
        `🔍 <b>감수 이력:</b> ${reviewSummary}`
      );
    }
    return;
  }

  // --- 4.5단계: 본문 최종 HTML 내 모든 링크 전수 감사 및 오탈자/이미지/더미요소 자동 교정 ---
  console.log('\n[4.5단계] 본문 HTML 내 모든 하이퍼링크 무결성 전수 감사 및 미디어 교정...');
  finalPost.htmlContent = auditAndFixHtmlLinks(
    finalPost.htmlContent,
    {
      youtube: sanitized.youtubeSearchUrl,
      naver: sanitized.naverSearchUrl,
      naverMap: sanitized.naverMapUrl,
      coupang: sanitized.coupangSearchUrl,
      officialLandingUrl: sanitized.officialLandingUrl,
    },
    sanitized.exactTopicKeyword,
    topic.category
  );
  console.log(`✨ 최종 리라이팅 및 링크/미디어 무결성 검증 완성: "${finalPost.title}"`);

  // --- 5단계: 구글 블로거 2호점에 Draft 등록 ---
  const isDryRun = process.argv.includes('--dry-run');
  if (isDryRun) {
    console.log('\n⚠️ [Dry Run 모드] 실제 Blogger 등록 및 텔레그램 발송을 생략합니다.');
    console.log(`\n[생성된 포스트 미리보기]\n제목: ${finalPost.title}\n요약: ${finalPost.summary}\n태그: ${finalPost.tags.join(', ')}`);
    return;
  }

  if (!bloggerBlogId || !bloggerClientId || !bloggerClientSecret || !bloggerRefreshToken) {
    console.warn('\n⚠️ Blogger API 자격증명이 부족하여 Draft 등록을 건너뜁니다.');
    return;
  }

  console.log('\n[5단계] 구글 블로거 2호점 (Headless DB)에 Draft 등록 중...');
  const blogger = new BloggerClient(bloggerBlogId, bloggerClientId, bloggerClientSecret, bloggerRefreshToken);
  const draftPost = await blogger.createDraftPost(
    finalPost.title,
    finalPost.htmlContent,
    [topic.categoryNameKo, sanitized.exactTopicKeyword, ...finalPost.tags]
  );
  console.log(`✅ Blogger Draft 등록 성공! (Post ID: ${draftPost.id})`);

  // --- 6단계: 텔레그램 승인 알림 발송 ---
  if (telegramBotToken && telegramChatId && draftPost.id) {
    console.log('\n[6단계] 텔레그램 모바일 승인 알림 전송 중...');
    const telegram = new TelegramNotifier(telegramBotToken, telegramChatId, bloggerBlogId);
    await telegram.sendTrendDraftNotification(finalPost, topic, draftPost.id, reviewSummary);
  }

  console.log('\n================================================================');
  console.log('🎉 [트렌드 파이프라인 완료] 모든 작업이 성공적으로 끝났습니다!');
  console.log('================================================================\n');
}

runTrendPipeline().catch((err) => {
  console.error('\n❌ [Pipeline Error] 실행 중 치명적 오류 발생:', err);
  process.exit(1);
});
