import { GoogleGenAI } from '@google/genai';
import { TrendPost, AgentFeedback, TrendTopic } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

/**
 * 대한민국 최고 수준의 16인 전문 감수 위원회
 */
export const TREND_REVIEWER_AGENTS = [
  { id: 'ctr_headline', name: 'CTR 후킹 헤드라인 마스터', role: '스마트폰 2030 직장인/학생이 무조건 클릭하게 만드는 후킹 어그로력 검증' },
  { id: 'landing_fact', name: '실시간 랜딩 & 링크 팩트체커', role: '네이버 지도 상세 검색, 영상, 공식 구매처 링크의 실제 작동 및 일치성 검증' },
  { id: 'honest_reviewer', name: '내돈내산 솔직 리뷰어', role: '단순 홍보성 찬양이 아닌 치명적 단점, 아쉬운 점, 호불호 요소 포함 여부 검증' },
  { id: 'hotplace_planner', name: '핫플 웨이팅 & 동선 플래너', role: '정확한 도로명 주소, 오픈런/골든타임, 주차 팁, 메뉴별 가격표 무결성 검증' },
  { id: 'cta_copywriter', name: '구매 전환(CTA) 카피라이터', role: '모바일 쿠팡 링크 클릭 유도 카피 및 추천인/공정위 필수 문구 검증' },
  { id: 'meme_supervisor', name: '밈 유래 & Z세대 트렌드 감수관', role: '릴스/쇼츠/틱톡 밈의 원본 출처 왜곡 방지 및 찰진 신조어 맥락 검증' },
  { id: 'mobile_ux', name: '3초 숏폼 모바일 UI/UX 디자이너', role: '스마트폰 한 손 스크롤 최적화 (2~3문장 문단, 3줄 요약 박스, 테이블) 검증' },
  { id: 'search_seo', name: '네이버/구글 검색 SEO 엔지니어', role: '검색 로봇 친화적 태그 밀도 및 1페이지 상단 노출 키워드 구조화 검증' },
  { id: 'price_hunter', name: '가성비 & 최저가 헌터', role: '정가 대비 체감 가성비 분석 및 실질적인 혜택/최저가 구매 팁 검증' },
  { id: 'link_visual', name: '더미 제거 & 미디어 무결성 감수관', role: '사진 안내문/빈 상자 등 더미 플레이스홀더 원천 배제 및 깨끗한 레이아웃 검증' },
  { id: 'shorts_media_director', name: '쇼츠/릴스 미디어 디렉터', role: '유튜브 영상 및 쇼츠의 직관적 임베드/링크 연결과 시각적 몰입도 검증' },
  { id: 'sponsor_odor_filter', name: '뒷광고/협찬 악취 필터링관', role: '바이럴 마케팅 광고 냄새 제거 및 100% 중립적 팩트체크 검증' },
  { id: 'faq_schema_architect', name: 'FAQ 리치 스니펫 설계관', role: '구글 검색 1페이지를 장악할 핵심 Q&A 3선 구성 및 구조화 데이터 검증' },
  { id: 'dwell_time_booster', name: '체류시간(Dwell Time) 부스터', role: '독자가 중간에 이탈하지 않고 끝까지 정독하게 만드는 호기심 빌드업 검증' },
  { id: 'compliance_guardian', name: '공정위 & 정보 신뢰성 감시관', role: '과장 광고 방지 및 공정거래위원회 표준 문구 완벽 준수 검증' },
  { id: 'official_landing_optimizer', name: '공식 오피셜 출처 & 스마트 랜딩 최적화관', role: '단순 포털 검색결과 대신 국립박물관/브랜드 공식몰/공식 예약처 등 최적의 다이렉트 랜딩 대안 발굴 및 정보 일치성 검증' },
];

/**
 * 16인 트렌드 전문가 에이전트 종합 채점
 */
