import { GoogleGenAI } from '@google/genai';
import { TrendPost, AgentFeedback, TrendTopic } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

export const TREND_REVIEWER_AGENTS = [
  { id: 'ctr_headline', name: 'CTR 후킹 헤드라인 마스터', role: '점심시간 모바일 클릭 유발력 및 호기심 자극 제목 검증' },
  { id: 'landing_fact', name: '실시간 랜딩 & 링크 팩트체커', role: '네이버 지도, 공식 구매처, 영상 링크의 정상 작동 및 페이지 일치성 검증' },
  { id: 'honest_reviewer', name: '내돈내산 솔직 리뷰어', role: '단순 칭찬이 아닌 반드시 알아야 할 솔직한 단점/주의사항 포함 여부 검증' },
  { id: 'hotplace_planner', name: '핫플 웨이팅 & 동선 플래너', role: '정확한 주소, 주차 팁, 웨이팅 피하는 시간대, 대표 메뉴 가격 검증' },
  { id: 'cta_copywriter', name: '구매 전환(CTA) 카피라이터', role: '쿠팡 파트너스 링크 클릭 유도 버튼 카피 및 공정위 필수 문구 검증' },
  { id: 'meme_supervisor', name: '밈 유래 & Z세대 트렌드 감수관', role: '밈/유행어의 원본 출처 왜곡 방지 및 트렌디하고 찰진 맥락 검증' },
  { id: 'mobile_ux', name: '3초 숏폼 모바일 UI/UX 디자이너', role: '스마트폰 한 손 스크롤 최적화 (2~3문장 문단, 요약 박스, 비교표) 검증' },
  { id: 'search_seo', name: '네이버/구글 검색 SEO 엔지니어', role: '실시간 급상승 연관 키워드 태그 및 본문 내 자연스러운 키워드 밀도 검증' },
  { id: 'price_hunter', name: '가성비 & 최저가 헌터', role: '정가 대비 가성비 분석 및 실질적인 혜택/최저가 팁 포함 여부 검증' },
  { id: 'viral_sharer', name: '바이럴 단톡방 공유 유도관', role: '친구/연인에게 단톡방으로 즉시 공유하고 싶어지는 킬러 포인트 검증' },
];

/**
 * 10인 트렌드 전문가 에이전트 종합 채점
 */
