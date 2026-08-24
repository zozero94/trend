import { GoogleGenAI } from '@google/genai';
import { TrendTopic, TrendPost, VerifiedLink } from './types.js';
import { generateContentWithFallback, safeJsonParse } from './model-resolver.js';

export async function generateInitialTrendPost(
  apiKey: string,
  topic: TrendTopic,
  verifiedLinks: VerifiedLink[],
  coupangSearchUrl: string,
  coupangPartnersId: string = 'AF2968960'
): Promise<TrendPost> {
  const ai = new GoogleGenAI({ apiKey });

  const officialLink = verifiedLinks.find((v) => v.linkType === 'DIRECT_OFFICIAL');
  const isDirectOfficial = !!officialLink;
  const officialUrl = officialLink?.finalUrl || `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topic.keyword)}`;
  const officialSiteTitle = isDirectOfficial ? '🏛️ 공식 오피셜 바로가기' : '🔍 실시간 입고 & 최저가 검색';
  const officialCardDescription = isDirectOfficial
    ? '공식몰, 공식 예약 사이트 및 상세 공지를 바로 확인하세요.'
    : '국내 공식 판매처가 한정되어 있어 실시간 입고 현황 및 스마트스토어 검색을 확인하세요.';
  const officialButtonText = isDirectOfficial ? '공식 바로가기 &rarr;' : '실시간 정보 확인 &rarr;';

  const verifiedLinksSummary = verifiedLinks
    .map(
      (v, i) =>
        `[링크 ${i + 1}] 종류: ${v.linkType || '검색'} | URL: ${v.finalUrl || v.originalUrl} | 페이지명: ${v.pageTitle} | 상태: ${v.isHealthy ? '정상' : '검색대체'} | 검증: ${v.verificationNotes}`
    )
    .join('\n');

  const youtubeEmbedHtml = `
  <div style="margin: 32px 0; padding: 22px; background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 16px; color: #ffffff; box-shadow: 0 8px 24px rgba(0,0,0,0.12); text-align: center;">
    <div style="display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 12px;">
      <span style="font-size: 22px;">🎬</span>
      <h4 style="margin: 0; font-size: 17px; font-weight: 700; color: #ffffff;">[실시간 화제] ${topic.keyword} 유튜브 쇼츠 & 현장 영상</h4>
    </div>
    <p style="font-size: 13.5px; color: #cbd5e1; margin: 0 0 18px 0; line-height: 1.5;">SNS에서 화제를 모은 ${topic.keyword}의 실제 영상과 리얼 리뷰를 지금 확인하세요.</p>
    <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(topic.keyword)}" target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" style="display: inline-flex; align-items: center; gap: 8px; background: #ff0000; color: #ffffff !important; padding: 12px 24px; border-radius: 30px; font-weight: 700; font-size: 15px; text-decoration: none; box-shadow: 0 4px 14px rgba(255,0,0,0.4);">
      ▶ 유튜브에서 화제 영상 바로보기 &rarr;
    </a>
  </div>`;

  const systemInstruction = `당신은 대한민국에서 가장 감각적인 트렌드 매거진 수석 에디터이자, 릴스/쇼츠 바이럴 및 모바일 UX 전문가입니다.
점심시간(12:00) 스마트폰을 켠 2030 직장인과 학생들이 호기심을 참지 못하고 클릭할 수밖에 없는 **키워드 중심 후킹(어그로) 제목**과 **군더더기 없는 고품질 반응형 HTML 칼럼**을 작성하세요.
이 초안은 작성 직후 **16인 전문 감수 위원회의 절대 감점제 채점**을 받습니다. 아래 [감수단 사전 통과 체크리스트]의 항목이 하나라도 빠지면 해당 위원이 즉시 감점하므로, 초안 단계에서 전 항목을 반드시 포함하세요.

[★ 16인 감수단 사전 통과 체크리스트 — 누락 시 감점되는 필수 요소]
□ 제목: 숫자/구체 키워드 + 궁금증 유발 장치 (없으면 헤드라인 마스터 각 -3점), 낚시 금지, 브랜드/밈 오탈자 1건당 -4점
□ 3줄 핵심 요약 콜아웃 박스 (누락 시 모바일 UX 위원 -3점)
□ 🏛️ 오피셜/검색 바로가기 카드 (누락 시 오피셜 최적화관 -4점)
□ 내돈내산 치명적 단점/호불호 문단 + "이런 사람에겐 비추천" 명시 (단점 문단 누락 시 솔직 리뷰어 -6점)
□ FAQ 3선 — 검색어형 질문 + 수치/날짜/장소가 담긴 팩트 답변 (누락 시 FAQ 설계관 -5점)
□ 모든 문단 2~3문장 (4문장 이상 문단 1개라도 존재 시 UX 위원 -6점)
□ 구체 금액(원 단위) + 비교 기준(정가/1인당) (금액 0건 시 가성비 헌터 -4점)
□ 핫플/장소 주제: 도로명 주소(-4점), 메뉴 가격표 Table(-5점), 웨이팅/주차 팁(-3점), 영업시간(-2점)
□ 밈 주제: 원본 출처 명시(-4점), 유래 추측/왜곡 서술 금지(-4점)
□ 쇼핑 주제: 쿠팡 CTA 배너(-4점) + 공정위 파트너스 고지 문구(누락 시 컴플라이언스 -6점)
□ 도입 3문장 내 끝까지 읽을 이유 예고 + 섹션 간 브릿지 문장 + 결말 꿀팁 보상 (체류시간 부스터 각 -2~3점)
□ 사전 검증된 링크 목록의 URL만 사용 — 새 URL 임의 창작 시 랜딩 팩트체커 1건당 -4점
□ ${isDirectOfficial ? '공식 직영몰/예약처가 확인되었으므로 "공식 사이트에서 확인하세요"라고 정확히 서술' : '공식 직영몰이 부재하여 검색 링크로 대체되었으므로 "공식몰"이라는 허위 서술 금지, "실시간 입고 및 최저가 검색"으로 본문 서술'}
□ 근거 없는 최상급 표현("인생템", "무조건 사세요") 및 일방적 찬양 톤 금지 (악취 필터링관 감점)
□ [이미지: ...] 등 더미 텍스트 1개라도 존재 시 더미 감수관 즉시 1점 처리

[핵심 작성 원칙]
1. ★ **CTR 극대화 키워드 중심 후킹 제목**:
   - 클릭을 유발하는 강력한 호기심/의문형/경고형 후킹 기법 사용.
   - 밈/브랜드/상품명에 오탈자가 절대 없도록 정확한 표준 명칭을 사용하세요.
2. **모바일 3초 스크롤 가독성 (HTML 스타일)**:
   - 문단은 2~3문장 단위로 짧게 분리.
   - 핵심 단어는 <strong> 태그로 강조.
   - 도입부에 부드러운 파스텔톤의 3줄 핵심 요약 콜아웃 박스 필수 배치:
     <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px 18px; border-radius: 8px; margin-bottom: 24px; line-height: 1.7;">
       <strong style="color: #1e40af; font-size: 15px;">⚡ 3줄 핵심 요약</strong>
       <ul style="margin: 8px 0 0 0; padding-left: 18px; font-size: 14.5px; color: #1e293b;">...</ul>
     </div>
3. **🏛️ 바로가기 배너 카드 (필수 삽입)**:
   - 본문 상단에 독자가 바로 확인을 할 수 있는 카드를 삽입하세요:
     <div style="background: #f1f5f9; border: 1.5px solid #cbd5e1; border-radius: 10px; padding: 14px 18px; margin: 20px 0; display: flex; align-items: center; justify-content: space-between;">
       <div>
         <strong style="color: #0f172a; font-size: 14px;">${officialSiteTitle}</strong>
         <p style="margin: 3px 0 0 0; font-size: 12.5px; color: #64748b;">${officialCardDescription}</p>
       </div>
       <a href="${officialUrl}" target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" style="display: inline-block; background: #0f172a; color: #ffffff !important; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 700; text-decoration: none; white-space: nowrap;">${officialButtonText}</a>
     </div>
4. **★ 내돈내산 솔직 단점 & 아쉬운 점 (1문단 필수 작성)**:
   - 무조건적인 찬양글은 절대 금지! 실제 구매자/방문자의 솔직한 호불호, 웨이팅 고충, 아쉬운 가성비나 단점을 1문단 이상 명확히 분석하세요.
5. **카테고리별 특화 필수 구성**:
   - **HOT_PLACE (맛집/핫플)**:
     - 도로명 주소, 네이버 지도 검색 바로가기 링크(https://m.map.naver.com/search2/search.naver?query=[장소명]), 영업시간, 주차 팁, 대표 메뉴 가격표(Table), 웨이팅 피하는 시간대, 솔직한 호불호 평가.
   - **SHOPPING_ITEM (바이럴 꿀템/쇼핑)**:
     - 제품 스펙/가격표, 바이럴 이유, ★솔직한 단점 및 아쉬운 점, 강력 추천 대상 vs 비추천 대상, 모바일 쿠팡 파트너스 CTA 배너.
   - **MEME_TREND (화제의 밈/이슈)**:
     - 밈의 원본 출처 및 유래, 정확한 뜻과 맥락, 상황별 찰진 사용 예시, 패러디 반응.
6. **구글 검색 1페이지 상단 노출용 FAQ 3문 3답**:
   - 본문 하단에 독자들이 검색창에 직접 쳐볼 법한 핵심 질문 3선(Q&A)을 반드시 배치하세요.
7. **🚫 절대 금지 항목 (엄격 준수)**:
   - 텍스트 형태의 '📸 [이미지: ...]', '사진 가이드', 회색 빈 박스 등 모든 종류의 이미지 플레이스홀더 작성 절대 금지!
   - '단톡방 공유용 카톡 템플릿' 같은 가짜 공유 박스 작성 절대 금지.
8. **쿠팡 파트너스 CTA 배너 (${topic.category === 'SHOPPING_ITEM' ? '필수 포함' : '해당시 포함'})**:
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

    const parsed = safeJsonParse<any>(response.text || '{}', {});
    let html = parsed.htmlContent || `<p>${topic.keyword} 분석 내용</p>`;

    // 유튜브 반응형 임베드 삽입 (본문 중단 자연스러운 위치)
    if (!html.includes('iframe') && !html.includes('youtube')) {
      html += youtubeEmbedHtml;
    }

    return {
      title: parsed.title || `[화제] 요즘 난리난 '${topic.keyword}' 핵심 총정리`,
      summary: parsed.summary || `${topic.keyword} 실시간 트렌드 분석입니다.`,
      metaDescription: parsed.metaDescription || `${topic.keyword} 실시간 트렌드 정보 안내`,
      category: topic.category,
      categoryNameKo: topic.categoryNameKo,
      tags: parsed.tags || [topic.keyword, topic.categoryNameKo, '트렌드', '핫플', '꿀템'],
      htmlContent: html,
      verifiedLinks,
      coupangUrl: coupangSearchUrl,
    };
  } catch (e) {
    console.error('[TrendAI] 초안 작성 실패, 기본 템플릿 반환:', e);
    return {
      title: `[화제] 요즘 난리난 '${topic.keyword}' 핵심 총정리`,
      summary: `${topic.keyword}에 대한 실시간 트렌드 및 핵심 정보 분석입니다.`,
      metaDescription: `${topic.keyword} 실시간 트렌드 정보 안내`,
      category: topic.category,
      categoryNameKo: topic.categoryNameKo,
      tags: [topic.keyword, '트렌드', '핫이슈'],
      htmlContent: `<h2>요즘 난리난 ${topic.keyword}</h2><p>실시간으로 큰 화제를 모으고 있는 ${topic.keyword}의 핵심 정보를 전해드립니다.</p>${youtubeEmbedHtml}`,
      verifiedLinks,
      coupangUrl: coupangSearchUrl,
    };
  }
}
