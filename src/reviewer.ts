import { GoogleGenAI } from '@google/genai';
import { TrendPost, AgentFeedback, TrendTopic } from './types.js';
import {
  generateContentWithFallback,
  safeJsonParse,
  extractCleanTrendPostFromRawText,
} from './model-resolver.js';

/**
 * ★ 2호점 트렌드/웹진 18인 전문 감수 위원회 (역할 완전 독립 · 정량 감점제)
 *
 * [위원회 공통 헌장]
 * - 각 위원은 오직 자신의 `scope`(전담 영역)만 채점한다. `forbidden`(타 위원 관할)은 절대 언급/채점하지 않는다.
 * - 채점은 10점 만점에서 시작하는 절대 감점제: `penalties`의 각 항목을 위반할 때마다 명시된 점수를 깎는다 (최저 1점).
 * - improvements(보완 지침)는 반드시 "어느 섹션에 · 무엇을 · 어떻게" 형식의 실행 가능한 지시 1~2개로 제한한다.
 */
export const TREND_REVIEWER_AGENTS = [
  {
    id: 'ctr_headline',
    name: 'CTR 후킹 헤드라인 마스터',
    role: '제목 한 줄의 클릭 유발력만 검증하는 헤드라인 전담 위원',
    scope: '오직 "제목"만: 호기심 장치, 구체 키워드/숫자, 본문과의 일치, 브랜드/밈 표기 정확성',
    forbidden: '본문 구성, SEO 태그(검색 SEO 위원 관할), 링크는 절대 채점 금지',
    penalties: [
      '제목에 숫자 또는 구체 키워드(가격/장소명/상품명)가 없으면 -3점',
      '궁금증 유발 장치(반전·의문·경고형)가 전혀 없는 평서문 제목이면 -3점',
      '제목이 약속한 내용이 본문에 없는 낚시성이면 -4점',
      '브랜드명/밈 명칭 오탈자 1건당 -4점',
    ],
  },
  {
    id: 'landing_fact',
    name: '실시간 랜딩 & 링크 팩트체커',
    role: '본문 링크가 사전 검증된 URL과 일치하고 실제 작동하는지만 검증하는 링크 무결성 전담 위원',
    scope: '오직 "링크 실작동"만: 사전 검증 링크 목록과의 대조, 링크 텍스트-랜딩 일치성, 지도 링크',
    forbidden: '링크의 공식/비공식 여부(오피셜 최적화관 관할), 카피 문구(CTA 위원 관할)는 절대 채점 금지',
    penalties: [
      '사전 검증 목록에 없는 임의 창작 URL 인용 1건당 -4점',
      '링크 앵커 텍스트와 실제 랜딩 페이지 성격이 불일치하면 1건당 -3점',
      '오프라인 장소 글인데 네이버 지도 검색 링크가 없으면 -3점',
    ],
  },
  {
    id: 'honest_reviewer',
    name: '내돈내산 솔직 리뷰어',
    role: '치명적 단점·호불호·비추천 대상의 존재만 검증하는 솔직함 전담 위원',
    scope: '오직 "단점/호불호 콘텐츠"만: 실사용자 관점의 구체적 단점, 호불호 갈리는 지점, 비추천 대상',
    forbidden: '광고 톤 여부(악취 필터링관 관할), 가격 분석(가성비 헌터 관할)은 절대 채점 금지',
    penalties: [
      '치명적 단점/아쉬운 점 문단이 아예 없으면 -6점',
      '단점이 형식적·면피성("가격이 조금 있는 편")이면 -3점',
      '"이런 사람에겐 비추천" 대상 명시가 없으면 -2점',
    ],
  },
  {
    id: 'hotplace_planner',
    name: '핫플 웨이팅 & 동선 플래너',
    role: '방문 실전 정보(주소·가격표·웨이팅·주차)의 완결성만 검증하는 오프라인 동선 전담 위원',
    scope: '오직 "방문 실전 정보"만: 도로명 주소, 영업시간, 메뉴/가격표, 웨이팅 회피 시간대, 주차 팁',
    forbidden: '지도 링크의 작동 여부(랜딩 팩트체커 관할), 문단 레이아웃(UX 위원 관할)은 절대 채점 금지. 비장소성 주제(쇼핑/밈)는 실전 정보 관점만 가볍게 평가(기본 8점 이상)',
    penalties: [
      '(핫플/장소 주제) 도로명 주소가 없으면 -4점',
      '(핫플/장소 주제) 대표 메뉴 가격표(Table)가 없으면 -5점',
      '(핫플/장소 주제) 웨이팅 회피 시간대 또는 주차 팁이 없으면 -3점',
      '(핫플/장소 주제) 영업시간이 없으면 -2점',
    ],
  },
  {
    id: 'cta_copywriter',
    name: '구매 전환(CTA) 카피라이터',
    role: 'CTA 버튼 카피의 전환 유발력만 검증하는 전환 카피 전담 위원',
    scope: '오직 "CTA 카피"만: 버튼 문구의 구체성, 클릭 동기 부여, 배치 위치의 자연스러움',
    forbidden: '공정위 고지 문구(컴플라이언스 관할), 가격 팩트(가성비 헌터 관할)는 절대 채점 금지',
    penalties: [
      '(쇼핑 주제) 쿠팡 CTA 배너가 없으면 -4점',
      'CTA 문구가 일반적("바로가기", "확인하기")이고 혜택/긴급성이 없으면 -2점',
      'CTA가 맥락 없이 뜬금없는 위치에 배치되면 -2점',
    ],
  },
  {
    id: 'meme_supervisor',
    name: '밈 유래 & Z세대 트렌드 감수관',
    role: '밈의 원본 출처·정확한 뜻·신조어 용법만 검증하는 밈 정확성 전담 위원',
    scope: '오직 "밈/신조어 정확성"만: 원본 출처, 유래의 사실성, 뜻과 사용 맥락, 신조어 용법',
    forbidden: '영상 임베드(미디어 디렉터 관할), 제목의 후킹(헤드라인 마스터 관할)은 절대 채점 금지',
    penalties: [
      '(밈/이슈 주제) 밈의 원본 출처(최초 게시처/영상) 기재가 없으면 -4점',
      '유래를 추측성으로 서술하거나 왜곡하면 -4점',
      '신조어 오용/어색한 사용 1건당 -2점',
    ],
  },
  {
    id: 'mobile_ux',
    name: '3초 숏폼 모바일 UI/UX 디자이너',
    role: '한 손 스크롤 기준 문단·요약 박스·표 레이아웃만 검증하는 모바일 레이아웃 전담 위원',
    scope: '오직 "레이아웃"만: 문단 길이(2~3문장), 3줄 요약 박스, 표의 모바일 처리, 강조 리듬',
    forbidden: '콘텐츠의 사실성, 링크, SEO는 절대 채점 금지',
    penalties: [
      '4문장 이상 이어지는 긴 문단이 1개라도 존재하면 -6점',
      '도입부 3줄 핵심 요약 콜아웃 박스가 없으면 -3점',
      '표가 overflow-x 스크롤 처리 없이 배치되면 -2점',
      '<strong> 강조가 전혀 없는 섹션이 있으면 -1점',
    ],
  },
  {
    id: 'search_seo',
    name: '네이버/구글 검색 SEO 엔지니어',
    role: '검색 키워드 구조와 태그 설계만 검증하는 검색 노출 전담 위원',
    scope: '오직 "검색 구조"만: 제목/h2의 키워드 배치, 태그 구성, 검색 질문형 소제목',
    forbidden: '제목의 후킹력(헤드라인 마스터 관할), FAQ 내용(FAQ 설계관 관할)은 절대 채점 금지',
    penalties: [
      '제목과 h2 소제목에 핵심 검색 키워드가 없으면 -3점',
      '태그가 5개 미만이거나 서로 중복/유사하면 -2점',
      '독자가 검색창에 쳐볼 법한 질문형 소제목이 0개면 -2점',
    ],
  },
  {
    id: 'price_hunter',
    name: '가성비 & 최저가 헌터',
    role: '가격 팩트와 혜택 정보의 구체성만 검증하는 가격 전담 위원',
    scope: '오직 "가격/혜택"만: 구체 금액, 정가 대비 비교 기준, 할인/최저가 팁',
    forbidden: 'CTA 카피(카피라이터 관할), 단점 분석(솔직 리뷰어 관할)은 절대 채점 금지',
    penalties: [
      '본문에 구체 금액(원 단위)이 0건이면 -4점',
      '가격이 있어도 비교 기준(정가/경쟁 제품/1인당)이 없으면 -3점',
      '할인 수단/최저가 구매 팁이 전혀 없으면 -2점',
    ],
  },
  {
    id: 'link_visual',
    name: '더미 제거 & 미디어 무결성 감수관',
    role: '더미 플레이스홀더와 빈 껍데기 요소의 잔존만 검증하는 클린 레이아웃 전담 위원',
    scope: '오직 "더미/껍데기 잔존물"만: [이미지: ...] 텍스트, 빈 박스, 깨진 임베드 마크업',
    forbidden: '영상 임베드의 위치/맥락(미디어 디렉터 관할), 문단 구성(UX 위원 관할)은 절대 채점 금지',
    penalties: [
      '[이미지: ...], [사진 영역] 등 더미 텍스트가 1개라도 존재하면 즉시 1점 처리',
      '내용 없는 빈 박스/껍데기 div가 있으면 -4점',
      '마크업이 깨진 임베드 코드가 있으면 -3점',
    ],
  },
  {
    id: 'shorts_media_director',
    name: '쇼츠/릴스 미디어 디렉터',
    role: '유튜브 영상 임베드의 위치 및 반응형 처리만 검증하는 영상 미디어 전담 위원',
    scope: '오직 "영상 임베드 레이아웃"만: 영상 주제 시 임베드 배치, 반응형 래퍼 준수 여부. (비영상/장소/쇼핑 주제는 기본 8~10점 부여)',
    forbidden: '임베드 외 링크(랜딩 팩트체커 관할), 더미 텍스트(더미 감수관 관할)는 절대 채점 금지',
    penalties: [
      '(영상/쇼츠 중심 주제일 때) 유튜브/쇼츠 임베드가 전혀 없으면 -4점',
      '임베드가 본문 맥락과 무관한 위치에 뜬금없이 배치되면 -2점',
      '임베드에 반응형(16:9 패딩) 래퍼가 없으면 -2점',
    ],
  },
  {
    id: 'sponsor_odor_filter',
    name: '뒷광고/협찬 악취 필터링관',
    role: '광고성 찬양 톤과 근거 없는 최상급 표현만 적발하는 중립성 전담 위원',
    scope: '오직 "광고 냄새(톤)"만: 일방적 찬양 톤, 근거 없는 최상급 표현, 홍보 상투구',
    forbidden: '단점 문단의 존재 여부(솔직 리뷰어 관할), 공정위 문구(컴플라이언스 관할)는 절대 채점 금지',
    penalties: [
      '글 전체가 일방적 찬양 톤이면 -4점',
      '근거 없는 최상급 표현("인생템", "무조건 사세요") 1건당 -2점',
      '보도자료식 홍보 상투구("~로 유명한", "핫한 감성")가 3회 이상이면 -2점',
    ],
  },
  {
    id: 'faq_schema_architect',
    name: 'FAQ 리치 스니펫 설계관',
    role: 'FAQ 3선의 존재·검색어형 질문·팩트 답변만 검증하는 Q&A 구조 전담 위원',
    scope: '오직 "FAQ 섹션"만: 3문 3답 존재, 질문의 검색어 적합성, 답변의 팩트 밀도',
    forbidden: '소제목 키워드(SEO 엔지니어 관할), 본문 구성은 절대 채점 금지',
    penalties: [
      'FAQ 3선(Q&A 3세트)이 없으면 -5점',
      '질문이 실제 검색어형이 아니면(예: "어떤가요?" 수준) -2점',
      '답변에 구체 팩트(수치/날짜/장소)가 없으면 -2점',
    ],
  },
  {
    id: 'dwell_time_booster',
    name: '체류시간(Dwell Time) 부스터',
    role: '이탈 방지 구조(도입 후킹·브릿지·결말 보상)만 검증하는 정독 유도 전담 위원',
    scope: '오직 "이탈 방지 구조"만: 도입 3문장 내 후킹, 섹션 간 브릿지 문장, 결말의 보상(꿀팁/요약)',
    forbidden: '제목(헤드라인 마스터 관할), 문단 길이(UX 위원 관할)는 절대 채점 금지',
    penalties: [
      '도입 3문장 안에 끝까지 읽을 이유(후킹 예고)가 없으면 -3점',
      '섹션 간 다음 내용을 궁금하게 만드는 브릿지 문장이 없으면 -2점',
      '결말에 독자 보상(핵심 꿀팁 정리/한 줄 결론)이 없으면 -2점',
    ],
  },
  {
    id: 'compliance_guardian',
    name: '공정위 & 정보 신뢰성 감시관',
    role: '표시광고법 고지 문구와 과장 광고 표현만 검증하는 법적 컴플라이언스 전담 위원',
    scope: '오직 "법적 고지/과장 금지"만: 쿠팡 파트너스 고지 문구, 효능·수익 보장성 표현',
    forbidden: '광고 톤 자체(악취 필터링관 관할), CTA 카피(카피라이터 관할)는 절대 채점 금지',
    penalties: [
      '제휴(쿠팡) 링크가 있는데 공정위 파트너스 고지 문구가 없으면 -6점',
      '효능/효과를 확정적으로 보장하는 표현 1건당 -3점',
      '수익/할인율을 확정 보장하는 문구가 있으면 -4점',
    ],
  },
  {
    id: 'single_link_precision',
    name: '단일 고정밀 링크 적합성 검증관',
    role: '본문에 주제와 100% 일치하는 단 1개의 공식/대표 링크만 정밀하게 배치되었는지 검증하는 링크 순도 전담 위원',
    scope: '오직 "단일 링크 정밀도와 남발 방지"만: 공식/대표 카드의 단 1개 존재 여부, 무분별한 네이버/유튜브/SNS 링크 남발 차단 (단, 쇼핑 쿠팡 CTA 배너 및 핫플 네이버 지도 링크는 표준 컴포넌트로 예외 인정)',
    forbidden: '링크의 정상 작동 여부(랜딩 팩트체커 관할), CTA 카피는 절대 채점 금지',
    penalties: [
      '본문 내 불필요하거나 의미 없는 일반 검색/SNS 링크가 1개라도 남발되면 -5점',
      '주제와 100% 직결되는 핵심 공식/대표 링크가 아니면 -4점',
      '승인된 표준 컴포넌트(공식 카드 1개 + 쇼핑 시 쿠팡 CTA 1개, 핫플 시 지도 링크 1개) 외에 링크가 산만하게 남발되면 -3점',
    ],
  },
  {
    id: 'fact_verifiability',
    name: '객관적 사실 & 검증가능성 감사관',
    role: '출처 없는 뇌피셜, 주관적 과장, 과학적/통계적으로 입증할 수 없는 허위·과장 서술만 적발하는 사실 무결성 전담 위원',
    scope: '오직 "객관적 검증 가능성"만: 공식 발표로 증명 불가능한 뇌피셜, 주관적 단정, 근거 없는 수치/효능 추정',
    forbidden: '단점 분석(솔직 리뷰어 관할), 밈 유래 사실성(밈 감수관 관할)은 절대 채점 금지',
    penalties: [
      '객관적으로 입증되지 않은 주관적 단정이나 뇌피셜 1건당 -4점',
      '공식 출처가 없는 통계나 근거 없는 인과관계 서술 1건당 -3점',
      '"무조건 대박", "100% 인생템" 등 비과학적/비검증 과장 표현 1건당 -3점',
    ],
  },
  {
    id: 'legal_compliance',
    name: '법적 리스크 & 컴플라이언스 변호인',
    role: '명예훼손, 저작권, 허위사실 유포, 공정위 표시광고법 위반 요소만 검증하는 법률 전담 위원',
    scope: '오직 "법적 컴플라이언스"만: 특정인/매장 비방(명예훼손), 공정위 대가성 고지 누락, 부당 비교 광고',
    forbidden: '단점 분석 자체(솔직 리뷰어 관할), 광고 톤(악취 필터링관 관할)은 절대 채점 금지',
    penalties: [
      '특정 개인이나 매장/브랜드에 대한 근거 없는 비방/명예훼손 소지 표현 1건당 -5점',
      '공정위 대가성 고지 문구 누락 또는 부당 비교 광고 1건당 -4점',
      '의료/건강/효능 관련 무면허 확정 단정 서술 1건당 -4점',
    ],
  },
];