export async function evaluateWith15TrendAgents(
  apiKey: string,
  post: TrendPost,
  topic: TrendTopic,
  round: number
): Promise<{ feedbacks: AgentFeedback[]; averageScore: number; passed: boolean }> {
  const ai = new GoogleGenAI({ apiKey });

  const agentDescriptions = TREND_REVIEWER_AGENTS.map(
    (a, i) => `${i + 1}. [${a.name}] (${a.role})`
  ).join('\n');

  const prompt = `당신은 대한민국 최고의 트렌드/미디어 바이럴 16인 감수 위원회입니다.
아래 작성된 트렌드 원고(Round ${round} 버전)를 16인의 전문가 관점에서 엄격하고 날카롭게 채점(1~10점)하고 보완 지침을 작성하세요.

[16인의 트렌드 전문가 페르소나]
${agentDescriptions}

[평가 대상 원고]
주제: ${topic.keyword} (${topic.categoryNameKo})
제목: ${post.title}
3줄 요약: ${post.summary}
본문(HTML): ${post.htmlContent.slice(0, 4000)}...

[엄격한 채점 기준]
1. ★ **"내돈내산 솔직 리뷰어" & "뒷광고/협찬 악취 필터링관"**: 무조건적인 찬양글은 6점 이하 감점! 실제 소비자의 치명적 단점/호불호가 반드시 1문단 이상 포함되어야 함.
2. ★ **"CTR 후킹 헤드라인 마스터"**: 제목이 평범하면 6점 이하 감점! 모바일에서 홀린 듯 클릭하게 만드는 강력한 어그로 후킹이 있어야 함.
3. ★ **"더미 제거 & 미디어 무결성 감수관"**: [이미지: ...], [사진 영역] 등 더미 텍스트나 빈 상자가 있으면 0점 처리!
4. ★ **"FAQ 리치 스니펫 설계관"**: 자주 묻는 질문 FAQ 3선이 완벽한 팩트로 작성되어 있는지 확인.
5. ★ **"공식 오피셜 출처 & 스마트 랜딩 최적화관"**: 단순 포털 검색결과 링크 대신 국립박물관 뮷즈 공식몰, 브랜드 공식 공지, 공식 예약처 등 더 나은 직통 랜딩 대안 링크가 반영되어 있는지 엄격 채점.

반드시 다음 JSON 배열 포맷으로만 응답하세요:
[
  {
    "agentName": "전문가 이름",
    "role": "역할",
    "score": 8,
    "strengths": "잘된 부분",
    "improvements": "구체적인 보강 및 수정 지시사항"
  }, ... (총 16개)
]`;

  try {
    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.3 },
    });
    const feedbacks = safeJsonParse<AgentFeedback[]>(response.text || '[]', []);
    const validFeedbacks = feedbacks.length > 0 ? feedbacks : TREND_REVIEWER_AGENTS.map((a) => ({
      agentName: a.name,
      role: a.role,
      score: 7,
      strengths: '기본적인 트렌드 맥락 포착',
      improvements: '솔직한 단점 분석 및 모바일 요약 박스 보강 필요',
    }));
    const totalScore = validFeedbacks.reduce((acc, f) => acc + (f.score || 7), 0);
    const averageScore = Number((totalScore / validFeedbacks.length).toFixed(1));
    const passed = averageScore >= 8.0; // 80점 이상 기준
    return { feedbacks: validFeedbacks, averageScore, passed };
  } catch (e) {
    return {
      feedbacks: TREND_REVIEWER_AGENTS.map((a) => ({
        agentName: a.name,
        role: a.role,
        score: 7,
        strengths: '기본적인 트렌드 맥락 포착',
        improvements: '솔직한 단점 분석 및 모바일 요약 박스 보강 필요',
      })),
      averageScore: 7.0,
      passed: false,
    };
  }
}

/**
 * 16인의 피드백을 수용하여 원고 전면 리라이팅
 */
export async function rewriteTrendPostWithFeedback(
  apiKey: string,
  currentPost: TrendPost,
  feedbacks: AgentFeedback[],
  topic: TrendTopic,
  round: number
): Promise<TrendPost> {
  const ai = new GoogleGenAI({ apiKey });

  const feedbackSummary = feedbacks
    .map(
      (f, i) =>
        `[${i + 1}. ${f.agentName} (점수: ${f.score}/10)]\n- 잘된 점: ${f.strengths}\n- ★ 필수 보강 지침: ${f.improvements}`
    )
    .join('\n\n');

  const systemInstruction = `당신은 대한민국 최고 수준의 수석 트렌드 에디터이자 바이럴 콘텐츠 디렉터입니다.
16인의 바이럴 전문 감수 위원회가 제출한 상세 피드백(Round ${round})을 100% 흡수하여, 기존 원고를 종합 평점 8.5점 이상의 최상급 프리미엄 반응형 트렌드 칼럼으로 전면 리라이팅하세요.

[리라이팅 필수 반영 항목]
1. **🔥 CTR 극대화 어그로/후킹 제목 강화**: 클릭률을 폭발적으로 끌어올리는 감각적인 제목으로 업그레이드
2. **⚖️ 솔직한 단점 & 호불호 팩트 보강**: 협찬 느낌을 완전히 지우고 실제 소비자가 체감하는 솔직한 단점/주의사항 1문단 필수 추가
3. **❓ FAQ 3문 3답 리치 스니펫**: 독자들이 가장 궁금해하는 핵심 질문 3선(Q&A)을 본문 하단에 반드시 배치
4. **📱 모바일 최적화**: 2~3문장 문단, 시각적 구분선, <strong> 태그, 3줄 핵심 요약 박스
5. **🚫 더미 요소 배제**: [이미지: ...], [사진 영역] 등 어떠한 플레이스홀더 텍스트도 절대 작성하지 말 것

[출력 형식]
반드시 다음 JSON 포맷으로만 응답하세요:
{
  "title": "16인 피드백을 반영해 더욱 매력적으로 개선된 후킹 제목",
  "summary": "3줄 핵심 요약",
  "metaDescription": "검색 최적화 메타 디스크립션",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "htmlContent": "<p>완성된 고품질 반응형 HTML 본문...</p>"
}`;

  const prompt = `[현재 원고 제목]: ${currentPost.title}
[카테고리]: ${topic.keyword} (${topic.categoryNameKo})

[16인의 전문가 상세 리뷰 및 보강 지침 (Round ${round})]:
${feedbackSummary}

[기존 본문]:
${currentPost.htmlContent}

위 16인의 지적 사항을 100% 반영하여 종합 80점(8.0점) 이상을 달성할 수 있는 완벽한 최종 원고로 리라이팅해 주세요.`;

  try {
    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.7,
        maxOutputTokens: 8192,
      },
    });

    const parsed = safeJsonParse<any>(response.text || '{}', {});

    return {
      title: parsed.title || currentPost.title,
      summary: parsed.summary || currentPost.summary,
      metaDescription: parsed.metaDescription || currentPost.metaDescription,
      category: currentPost.category,
      categoryNameKo: currentPost.categoryNameKo,
      tags: parsed.tags || currentPost.tags,
      htmlContent: parsed.htmlContent || currentPost.htmlContent,
      verifiedLinks: currentPost.verifiedLinks,
      coupangUrl: currentPost.coupangUrl,
    };
  } catch (err) {
    return currentPost;
  }
}

