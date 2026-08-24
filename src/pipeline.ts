import 'dotenv/config';
import { selectTopTrendCandidates, resolveCustomTopic } from './collector.js';
import { sanitizeSearchKeywords, verifyUrlAndCaptureScreenshot, auditAndFixHtmlLinks } from './verifier.js';
import { generateInitialTrendPost } from './ai.js';
import { executeTwoRoundTrendReviewLoop } from './reviewer.js';
import { BloggerClient } from './blogger.js';
import { TelegramNotifier } from './telegram.js';
import { TrendTopic, VerifiedLink } from './types.js';

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function runTrendPipeline() {
  console.log('================================================================');
  console.log('🚀 [트렌드 2호점] 16인 AI 에이전트 & 멀티모달 랜딩 검증 자동화 파이프라인');
  console.log('================================================================');

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY 환경변수가 설정되지 않았습니다.');
  }

  const bloggerBlogId = process.env.BLOGGER_BLOG_ID;
  const bloggerClientId = process.env.BLOGGER_CLIENT_ID;
  const bloggerClientSecret = process.env.BLOGGER_CLIENT_SECRET;
  const bloggerRefreshToken = process.env.BLOGGER_REFRESH_TOKEN;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const coupangPartnersId = process.env.COUPANG_PARTNERS_ID || 'AF2968960';

  // 최근 발행된 글 목록 수집 (중복 주제 발행 원천 방지)
  let recentTitles: string[] = [];
  if (bloggerBlogId && bloggerClientId && bloggerClientSecret && bloggerRefreshToken) {
    try {
      const blogger = new BloggerClient(bloggerBlogId, bloggerClientId, bloggerClientSecret, bloggerRefreshToken);
      const posts = await blogger.getPosts(20);
      recentTitles = posts.map((p) => p.title);
      console.log(`📚 최근 발행된 블로그 글 ${recentTitles.length}개 확인 완료 (중복 제외 필터링 가동)`);
    } catch (e) {
      console.warn('⚠️ 최근 글 목록 조회 실패, 기본 중복 방지 모드로 진행합니다.');
    }
  }

  // 커스텀 키워드 인자 확인 (--keyword="암백신" 또는 환경변수 CUSTOM_KEYWORD)
  const keywordArg = process.argv.find((a) => a.startsWith('--keyword='));
  const customKeyword = keywordArg ? keywordArg.split('=')[1].replace(/["']/g, '') : process.env.CUSTOM_KEYWORD;

  let candidateTopics: TrendTopic[] = [];
  if (customKeyword) {
    console.log(`\n🎯 [지정 키워드 모드] 사용자가 지정한 키워드로 분석 진행: "${customKeyword}"`);
    const customTopic = await resolveCustomTopic(geminiApiKey, customKeyword);
    candidateTopics = [customTopic];
  } else {
    // --- 1단계: 실시간 대세 트렌드 상위 3대 후보군 선별 ---
    console.log('\n[1단계] 실시간 대세 트렌드 키워드 수집 및 상위 3대 후보군 선별 (기존 글 제외)...');
    candidateTopics = await selectTopTrendCandidates(geminiApiKey, recentTitles, 3);
  }

  const isDryRun = process.argv.includes('--dry-run');
  let publishedSuccess = false;

  for (let candidateIdx = 0; candidateIdx < candidateTopics.length; candidateIdx++) {
    const topic = candidateTopics[candidateIdx];
    try {
      console.log(`\n================================================================`);
      console.log(`🎯 [후보 ${candidateIdx + 1}/${candidateTopics.length}] 트렌드 탐구 시작: "${topic.keyword}" (${topic.categoryNameKo})`);
      console.log(`   - 후킹 포인트: ${topic.headlineHook}`);
      console.log(`   - 탐지 소스: ${topic.sources.join(', ')} (신뢰도 점수: ${topic.matchScore}점)`);
      console.log(`================================================================`);

      // --- 2단계: 표준 키워드 정제 & 멀티모달(DOM+Vision) 랜딩 순차 정밀 검증 (메모리 절감) ---
      console.log('\n[2단계] 표준 키워드 정제 및 Playwright 4대 랜딩(공식처·네이버·유튜브·쿠팡) 순차 검증...');
      const sanitized = await sanitizeSearchKeywords(geminiApiKey, topic);
      console.log(`   - 오탈자 없는 표준 키워드: "${sanitized.exactTopicKeyword}"`);
      console.log(`   - 쿠팡 100% 검색용 상품명: "${sanitized.exactProductKeyword}"`);
      console.log(`   - 🏛️ 공식 오피셜 출처/예약처: "${sanitized.officialSiteName}" (${sanitized.officialLandingUrl})`);

      const linkQueue = [
        { url: sanitized.officialLandingUrl, keyword: sanitized.exactTopicKeyword, type: 'general' as const },
        { url: sanitized.naverSearchUrl, keyword: sanitized.exactTopicKeyword, type: 'naver' as const },
        { url: sanitized.youtubeSearchUrl, keyword: sanitized.exactTopicKeyword, type: 'youtube' as const },
        { url: sanitized.coupangSearchUrl, keyword: sanitized.exactProductKeyword, type: 'coupang' as const },
      ];

      const verifiedLinks: VerifiedLink[] = [];
      for (const item of linkQueue) {
        const verified = await verifyUrlAndCaptureScreenshot(geminiApiKey, item.url, item.keyword, item.type);
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

      // --- 4단계: 16인 트렌드/바이럴 에이전트 최소 2회+75점 돌파 감수 및 리라이팅 ---
      console.log('\n[4단계] 16인의 바이럴/트렌드 전문가 감수 루프 실행 (최소 2회 + 75점 돌파제)...');
      const reviewResult = await executeTwoRoundTrendReviewLoop(geminiApiKey, initialPost, topic);
      const { finalPost, reviewSummary, passed, finalScore } = reviewResult;

      // ★ [품질 방어선] 75점 미만 시 차순위 주제로 자동 전환 & 재탐구
      if (!passed) {
        console.warn(`\n🚫 [후보 ${candidateIdx + 1} 반려] 16인 종합 점수(${finalScore}점)가 75점 기준 미달!`);
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
        await telegram.sendTrendDraftNotification(finalPost, topic, draftPost.id, reviewSummary);
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
    console.log('🎉 2호점 16인 감수 & 멀티모달 무인 자동화 파이프라인 100% 완료!');
    console.log('📱 텔레그램에서 검토 후 [✅ 즉시 정식 발행] 버튼을 눌러주세요.');
    console.log('================================================================');
  } else {
    console.log('\n⚠️ [2호점 파이프라인 종료] 기준(80점)을 통과한 유효 원고가 없어 안전하게 종료되었습니다.\n');
  }
}

runTrendPipeline().catch((err) => {
  console.error('\n❌ [Pipeline Critical Error] 치명적 오류 발생:', err);
  process.exit(1);
});