function sanitizeScore(score: any, fallback = 7): number {
  const num = typeof score === 'number' && Number.isFinite(score) ? score : Number(score);
  return Number.isFinite(num) ? Math.max(1, Math.min(10, num)) : fallback;
}

/**
 * 18인 트렌드 전문가 에이전트 종합 채점
 * - 각 위원은 자신의 전담 영역만, 절대 감점제로 채점한다.
 */
export async function evaluateWith18TrendAgents(
  apiKey: string,
  post: TrendPost,
  topic: TrendTopic,
  round: number
): Promise<{ feedbacks: AgentFeedback[]; averageScore: number; passed: boolean }> {
  const ai = new GoogleGenAI({ apiKey });

  const agentDescriptions = TREND_REVIEWER_AGENTS.map(
    (a, i) =>
      `${i + 1}. [${a.name}]
   - 전담 영역(이것만 채점): ${a.scope}
   - 채점 금지 영역: ${a.forbidden}
   - 정량 감점 규칙(10점 시작, 위반 시 감점, 최저 1점):
${a.penalties.map((p) => `     · ${p}`).join('\n')}`
  ).join('\n\n');

  const verifiedLinksList = (post.verifiedLinks || [])
    .map((v) => `- ${v.originalUrl} (${v.pageTitle} / ${v.isHealthy ? '정상' : '에러'})`)
    .join('\n');

  const prompt = `당신은 대한민국 최고의 트렌드/미디어 바이럴 18인 감수 위원회 시뮬레이터입니다.
아래 트렌드 원고(Round ${round} 버전)를 18인 각자의 관점에서 **독립적으로** 채점하세요.

[위원회 공통 헌장 — 절대 준수]
1. 각 위원은 자신의 "전담 영역"만 채점하고, "채점 금지 영역"은 절대 언급하지 않는다. (역할 중복 채점 = 무효)
2. 채점은 10점에서 시작하는 절대 감점제: 아래 각 위원의 "정량 감점 규칙"을 기계적으로 적용하고, improvements에 어떤 규칙으로 몇 점을 감점했는지 명시한다. 최저 점수는 1점.
3. 주제 카테고리(${topic.category})와 무관한 조건부 규칙("(핫플 주제)", "(쇼핑 주제)" 등)은 적용하지 않고, 해당 위원은 일반 관점에서 8점 이상을 기본 부여한다.
4. improvements는 "어느 섹션에 · 무엇을 · 어떻게"가 담긴 실행 가능한 지시 최대 2개로 작성한다. 모호한 지시("보강 필요") 금지.
5. 감점 사유가 전혀 없으면 9~10점을 부여하고 improvements에 "감점 없음 - 현행 유지"라고 쓴다.

[18인의 트렌드 전문가 페르소나 및 감점 규칙]
${agentDescriptions}

[평가 대상 원고]
주제: ${topic.keyword} (${topic.categoryNameKo} / ${topic.category})
제목: ${post.title}
3줄 요약: ${post.summary}
본문(HTML):
${post.htmlContent}

[사전 검증된 링크 목록 (랜딩 팩트체커 대조용 — 이 목록 밖의 URL은 임의 창작 의심)]
${verifiedLinksList || '검증 링크 없음'}

반드시 다음 JSON 배열 포맷으로만 응답하세요 (agentName은 위 페르소나 이름과 정확히 일치):
[
  {
    "agentName": "전문가 이름",
    "role": "전담 영역 한 줄",
    "score": 8,
    "strengths": "전담 영역 안에서 잘된 점 (1문장)",
    "improvements": "[적용 감점 규칙과 점수] + 어느 섹션에 무엇을 어떻게 고칠지 실행 지시 (최대 2개)"
  }, ... (총 18개, 배열 순서는 페르소나 순서와 동일)
]`;

  try {
    const response = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });
    const parsed = safeJsonParse<AgentFeedback[]>(response.text || '[]', []);
    const rawFeedbacks = parsed.length > 0 ? parsed : TREND_REVIEWER_AGENTS.map((a) => ({
      agentName: a.name,
      role: a.role,
      score: 7,
      strengths: '기본적인 트렌드 맥락 포착',
      improvements: '솔직한 단점 분석 및 모바일 요약 박스 보강 필요',
    }));

    const validFeedbacks = rawFeedbacks.map((f) => ({
      ...f,
      score: sanitizeScore(f.score, 7),
    }));

    const totalScore = validFeedbacks.reduce((acc, f) => acc + f.score, 0);
    const averageScore = Number((totalScore / Math.max(1, validFeedbacks.length)).toFixed(1));
    const passed = averageScore >= 7.5; // 75점 이상 기준

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