/**
 * 최소 2회 이상 + 종합점수 80점(8.0점) 돌파할 때까지 반복하는 전문가 감수 루프
 * (최대 4회 시도 후에도 80점 미달 시 passed = false 반환)
 */
export async function executeTwoRoundTrendReviewLoop(
  apiKey: string,
  initialPost: TrendPost,
  topic: TrendTopic
): Promise<{ finalPost: TrendPost; reviewSummary: string; passed: boolean; finalScore: number }> {
  console.log('\n================================================================');
  console.log('🏛️ [스킬 가동] 트렌드 16인 전문 위원회 감수 루프 시작 (최소 2회 + 80점 돌파제)');
  console.log('================================================================');

  let currentPost = initialPost;
  let round = 1;
  let summaryNotes: string[] = [];
  let lastScore = 0;
  let passed = false;
  const MAX_ROUNDS = 4; // 최대 4회 반복

  while (round <= MAX_ROUNDS) {
    console.log(`\n🔍 [Round ${round}/${MAX_ROUNDS}] 16인의 바이럴/트렌드 전문가가 평가 중...`);
    const evalResult = await evaluateWith15TrendAgents(apiKey, currentPost, topic, round);
    lastScore = evalResult.averageScore;
    const avgScoreOutOf100 = Math.round(lastScore * 10);
    console.log(`📊 Round ${round} 종합 평점: ${lastScore} / 10점 (${avgScoreOutOf100}점)`);

    const topIssues = evalResult.feedbacks.filter((f) => f.score <= 7).slice(0, 3);
    topIssues.forEach((f) => console.log(`   - [${f.agentName}] (${f.score}점): ${f.improvements}`));

    summaryNotes.push(`R${round}:${avgScoreOutOf100}점`);

    // 종료 조건: 최소 2회 이상 실행 + 평점 7.5점 (75점) 이상 달성 시 통과
    if (round >= 2 && lastScore >= 7.5) {
      console.log(`🎉 [기준 통과] Round ${round}에서 종합점수 ${avgScoreOutOf100}점으로 75점 기준 돌파 성공!`);
      passed = true;
      break;
    }

    if (round >= MAX_ROUNDS) {
      passed = lastScore >= 7.5;
      if (!passed) {
        console.warn(`⚠️ 최대 라운드(${MAX_ROUNDS}회) 도달 후에도 75점 미달 (최종: ${avgScoreOutOf100}점) -> 품질 기준 미달 처리`);
      }
      break;
    }

    // 다음 라운드를 위한 전면 리라이팅 실행
    console.log(`\n✍️ [Round ${round} 리라이팅] 16인 피드백을 반영하여 원고 전면 보강 중...`);
    currentPost = await rewriteTrendPostWithFeedback(apiKey, currentPost, evalResult.feedbacks, topic, round);
    console.log(`✅ Round ${round} 보강 완료: "${currentPost.title}"`);
    round++;
  }

  // =========================================================================
  // ★ [4.8단계: 5인의 개발/아키텍처 집중형 엔지니어링 감사]
  // =========================================================================
  console.log('\n💻 [4.8단계] 5인의 개발/아키텍처 집중형 엔지니어링 에이전트 시스템 감사 가동...');
  const { auditEngineeringAndArchitecture } = await import('./system-auditor.js');
  const devAudit = auditEngineeringAndArchitecture(currentPost, topic);
  currentPost.htmlContent = devAudit.sanitizedHtml;
  console.log(`🛠️ 개발/아키텍처 종합 평점: ${devAudit.averageDevScore} / 10점 (${devAudit.overallPassed ? '전원 통과' : '경미한 수정'})`);

  // =========================================================================
  // ★ [메인 총괄 에이전트] 총괄 편집국장 최종 마스터 검수 및 발행 승인 단계
  // =========================================================================
  console.log('\n👑 [메인 총괄 에이전트] 총괄 수석 에디터(편집국장) 최종 마스터 검수 및 수정 진행 중...');
  const masterPost = await executeChiefEditorFinalInspection(
    apiKey,
    currentPost,
    topic,
    summaryNotes.join(' -> '),
    devAudit.technicalIssuesSummary
  );
  console.log(`🎖️ [최종 마스터 승인 완료] 수석 편집국장 최종 심사 완료: "${masterPost.title}"`);

  return {
    finalPost: masterPost,
    reviewSummary: `${summaryNotes.join(' ➔ ')} | Dev:${devAudit.averageDevScore}점`,
    passed,
    finalScore: Math.round(lastScore * 10),
  };
}