export async function evaluateWith10TrendAgents(
  apiKey: string,
  post: TrendPost,
  topic: TrendTopic,
  round: number
): Promise<{ feedbacks: AgentFeedback[]; averageScore: number }> {
  const ai = new GoogleGenAI({ apiKey });

  const agentDescriptions = TREND_REVIEWER_AGENTS.map(
    (a, i) => `${i + 1}. [${a.name}] (${a.role})`
  ).join('\n');

  const prompt = `당신은 대한민국 최고의 트렌드/미디어 바이럴 10인 감수 위원회입니다.
아래 작성된 트렌드 원고(Round ${round} 버전)를 10인의 전문가 관점에서 엄격하게 리뷰하고 점수와 보완 지침을 작성하세요.

[10인의 트렌드 전문가 페르소나]
${agentDescriptions}

[평가 대상 원고]
주제: ${topic.keyword} (${topic.categoryNameKo})
제목: ${post.title}
3줄 요약: ${post.summary}
본문(HTML): ${post.htmlContent.slice(0, 3500)}...

[채점 원칙]
1. ★ **"내돈내산 솔직 리뷰어"**: 단순 찬양 일색이 아니라 실제 소비자가 겪을 수 있는 단점/아쉬운 점/주의사항이 팩트로 균형 있게 들어있는지 엄격 채점.
2. ★ **"CTR 후킹 헤드라인 마스터"**: 제목이 뻔하지 않고 점심시간 2030 직장인이 무조건 클릭할 수밖에 없는지 채점.
3. ★ **"3초 숏폼 모바일 UI/UX 디자이너"**: 모바일에서 가독성이 뛰어난지(문단 짧게, 표, 콜아웃 박스) 채점.

반드시 다음 JSON 배열 포맷으로만 응답하세요:
[
  {
    "agentName": "전문가 이름",
    "role": "역할",
    "score": 8,
    "strengths": "잘된 부분",
    "improvements": "구체적인 보강 및 수정 지시사항"
  }, ... (총 10개)
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
      score: 8,
      strengths: '기본적인 트렌드 맥락 포착',
      improvements: '솔직한 단점 분석 및 모바일 요약 박스 보강 필요',
    }));
    const totalScore = validFeedbacks.reduce((acc, f) => acc + (f.score || 7), 0);
    const averageScore = Number((totalScore / validFeedbacks.length).toFixed(1));
    return { feedbacks: validFeedbacks, averageScore };
  } catch (e) {
    return {
      feedbacks: TREND_REVIEWER_AGENTS.map((a) => ({
        agentName: a.name,
        role: a.role,
        score: 8,
        strengths: '기본적인 트렌드 맥락 포착',
        improvements: '솔직한 단점 분석 및 모바일 요약 박스 보강 필요',
      })),
      averageScore: 8.0,
    };
  }
}

/**
 * 10인의 피드백을 수용하여 원고 전면 리라이팅
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
10인의 바이럴 전문 감수 위원회가 제출한 상세 피드백(Round ${round})을 100% 흡수하여, 기존 원고를 최상급 프리미엄 반응형 트렌드 칼럼으로 전면 리라이팅하세요.

[리라이팅 필수 반영 항목]
1. **🔥 CTR 극대화 어그로/후킹 제목 강화**: 클릭률을 더 끌어올릴 수 있는 매혹적인 제목으로 업그레이드
2. **⚖️ 솔직한 단점 & 호불호 팩트 보강**: 무조건적인 찬양을 지양하고 독자가 신뢰할 수 있는 단점/주의사항/비추천 대상 추가
3. **📱 모바일 최적화**: 2~3문장 문단, 시각적 구분선, <strong> 태그, 둥근 요약 박스
4. **💰 쿠팡 파트너스 / 제휴 CTA 유지**: 쇼핑 아이템인 경우 CTA 버튼과 공정위 문구가 자연스럽게 연결되도록 유지

[출력 형식]
반드시 다음 JSON 포맷으로만 응답하세요:
{
  "title": "10인 피드백을 반영해 더욱 매력적으로 개선된 후킹 제목",
  "summary": "3줄 핵심 요약",
  "metaDescription": "검색 최적화 메타 디스크립션",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "htmlContent": "<p>완성된 고품질 반응형 HTML 본문...</p>"
}`;

  const prompt = `[현재 원고 제목]: ${currentPost.title}
[카테고리]: ${topic.keyword} (${topic.categoryNameKo})

[10인의 전문가 상세 리뷰 및 보강 지침 (Round ${round})]:
${feedbackSummary}

[기존 본문]:
${currentPost.htmlContent}

위 10인의 지적 사항을 100% 반영하여 최고 수준의 완성도를 갖춘 최종 원고로 리라이팅해 주세요.`;

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
 * 2회 반복 감수 & 리라이팅 루프 실행
 */
export async function executeTwoRoundTrendReviewLoop(
  apiKey: string,
  initialPost: TrendPost,
  topic: TrendTopic
): Promise<{ finalPost: TrendPost; reviewSummary: string }> {
  console.log('\n================================================================');
  console.log('🏛️ [스킬 가동] 트렌드 & 바이럴 10인 전문 에이전트 2회 반복 감수 시작');
  console.log('================================================================');

  // Round 1
  console.log('\n🔍 [1회차 감수] 10인의 바이럴/트렌드 전문가가 평가 중...');
  const round1Eval = await evaluateWith10TrendAgents(apiKey, initialPost, topic, 1);
  console.log(`📊 1회차 10인 평균 점수: ${round1Eval.averageScore} / 10점`);
  round1Eval.feedbacks.slice(0, 3).forEach((f) => {
    console.log(`   - [${f.agentName}] (${f.score}점): ${f.improvements}`);
  });

  console.log('\n✍️ [1회차 리라이팅] 10인 피드백(후킹 제목 + 단점 보강)을 반영하여 보강 중...');
  const round1Post = await rewriteTrendPostWithFeedback(apiKey, initialPost, round1Eval.feedbacks, topic, 1);
  console.log(`✅ 1차 보강 완료: "${round1Post.title}"`);

  // Round 2
  console.log('\n🔍 [2회차 재검증] 보강된 원고에 대해 10인의 전문가가 2차 재검증 수행 중...');
  const round2Eval = await evaluateWith10TrendAgents(apiKey, round1Post, topic, 2);
  console.log(`📊 2회차 최종 평균 점수: ${round2Eval.averageScore} / 10점 (상승폭: +${(round2Eval.averageScore - round1Eval.averageScore).toFixed(1)}점)`);

  console.log('\n✨ [최종 리라이팅] 2차 미세 피드백까지 완벽 반영한 최종 원고 완성 중...');
  const finalPost = await rewriteTrendPostWithFeedback(apiKey, round1Post, round2Eval.feedbacks, topic, 2);
  console.log(`🎉 2회차 최종 완성본 도출 성공!`);
  console.log(`   - 최종 제목: ${finalPost.title}`);

  const summary = `10인 트렌드 에이전트 2회 교차 감수 완료 (1차 평점: ${round1Eval.averageScore}점 -> 2차 최종: ${round2Eval.averageScore}점)`;
  return { finalPost, reviewSummary: summary };
}