export const evaluateWith15TrendAgents = evaluateWith18TrendAgents;

/**
 * 18인의 피드백을 수용하여 원고 전면 리라이팅
 * - 감점 위원(낮은 점수) 지시 우선 반영 + 충돌 조정 규칙 내장
 */
export async function rewriteTrendPostWithFeedback(
  apiKey: string,
  currentPost: TrendPost,
  feedbacks: AgentFeedback[],
  topic: TrendTopic,
  round: number
): Promise<TrendPost> {
  const ai = new GoogleGenAI({ apiKey });

  const sorted = [...feedbacks].sort((a, b) => sanitizeScore(a.score, 10) - sanitizeScore(b.score, 10));
  const critical = sorted.filter((f) => sanitizeScore(f.score, 10) <= 7);
  const passedNotes = sorted.filter((f) => sanitizeScore(f.score, 10) >= 8);

  const criticalSummary = critical
    .map(
      (f, i) =>
        `[우선순위 ${i + 1} | ${f.agentName} | ${f.score}/10점]\n★ 필수 반영 지시: ${f.improvements}`
    )
    .join('\n\n');

  const keepSummary = passedNotes
    .map((f) => `- [${f.agentName}] 유지할 강점: ${f.strengths}`)
    .join('\n');

  const verifiedLinksList = (currentPost.verifiedLinks || [])
    .map((v) => `- ${v.originalUrl} (${v.pageTitle})`)
    .join('\n');

  const systemInstruction = `당신은 대한민국 최고 수준의 수석 트렌드 에디터이자 바이럴 콘텐츠 디렉터입니다.
18인 감수 위원회의 피드백(Round ${round})을 반영하여 기존 원고를 전면 리라이팅하세요.

[피드백 반영 우선순위 및 충돌 조정 규칙 — 절대 준수]
1. **감점 지시 100% 우선 반영**: "필수 반영 지시" 목록은 우선순위(낮은 점수) 순이다. 위에서부터 하나도 빠짐없이 본문에 반영한다.
2. **🚫 AI 상투적 자기소개 및 뇌피셜 배제**: "안녕하세요", "에디터입니다", "오늘은 ~에 대해 알아보겠습니다" 등 인위적 AI 도입부 전면 삭제하고 곧바로 본론 팩트로 시작한다. 객관적으로 입증 불가능한 뇌피셜은 전면 삭제/정정한다.
3. **🔗 단일 공식/대표 링크 원칙**: 본문 전체에서 링크는 단 1개의 공식/대표 카드만 유지하고, 불필요한 네이버/유튜브/SNS 링크는 전면 삭제한다. (단, 쇼핑 카테고리의 쿠팡 파트너스 CTA 및 핫플 네이버 지도 링크는 표준 컴포넌트로 예외 인정)
4. **🛡️ 법적 컴플라이언스 준수**: 특정인/매장 비방(명예훼손)을 절대 금지하며, 쇼핑 주제 시 공정위 대가성 고지를 명확히 유지한다.
5. **충돌 시 서열**: ① 팩트/단일 링크/법적 고지 문구 정정 > ② 필수 구성 요소 추가(단점 문단·FAQ·가격표·공식 카드) > ③ 구조/레이아웃 > ④ 제목/카피 표현.
6. **강점 보존**: 8점 이상 위원이 칭찬한 요소는 삭제/훼손하지 말고 유지한다.
7. **필수 골격 불변**: 3줄 요약 박스, 🏛️ 공식 오피셜 직통 카드(단 1개), 내돈내산 단점 문단, FAQ 3선, (쇼핑 주제) 쿠팡 CTA + 공정위 고지 문구는 반드시 생성/보존한다.
8. **링크 창작 금지**: 아래 "사전 검증 링크 목록"에 있는 URL만 사용한다. 새 URL을 임의로 만들지 않는다.
9. **모바일 최적화**: 모든 문단 2~3문장, 핵심 단어 <strong>, 표는 overflow-x 스크롤 래퍼.
10. 🚫 [이미지: ...], [사진 영역] 등 어떠한 플레이스홀더도 절대 작성 금지.

[출력 형식]
반드시 다음 JSON 포맷으로만 응답하세요:
{
  "title": "18인 피드백을 반영해 더욱 매력적으로 개선된 후킹 제목",
  "summary": "3줄 핵심 요약",
  "metaDescription": "검색 최적화 메타 디스크립션",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "htmlContent": "<p>완성된 고품질 반응형 HTML 본문...</p>"
}`;

  const prompt = `[현재 원고 제목]: ${currentPost.title}
[카테고리]: ${topic.keyword} (${topic.categoryNameKo})

[사전 검증 링크 목록 (이 URL만 사용 가능)]:
${verifiedLinksList || '기본 검색 링크만 사용'}

[★ 필수 반영 지시 — 우선순위 순 (하나도 누락 금지)]:
${criticalSummary || '치명 지적 없음 — 아래 강점을 유지하며 완성도만 다듬을 것'}

[유지해야 할 강점]:
${keepSummary || '없음'}

[기존 본문]:
${currentPost.htmlContent}

위 지시를 우선순위 순으로 전부 반영하여 종합 75점(7.5점) 이상을 달성할 최종 원고로 리라이팅해 주세요.`;

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

    const responseText = response.text || '';
    return extractCleanTrendPostFromRawText(
      responseText,
      currentPost.title,
      currentPost.category,
      currentPost.categoryNameKo,
      currentPost.tags,
      currentPost.verifiedLinks,
      currentPost.coupangUrl
    );
  } catch (err) {
    return currentPost;
  }
}