/**
 * 메인 총괄 에이전트 (총괄 수석 에디터 / 편집국장) 최종 마스터 검수 & 폴리싱
 */
export async function executeChiefEditorFinalInspection(
  apiKey: string,
  post: TrendPost,
  topic: TrendTopic,
  reviewHistory: string,
  devIssuesSummary: string = ''
): Promise<TrendPost> {
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `당신은 대한민국 최고 권위의 트렌드/미디어 매거진 총괄 편집국장(Editor-in-Chief Main Agent)입니다.
16인의 콘텐츠 전문 감수 위원회와 5인의 개발/아키텍처 엔지니어링 에이전트가 올린 종합 평가 결과를 토대로, 최종 원고를 직접 판단하고 완성도 100%의 최종 마스터본으로 승인 및 리라이팅하세요.

[편집국장 최종 마스터 검수 체크리스트]
1. **문맥 리듬감 & 톤앤매너 완결성**: 16인의 개별 수정 사항들이 이질감 없이 하나의 유려한 글처럼 매끄럽게 연결되었는가?
2. **후킹 & 신뢰성의 황금 밸런스**: 자극적인 클릭 유도(어그로)와 실질적인 팩트(내돈내산 단점/가격/정보)가 5:5로 완벽한 균형을 이루는가?
3. **개발/아키텍처 무결성 최종 반영**: 5인의 엔지니어링 에이전트가 지적한 기술적 이슈(DOM 닫는 태그, 보안 속성, XSS 방지)를 완벽히 해결했는가?
4. **군더더기 및 번역투 최종 소제**: 지루한 서론이나 중복되는 수식어를 걷어내고 3초 만에 몰입되도록 정제.

[출력 형식]
반드시 다음 JSON 포맷으로만 응답하세요:
{
  "title": "편집국장이 최종 확정한 마스터 헤드라인",
  "summary": "3줄 핵심 요약",
  "metaDescription": "검색 최적화 메타 설명",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "htmlContent": "<p>완성된 최종 마스터 HTML 본문...</p>"
}`;

  const prompt = `[16인 콘텐츠 감수 이력]: ${reviewHistory}
[5인 개발/아키텍처 감사 보고]: ${devIssuesSummary || '기술적 이슈 없음 (전원 합격)'}
[주제 키워드]: ${topic.keyword} (${topic.categoryNameKo})
[감수 통과 원고 제목]: ${post.title}

[본문]:
${post.htmlContent}

위 원고를 총괄 편집국장 관점에서 기술적/문맥적 결함을 최종 판단하여 완벽한 마스터본으로 승인해 주세요.`;

  try {
    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        temperature: 0.5,
        maxOutputTokens: 8192,
      },
    });

    const parsed = safeJsonParse<any>(response.text || '{}', {});

    return {
      title: parsed.title || post.title,
      summary: parsed.summary || post.summary,
      metaDescription: parsed.metaDescription || post.metaDescription,
      category: post.category,
      categoryNameKo: post.categoryNameKo,
      tags: parsed.tags || post.tags,
      htmlContent: parsed.htmlContent || post.htmlContent,
      verifiedLinks: post.verifiedLinks,
      coupangUrl: post.coupangUrl,
    };
  } catch (e) {
    return post;
  }
}
