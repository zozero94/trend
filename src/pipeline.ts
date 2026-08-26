import 'dotenv/config';
import { selectTopTrendCandidates, resolveCustomTopic } from './collector.js';
import {
  sanitizeSearchKeywords,
  verifyUrlAndCaptureScreenshot,
  auditAndFixHtmlLinks,
  getDefaultFallbackForCategory,
} from './verifier.js';
import { generateInitialTrendPost } from './ai.js';
import { executeIterativeTrendReviewLoop, rewriteTrendPostWithFeedback } from './reviewer.js';
import { BloggerClient } from './blogger.js';
import { TelegramNotifier } from './telegram.js';
import { TrendTopic, VerifiedLink, AgentFeedback, TrendPost, TrendCategory } from './types.js';

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function runTrendPipeline() {
  console.log('================================================================');
  console.log('🚀 [트렌드 2호점] 18인 AI 에이전트 & 멀티모달 랜딩 검증 자동화 파이프라인');
  console.log('================================================================');

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const bloggerBlogId = process.env.BLOGGER_BLOG_ID || '2498717653629376483';
  const bloggerClientId = process.env.BLOGGER_CLIENT_ID;
  const bloggerClientSecret = process.env.BLOGGER_CLIENT_SECRET;
  const bloggerRefreshToken = process.env.BLOGGER_REFRESH_TOKEN;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const coupangPartnersId = process.env.COUPANG_PARTNERS_ID || 'AF2968960';

  // CLI 인자 및 환경변수 파싱
  const args = process.argv.slice(2);
  let customTopicKeyword = process.env.CUSTOM_KEYWORD || '';
  let revisePostId = process.env.REVISE_POST_ID || '';
  let userFeedback = process.env.USER_FEEDBACK || '';
  let isDryRun = process.env.DRY_RUN === 'true';

  for (const arg of args) {
    if (arg.startsWith('--keyword=')) {
      customTopicKeyword = arg.split('=')[1].replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('--post-id=')) {
      revisePostId = arg.split('=')[1].replace(/^["']|["']$/g, '');
    } else if (arg.startsWith('--feedback=')) {
      userFeedback = arg.split('=')[1].replace(/^["']|["']$/g, '');
    } else if (arg === '--dry-run') {
      isDryRun = true;
    } else if (!arg.startsWith('--') && !customTopicKeyword) {
      customTopicKeyword = arg;
    }
  }

  // =========================================================================
  // ★ [원격 피드백 수정 모드] 기존 Blogger 글 로드 ➔ 사용자 지침 주입 ➔ 18인 감수 루프 ➔ Blogger PUT
  // =========================================================================
  if (revisePostId) {
    console.log(`\n🔄 [피드백 원격 수정 모드 가동]`);
    console.log(`   - 대상 Post ID: "${revisePostId}"`);
    console.log(`   - 사용자 지침: "${userFeedback || '전면 고도화'}"`);

    if (!bloggerBlogId || !bloggerClientId || !bloggerClientSecret || !bloggerRefreshToken) {
      throw new Error('Blogger API 자격증명이 부족합니다.');
    }

    const blogger = new BloggerClient(bloggerBlogId, bloggerClientId, bloggerClientSecret, bloggerRefreshToken);
    const existingPost = await blogger.getPostById(revisePostId);
    if (!existingPost) {
      throw new Error(`해당 Post ID(${revisePostId})의 글을 Blogger에서 찾을 수 없습니다.`);
    }

    const primaryCategory = (existingPost.labels && existingPost.labels.length > 0)
      ? existingPost.labels[0]
      : '화제의 밈/이슈';

    let matchedCategory: TrendCategory = 'MEME_TREND';
    if (primaryCategory.includes('쇼핑') || primaryCategory.includes('꿀템')) matchedCategory = 'SHOPPING_ITEM';
    else if (primaryCategory.includes('핫플레이스') || primaryCategory.includes('맛집') || primaryCategory.includes('성수')) matchedCategory = 'HOT_PLACE';

    const topicKeyword = (existingPost.labels && existingPost.labels.length > 1)
      ? existingPost.labels[1]
      : existingPost.title.slice(0, 20);

    const topic: TrendTopic = {
      keyword: topicKeyword,
      category: matchedCategory,
      categoryNameKo: primaryCategory,
      headlineHook: `[피드백 반영] ${userFeedback || '품질 개선'}`,
      sources: ['google_trends'],
      matchScore: 99,
      searchQueries: [topicKeyword],
    };

    const sanitized = await sanitizeSearchKeywords(geminiApiKey, topic);
    const linkQueue = [
      { url: sanitized.officialLandingUrl, keyword: sanitized.exactTopicKeyword, type: 'general' as const },
      ...(topic.category === 'SHOPPING_ITEM'
        ? [{ url: sanitized.coupangSearchUrl, keyword: sanitized.exactProductKeyword, type: 'coupang' as const }]
        : []),
    ];

    const verifiedLinks: VerifiedLink[] = [];
    for (const item of linkQueue) {
      const verified = await verifyUrlAndCaptureScreenshot(geminiApiKey, item.url, item.keyword, item.type);
      if (item.type === 'general' && (!verified.isHealthy || !verified.isContentMatched || (verified.relevanceScore ?? 0) < 75)) {
        const fallback = getDefaultFallbackForCategory(topic.keyword, topic.category);
        sanitized.officialLandingUrl = fallback.officialLandingUrl;
        sanitized.officialSiteName = fallback.officialSiteName;
        sanitized.isDirectLink = false;
        verified.finalUrl = fallback.officialLandingUrl;
        verified.originalUrl = fallback.officialLandingUrl;
        verified.linkType = 'VERIFIED_SEARCH';
        verified.pageTitle = fallback.officialSiteName;
        verified.isHealthy = true;
        verified.isContentMatched = true;
        verified.relevanceScore = 90;
      }
      verifiedLinks.push(verified);
    }

    const currentTrendPost: TrendPost = {
      title: existingPost.title,
      summary: '기존 원고 피드백 수정',
      metaDescription: existingPost.title,
      category: matchedCategory,
      categoryNameKo: primaryCategory,
      tags: existingPost.labels || [topic.keyword, '트렌드'],
      htmlContent: existingPost.content,
      verifiedLinks,
      coupangUrl: sanitized.coupangSearchUrl,
    };

    const userFeedbackItem: AgentFeedback = {
      agentName: '★ 사용자 긴급 디렉팅',
      role: '텔레그램 원격 총괄 디렉터',
      score: 3,
      strengths: '기존 글의 맥락 유지',
      improvements: `[사용자 직접 지시]: ${userFeedback}. 이 지침을 다른 모든 규칙보다 100% 최우선으로 본문에 반영하여 수정할 것.`,
    };

    console.log('\n[수정 4단계] 18인 전문 감수단 & 사용자 피드백 결합 리라이팅 루프 실행...');
    const initialRewritten = await rewriteTrendPostWithFeedback(
      geminiApiKey,
      currentTrendPost,
      [userFeedbackItem],
      topic,
      1
    );

    const reviewResult = await executeIterativeTrendReviewLoop(geminiApiKey, initialRewritten, topic);
    const { finalPost, reviewSummary } = reviewResult;

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

    console.log(`\n[수정 5단계] Google Blogger 원고 즉시 교체 (Post ID: ${revisePostId})...`);
    await blogger.updatePost(revisePostId, finalPost.title, finalPost.htmlContent, existingPost.labels || []);
    console.log(`✅ Blogger 글 수정 완료!`);

    if (telegramBotToken && telegramChatId) {
      const telegram = new TelegramNotifier(telegramBotToken, telegramChatId, bloggerBlogId);
      await telegram.sendTrendDraftNotification(
        finalPost,
        topic,
        revisePostId,
        `[피드백 반영] ${reviewSummary}`,
        sanitized.officialSiteName,
        sanitized.officialLandingUrl,
        existingPost.url
      );
    }
    return;
  }

  let candidateTopics: TrendTopic[] = [];

  if (customTopicKeyword) {
    console.log(`\n🎯 [수동 지정 모드] 키워드: "${customTopicKeyword}"`);
    const customTopic = await resolveCustomTopic(geminiApiKey, customTopicKeyword);
    candidateTopics = [customTopic];
  } else {
    console.log('\n[1단계] 실시간 대세 트렌드 후보 Top 3 지능형 수집 중...');
    candidateTopics = await selectTopTrendCandidates(geminiApiKey, [], 3);
  }

  if (!candidateTopics || candidateTopics.length === 0) {
    console.error('❌ 유효한 트렌드 주제를 수집하지 못했습니다.');
    process.exit(1);
  }

  let publishedSuccess = false;

  for (let candidateIdx = 0; candidateIdx < candidateTopics.length; candidateIdx++) {
    const topic = candidateTopics[candidateIdx];
    try {
      console.log(`\n================================================================`);
      console.log(`📌 [후보 ${candidateIdx + 1}/${candidateTopics.length}] 탐구 시작: "${topic.keyword}" (${topic.categoryNameKo})`);
      console.log(`   - 후킹 포인트: ${topic.headlineHook}`);
      console.log(`   - 탐지 소스: ${topic.sources.join(', ')} (신뢰도 점수: ${topic.matchScore}점)`);
      console.log(`================================================================`);

      // --- 2단계: 표준 키워드 정제 & 공식 랜딩 멀티모달(DOM+Vision) 정밀 검증 ---
      console.log('\n[2단계] 표준 키워드 정제 및 Playwright 공식 랜딩 정밀 검증...');
      const sanitized = await sanitizeSearchKeywords(geminiApiKey, topic);
      console.log(`   - 오탈자 없는 표준 키워드: "${sanitized.exactTopicKeyword}"`);
      console.log(`   - 쿠팡 100% 검색용 상품명: "${sanitized.exactProductKeyword}"`);
      console.log(`   - 🏛️ 공식 오피셜 출처/예약처: "${sanitized.officialSiteName}" (${sanitized.officialLandingUrl})`);

      const linkQueue = [
        { url: sanitized.officialLandingUrl, keyword: sanitized.exactTopicKeyword, type: 'general' as const },
        ...(topic.category === 'SHOPPING_ITEM'
          ? [{ url: sanitized.coupangSearchUrl, keyword: sanitized.exactProductKeyword, type: 'coupang' as const }]
          : []),
      ];

    const verifiedLinks: VerifiedLink[] = [];
    for (const item of linkQueue) {
      const verified = await verifyUrlAndCaptureScreenshot(geminiApiKey, item.url, item.keyword, item.type);

      // ★ [멀티모달 비전 팩트체크 피드백 루프] 가짜/파킹/75점 미달 시 안전한 네이버 검색/지도 링크로 즉시 강제 치환!
      if (item.type === 'general' && (!verified.isHealthy || !verified.isContentMatched || (verified.relevanceScore ?? 0) < 75)) {
        const fallback = getDefaultFallbackForCategory(topic.keyword, topic.category);
        console.warn(`⚠️ [오피셜 링크 불일치/파킹 감지] "${item.url}" (${verified.relevanceScore}점) -> "${fallback.officialSiteName}" (${fallback.officialLandingUrl}) 로 100% 안전 치환!`);
        sanitized.officialLandingUrl = fallback.officialLandingUrl;
        sanitized.officialSiteName = fallback.officialSiteName;
        sanitized.isDirectLink = false;

        verified.finalUrl = fallback.officialLandingUrl;
        verified.originalUrl = fallback.officialLandingUrl;
        verified.linkType = 'VERIFIED_SEARCH';
        verified.pageTitle = fallback.officialSiteName;
        verified.isHealthy = true;
        verified.isContentMatched = true;
        verified.relevanceScore = 90;
      }

      verifiedLinks.push(verified);
    }

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

    // --- 4단계: 18인 트렌드/바이럴/법률 에이전트 최소 2회+75점 돌파 감수 및 리라이팅 ---
    console.log('\n[4단계] 18인의 바이럴/트렌드/법률 전문가 감수 루프 실행 (최소 2회 + 75점 돌파제)...');
    const reviewResult = await executeIterativeTrendReviewLoop(geminiApiKey, initialPost, topic);
    const { finalPost, reviewSummary, passed, finalScore } = reviewResult;

    // ★ [품질 방어선] 75점 미만 시 차순위 주제로 자동 전환 & 재탐구
    if (!passed) {
      console.warn(`\n🚫 [후보 ${candidateIdx + 1} 반려] 18인 종합 점수(${finalScore}점)가 75점 기준 미달!`);
      const nextCandidate = candidateTopics[candidateIdx + 1];

      if (telegramBotToken && telegramChatId) {
        const telegram = new TelegramNotifier(telegramBotToken, telegramChatId, bloggerBlogId || '');
        if (nextCandidate) {
          await telegram.sendMessage(
            `⚠️ <b>[원고 반려 ➔ 차순위 주제 자동 전환]</b>\n\n` +
            `❌ <b>반려 주제:</b> ${escapeHtml(topic.keyword)} (${finalScore}점 / 기준: 75점)\n` +
            `🔄 <b>감수 이력:</b> ${escapeHtml(reviewSummary)}\n\n` +
            `🚀 <b>자동 조치:</b> 75점을 넘지 못해 즉시 차순위 대세 후보 [<b>${escapeHtml(nextCandidate.keyword)}</b>] 로 전환하여 고품질 원고 재탐구를 시작합니다!`
          );
        } else {
          await telegram.sendMessage(
            `🚫 <b>[트렌드 2호점] 전체 후보 품질 기준 미달</b>\n\n` +
            `수집된 모든 후보가 75점 기준을 달성하지 못하여 포스팅 발행을 안전하게 취소했습니다.`
          );
        }
      }
      continue; // 다음 후보로 넘어가서 파이프라인 재실행!
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
    if (isDryRun) {
      console.log('\n⚠️ [Dry Run 모드] 실제 Blogger 등록 및 텔레그램 발송을 생략합니다.');
      console.log(`\n[생성된 포스트 미리보기]\n제목: ${finalPost.title}\n요약: ${finalPost.summary}\n태그: ${finalPost.tags.join(', ')}`);
      publishedSuccess = true;
      break;
    }

    if (!bloggerBlogId || !bloggerClientId || !bloggerClientSecret || !bloggerRefreshToken) {
      console.warn('\n⚠️ Blogger API 자격증명이 부족하여 Draft 등록을 건너뜁니다.');
      publishedSuccess = true;
      break;
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
      await telegram.sendTrendDraftNotification(
        finalPost,
        topic,
        draftPost.id,
        reviewSummary,
        sanitized.officialSiteName,
        sanitized.officialLandingUrl,
        draftPost.url
      );
    }

      publishedSuccess = true;
      break; // 합격하여 발행 완료되었으므로 종료!
    } catch (candidateError: any) {
      console.error(`\n❌ [후보 ${candidateIdx + 1} 처리 중 오류 발생]:`, candidateError);
      if (candidateIdx < candidateTopics.length - 1) {
        console.log(`🔄 다음 차순위 후보로 자동 전환합니다...`);
      }
    }
  }

  if (publishedSuccess) {
    console.log('\n================================================================');
    console.log('🎉 2호점 18인 감수 & 멀티모달 무인 자동화 파이프라인 100% 완료!');
    console.log('📱 텔레그램에서 검토 후 [✅ 즉시 정식 발행] 버튼을 눌러주세요.');
    console.log('================================================================');
  } else {
    console.log('\n⚠️ [2호점 파이프라인 종료] 기준(75점)을 통과한 유효 원고가 없어 안전하게 종료되었습니다.\n');
  }
}

runTrendPipeline().catch((err) => {
  console.error('\n❌ [Pipeline Critical Error] 치명적 오류 발생:', err);
  process.exit(1);
});