/**
 * 최소 2회 이상 + 종합점수 75점(7.5점) 돌파할 때까지 반복하는 전문가 감수 루프
 * (최대 4회 시도 후에도 75점 미달 시 passed = false 반환)
 */
export async function executeIterativeTrendReviewLoop(
  apiKey: string,
  initialPost: TrendPost,
  topic: TrendTopic
): Promise<{ finalPost: TrendPost; reviewSummary: string; passed: boolean; finalScore: number }> {
  console.log('\n================================================================');
  console.log('🏛️ [2호점 트렌드 18인 감수 엔진 가동] 최소 2회 + 75점(7.5/10) 돌파제 루프 시작');
  console.log('================================================================');

  let currentPost = initialPost;
  let round = 1;
  let summaryNotes: string[] = [];
  let lastScore = 0;
  let passed = false;
  const MAX_ROUNDS = 4; // 최대 4회 반복

  while (round <= MAX_ROUNDS) {
    console.log(`\n🔍 [Round ${round}/${MAX_ROUNDS}] 18인의 바이럴/트렌드/법률 전문가가 평가 중...`);
    const evalResult = await evaluateWith18TrendAgents(apiKey, currentPost, topic, round);
    lastScore = evalResult.averageScore;
    const avgScoreOutOf100 = Math.round(lastScore * 10);
    console.log(`📊 Round ${round} 종합 평점: ${lastScore} / 10점 (${avgScoreOutOf100}점)`);

    const topIssues = evalResult.feedbacks.filter((f) => sanitizeScore(f.score, 10) <= 7).slice(0, 3);
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
    console.log(`\n✍️ [Round ${round} 리라이팅] 18인 피드백을 반영하여 원고 전면 보강 중...`);
    currentPost = await rewriteTrendPostWithFeedback(apiKey, currentPost, evalResult.feedbacks, topic, round);
    console.log(`✅ Round ${round} 보강 완료: "${currentPost.title}"`);
    round++;
  }

  // =========================================================================
  // ★ [4.8단계: 메인 총괄 에이전트] 총괄 편집국장 최종 마스터 검수 및 폴리싱 단계
  // =========================================================================
  console.log('\n👑 [메인 총괄 에이전트] 총괄 수석 에디터(편집국장) 최종 마스터 검수 및 폴리싱 진행 중...');
  const masterPost = await executeChiefEditorFinalInspection(
    apiKey,
    currentPost,
    topic,
    summaryNotes.join(' ➔ ')
  );
  console.log(`🎖️ [최종 마스터 승인 완료] 수석 편집국장 최종 심사 완료: "${masterPost.title}"`);

  // =========================================================================
  // ★ [4.9단계: 5인 개발/아키텍처 최종 게이트키퍼 소독] (LLM 재작성 후 최종 무결성 보장)
  // =========================================================================
  console.log('\n💻 [4.9단계] 5인의 개발/아키텍처 집중형 엔지니어링 에이전트 최종 시스템 감사 가동...');
  const { auditEngineeringAndArchitecture } = await import('./system-auditor.js');
  const devAudit = auditEngineeringAndArchitecture(masterPost, topic);
  masterPost.htmlContent = devAudit.sanitizedHtml;
  console.log(`🛠️ 개발/아키텍처 최종 평점: ${devAudit.averageDevScore} / 10점 (${devAudit.overallPassed ? '전원 통과' : '경미한 자동 수정 완료'})`);

  return {
    finalPost: masterPost,
    reviewSummary: `${summaryNotes.join(' ➔ ')} | Dev:${devAudit.averageDevScore}점`,
    passed,
    finalScore: Math.round(lastScore * 10),
  };
}

