import { GoogleGenAI } from '@google/genai';
import { TrendTopic, TrendPost, VerifiedLink } from './types.js';
import {
  generateContentWithFallback,
  safeJsonParse,
  extractCleanTrendPostFromRawText,
} from './model-resolver.js';

export async function generateInitialTrendPost(
  apiKey: string,
  topic: TrendTopic,
  verifiedLinks: VerifiedLink[],
  coupangSearchUrl: string,
  coupangPartnersId: string = 'AF2968960'
): Promise<TrendPost> {
  const ai = new GoogleGenAI({ apiKey });

  // 가장 일치도가 높은 단 1개의 최우선 공식/대표 링크 선별
  const officialLink = verifiedLinks.find((v) => v.linkType === 'DIRECT_OFFICIAL') ||
    verifiedLinks.find((v) => v.isHealthy && (v.relevanceScore ?? 0) >= 75) ||
    verifiedLinks[0];

  const isDirectOfficial = officialLink?.linkType === 'DIRECT_OFFICIAL';
  const officialUrl = officialLink?.finalUrl || officialLink?.originalUrl || `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topic.keyword)}`;

  let officialSiteTitle = '';
  let officialCardDescription = '';
  let officialButtonText = '';

  if (topic.category === 'SHOPPING_ITEM') {
    if (isDirectOfficial) {
      officialSiteTitle = `🛒 [공식몰] ${topic.keyword} 바로가기`;
      officialCardDescription = '공식 직영몰에서 정품 인증 및 상세 스펙을 확인하세요.';
      officialButtonText = '공식몰 바로가기 &rarr;';
    } else {
      officialSiteTitle = `🔍 [최저가 검색] ${topic.keyword} 실시간 가격 비교`;
      officialCardDescription = '포털 실시간 최저가, 입고 현황 및 구매자 후기를 확인하세요.';
      officialButtonText = '최저가 비교하기 &rarr;';
    }
  } else if (topic.category === 'HOT_PLACE') {
    if (isDirectOfficial) {
      officialSiteTitle = `📍 [공식 안내] ${topic.keyword} 예약 & 상세 정보`;
      officialCardDescription = '공식 예약처, 팝업 일정 및 사전 등록 안내를 확인하세요.';
      officialButtonText = '장소 정보 확인 &rarr;';
    } else {
      officialSiteTitle = `🗺️ [지도 확인] ${topic.keyword} 위치 & 영업 정보`;
      officialCardDescription = '네이버 지도에서 정확한 도로명 주소, 영업시간 및 방문자 리뷰를 확인하세요.';
      officialButtonText = '지도에서 보기 &rarr;';
    }
  } else {
    // MEME_TREND, GENERAL, etc.
    if (isDirectOfficial) {
      officialSiteTitle = `📰 [공식 출처] ${topic.keyword} 원문 및 발표 자료`;
      officialCardDescription = '공식 발표 채널 및 원본 출처를 바로 확인하세요.';
      officialButtonText = '원문 확인 &rarr;';
    } else {
      officialSiteTitle = `⚡ [실시간 소식] ${topic.keyword} 최신 반응 & 이슈 정리`;
      officialCardDescription = '포털 실시간 관련 보도 및 대중 반응을 바로 확인하세요.';
      officialButtonText = '실시간 반응 보기 &rarr;';
    }
  }

  const verifiedLinksSummary = `[단일 대표 링크] 명칭: ${officialSiteTitle} | URL: ${officialUrl} | 성격: ${isDirectOfficial ? '공식 직통' : '포털 검색/지도'}`;

  const systemInstruction = `당신은 2030 트렌드 이슈를 빠르고 정확하게 분석하는 트렌드 전문 에디터입니다.
점심시간(12:00) 스마트폰을 켠 2030 직장인과 학생들이 호기심을 참지 못하고 클릭할 수밖에 없는 **키워드 중심 후킹 제목**과 **군더더기 없는 고품질 반응형 HTML 칼럼**을 작성하세요.
이 초안은 작성 직후 **18인 전문 감수 위원회의 절대 감점제 채점**을 받습니다. 아래 [감수단 사전 통과 체크리스트]의 항목이 하나라도 빠지면 해당 위원이 즉시 감점하므로, 초안 단계에서 전 항목을 반드시 포함하세요.

[★ 18인 감수단 사전 통과 체크리스트 — 누락 시 감점되는 필수 요소]
□ 🚫 AI 상투적 자기소개 배제 (첫 문장에 "안녕하세요", "가장 감각적인 에디터입니다" 등 등장 시 감점관 즉시 1점 처리)
□ 🔗 단 1개의 공식/대표 링크 카드 (무분별한 네이버/유튜브/SNS 링크 남발 시 단일 링크 검증관 -5점, 쇼핑 쿠팡 CTA 및 핫플 지도는 예외 인정)
□ ⚖️ 객관적으로 증명 가능한 팩트만 서술 (입증 불가능한 뇌피셜/미확인 루머 1건당 사실 감사관 -4점)
□ 🛡️ 법적 컴플라이언스 준수 (비방/명예훼손, 공정위 고지 누락 1건당 변호인 -5점)
□ 제목: 숫자/구체 키워드 + 궁금증 유발 장치 (없으면 헤드라인 마스터 각 -3점), 낚시 금지, 브랜드/밈 오탈자 1건당 -4점
□ 3줄 핵심 요약 콜아웃 박스 (누락 시 모바일 UX 위원 -3점)
□ 🏛️ 대표 바로가기 카드 (누락 시 랜딩 팩트체커 -4점)
□ 내돈내산 치명적 단점/호불호 문단 + "이런 사람에겐 비추천" 명시 (단점 문단 누락 시 솔직 리뷰어 -6점)
□ FAQ 3선 — 검색어형 질문 + 수치/날짜/장소가 담긴 팩트 답변 (누락 시 FAQ 설계관 -5점)
□ 모든 문단 2~3문장 (4문장 이상 문단 1개라도 존재 시 UX 위원 -6점)
□ 구체 금액(원 단위) + 비교 기준(정가/1인당) (금액 0건 시 가성비 헌터 -4점)
□ 핫플/장소 주제: 도로명 주소(-4점), 메뉴 가격표 Table(-5점), 웨이팅/주차 팁(-3점), 영업시간(-2점)
□ 밈 주제: 원본 출처 명시(-4점), 유래 추측/왜곡 서술 금지(-4점)
□ 쇼핑 주제: 쿠팡 CTA 배너(-4점) + 공정위 파트너스 고지 문구(누락 시 컴플라이언스 -6점)
□ 도입 3문장 내 끝까지 읽을 이유 예고 + 섹션 간 브릿지 문장 + 결말 꿀팁 보상 (체류시간 부스터 각 -2~3점)
□ ${isDirectOfficial ? '공식 직영몰/예약처가 확인되었으므로 "공식 사이트에서 확인하세요"라고 정확히 서술' : '공식 직영몰이 부재하여 검색/지도 링크로 대체되었으므로 "공식몰"이라는 허위 서술 금지, 사실에 맞게 서술'}
□ 근거 없는 최상급 표현("인생템", "무조건 사세요") 및 일방적 찬양 톤 금지 (악취 필터링관 감점)
□ [이미지: ...] 등 더미 텍스트 1개라도 존재 시 더미 감수관 즉시 1점 처리

[핵심 작성 원칙]
1. **🚫 AI 상투적 표현 및 인위적 자기소개 전면 금지**:
   - "대한민국에서 가장 감각적인 에디터입니다", "안녕하세요", "오늘은 화제의 ~에 대해 알아보겠습니다" 등 인위적인 AI 자기소개 전면 금지!
   - 1문장부터 문제의 핵심 후킹 포인트 및 생생한 현장 팩트로 군더더기 없이 자연스럽게 시작하세요.
2. **🔗 단 1개의 가장 일치하는 공식/대표 링크 원칙**:
   - 본문 전체에서 정보성 링크는 오직 사전 검증된 **단 1개의 공식/대표 바로가기 배너 카드**만 허용됩니다.
   - 의미 없는 일반 검색 링크(네이버, 유튜브, 인스타 등)를 본문 중간에 산만하게 마구 도배하는 행위는 엄격히 금지됩니다.
3. **⚖️ 객관적 사실 입증 & 법적 컴플라이언스 준수**:
   - 객관적으로 검증할 수 없는 뇌피셜, 허위 루머, 주관적 과장 표현을 전면 배제합니다.
   - 특정인/특정 매장에 대한 비방(명예훼손)을 절대 금지하며, 쇼핑 주제 시 공정위 대가성 고지를 명확히 기재하세요.
4. ★ **CTR 극대화 키워드 중심 후킹 제목**:
   - 클릭을 유발하는 강력한 호기심/의문형/경고형 후킹 기법 사용.
   - 밈/브랜드/상품명에 오탈자가 절대 없도록 정확한 표준 명칭을 사용하세요.
5. **모바일 3초 스크롤 가독성 (HTML 스타일)**:
   - 문단은 2~3문장 단위로 짧게 분리.
   - 핵심 단어는 <strong> 태그로 강조.
   - 도입부에 부드러운 파스텔톤의 3줄 핵심 요약 콜아웃 박스 필수 배치:
     <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px 18px; border-radius: 8px; margin-bottom: 24px; line-height: 1.7;">
       <strong style="color: #1e40af; font-size: 15px;">⚡ 3줄 핵심 요약</strong>
       <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 14.5px; color: #1e293b;">...</ul>
     </div>
6. **🏛️ 바로가기 배너 카드 (단 1개 필수 삽입)**:
   - 본문 상단에 독자가 바로 확인을 할 수 있는 카드를 단 1개 삽입하세요:
     <div class="trend-hero-banner" style="background: #f1f5f9; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin: 20px 0; display: flex; align-items: center; justify-content: space-between;">
       <div>
         <strong style="color: #0f172a; font-size: 14px;">${officialSiteTitle}</strong>
         <p style="margin: 3px 0 0 0; font-size: 12.5px; color: #64748b;">${officialCardDescription}</p>
       </div>
       <a href="${officialUrl}" target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" style="display: inline-block; background: #0f172a; color: #ffffff !important; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap;">${officialButtonText}</a>
     </div>
7. **★ 내돈내산 솔직 단점 & 아쉬운 점 (1문단 필수 작성)**:
   - 무조건적인 찬양글은 절대 금지! 실제 구매자/방문자의 솔직한 호불호, 웨이팅 고충, 아쉬운 가성비나 단점을 1문단 이상 명확히 분석하세요.
8. **카테고리별 특화 필수 구성**:
   - **HOT_PLACE (맛집/핫플)**: 도로명 주소, 영업시간, 주차 팁, 대표 메뉴 가격표(Table), 웨이팅 피하는 시간대, 솔직한 호불호 평가.
   - **SHOPPING_ITEM (바이럴 꿀템/쇼핑)**: 제품 스펙/가격표, 바이럴 이유, ★솔직한 단점 및 아쉬운 점, 강력 추천 대상 vs 비추천 대상, 모바일 쿠팡 파트너스 CTA 배너.
   - **MEME_TREND (화제의 밈/이슈)**: 밈의 원본 출처 및 유래, 정확한 뜻과 맥락, 상황별 찰진 사용 예시, 패러디 반응.
9. **구글 검색 1페이지 상단 노출용 FAQ 3문 3답**:
   - 본문 하단에 독자들이 검색창에 직접 쳐볼 법한 핵심 질문 3선(Q&A)을 반드시 배치하세요.
10. **🚫 절대 금지 항목 (엄격 준수)**:
   - 텍스트 형태의 '📸 [이미지: ...]', '사진 가이드', 회색 빈 박스 등 모든 종류의 이미지 플레이스홀더 작성 절대 금지!
   - '단톡방 공유용 카톡 템플릿' 같은 가짜 공유 박스 작성 절대 금지.
11. **쿠팡 파트너스 CTA 배너 (${topic.category === 'SHOPPING_ITEM' ? '필수 포함' : '해당시 포함'})**:
   - 쇼핑/아이템 연관 주제인 경우 본문 하단에 반드시 세련된 CTA 버튼과 공정위 필수 문구를 삽입하세요:
   \`<div style="margin: 32px 0; padding: 24px; background: #fff5f5; border-radius: 12px; border: 1px solid #ffd8d8; text-align: center;"><a href="${coupangSearchUrl}" target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" style="display: inline-block; padding: 14px 28px; background: #e60012; color: #ffffff !important; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(230,0,18,0.25);">🔥 [${topic.keyword}] 최저가 & 실시간 재고 확인하기 &rarr;</a><p style="font-size: 11px; color: #888888; margin-top: 12px; margin-bottom: 0;">이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다. (추천인: ${coupangPartnersId})</p></div>\`

[출력 형식]
반드시 다음 JSON 포맷으로만 응답하세요:
{
  "title": "키워드 중심 후킹 어그로 제목",
  "summary": "3줄 핵심 요약",
  "metaDescription": "검색 최적화 메타 설명",
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"],
  "htmlContent": "<p>완성된 고품질 반응형 HTML 본문...</p>"
}`;

  const prompt = `[선정된 실시간 트렌드 주제]
- 키워드: ${topic.keyword}
- 카테고리: ${topic.category} (${topic.categoryNameKo})
- 후킹 포인트: ${topic.headlineHook}
- 트렌드 소스: ${topic.sources.join(', ')}

[사전 검증된 웹 링크 및 랜딩 상태]
${verifiedLinksSummary || '기본 트렌드 검색 결과 반영'}

위 정보를 바탕으로 독자가 끝까지 정독하고 공유하고 싶어지는 최고 퀄리티의 트렌드 칼럼 초안을 작성하세요.`;

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
      `[화제] 요즘 난리난 '${topic.keyword}' 핵심 총정리`,
      topic.category,
      topic.categoryNameKo,
      [topic.keyword, topic.categoryNameKo, '트렌드', '핫플', '꿀템'],
      verifiedLinks,
      coupangSearchUrl
    );
  } catch (e) {
    console.error('[TrendAI] 초안 작성 실패, 기본 템플릿 반환:', e);
    return {
      title: `[화제] 요즘 난리난 '${topic.keyword}' 핵심 총정리`,
      summary: `${topic.keyword} 실시간 트렌드 분석입니다.`,
      metaDescription: `${topic.keyword} 실시간 트렌드 정보 안내`,
      category: topic.category,
      categoryNameKo: topic.categoryNameKo,
      tags: [topic.keyword, topic.categoryNameKo, '트렌드', '핫플', '꿀템'],
      htmlContent: `<p>${topic.keyword} 실시간 분석 내용입니다.</p>`,
      verifiedLinks,
      coupangUrl: coupangSearchUrl,
    };
  }
}