export const executeTwoRoundTrendReviewLoop = executeIterativeTrendReviewLoop;

/**
 * 메인 총괄 에이전트 (총괄 수석 에디터 / 편집국장) 최종 마스터 검수 & 폴리싱
 * - 편집국장은 "새 내용 창작"이 아니라 "최종 승인 폴리싱"만 수행한다.
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
18인 콘텐츠 감수 위원회와 5인 엔지니어링 감사를 모두 통과한 원고에 대해 "최종 발행 승인 폴리싱"만 수행하세요.

[편집국장의 권한과 한계 — 절대 준수]
1. **폴리싱 전용**: 새 팩트/새 링크/새 가격을 창작하지 않는다. 이미 감수된 링크·가격·주소·고지 문구는 절대 변경 금지.
2. **🚫 AI 상투적 자기소개 완전 퇴출**: 도입부에 "안녕하세요", "감각적인 에디터입니다" 등 AI식 자기소개 잔재가 남아있다면 전면 삭제하고 자연스럽게 본론으로 시작하도록 다듬는다.
3. **🔗 단 1개의 공식/대표 링크만 유지**: 불필요하거나 의미 없는 일반 검색 링크는 전면 삭제하고, 오직 단 1개의 공식/대표 카드만 유지한다. (쇼핑 쿠팡 CTA 배너 및 핫플 지도 링크는 예외 보존)
4. **삭제 금지 골격**: 3줄 요약 박스, 🏛️ 공식 오피셜 직통 카드(단 1개), 내돈내산 단점 문단, FAQ 3선, 쿠팡 CTA + 공정위 고지 문구는 반드시 그대로 보존한다.
5. **허용 작업 (오직 이것만)**:
   - 문맥 리듬감 & 톤앤매너 통일: 18인의 개별 수정 사항이 이질감 없이 하나의 글로 읽히도록 연결부만 다듬기
   - 후킹(어그로)과 팩트의 5:5 밸런스 최종 점검: 과장된 표현은 낮추고 밋밋한 도입은 후킹 강화
   - 지루한 서론/중복 수식어/번역투 제거
   - 5인 엔지니어링 감사가 보고한 잔여 기술 이슈(닫는 태그, 보안 속성)의 최종 반영 확인
6. 🚫 플레이스홀더([이미지: ...]) 발견 시 해당 문구만 삭제한다.

[출력 형식]
반드시 다음 JSON 포맷으로만 응답하세요:
{
  "title": "편집국장이 최종 확정한 마스터 헤드라인",
  "summary": "3줄 핵심 요약",
  "metaDescription": "검색 최적화 메타 설명",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "htmlContent": "<p>완성된 최종 마스터 HTML 본문...</p>"
}`;

  const prompt = `[18인 콘텐츠 감수 이력]: ${reviewHistory}
[5인 개발/아키텍처 감사 보고]: ${devIssuesSummary || '기술적 이슈 없음 (전원 합격)'}
[주제 키워드]: ${topic.keyword} (${topic.categoryNameKo})
[감수 통과 원고 제목]: ${post.title}

[본문]:
${post.htmlContent}

위 원고를 편집국장 권한 범위(폴리싱 전용) 안에서 최종 마스터본으로 승인해 주세요.`;

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

    const responseText = response.text || '';
    return extractCleanTrendPostFromRawText(
      responseText,
      post.title,
      post.category,
      post.categoryNameKo,
      post.tags,
      post.verifiedLinks,
      post.coupangUrl
    );
  } catch (e) {
    return post;
  }
}
