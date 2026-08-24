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

  const verifiedLinksSummary = verifiedLinks
    .map(
      (v, i) =>
        `[링크 ${i + 1}] URL: ${v.originalUrl} | 페이지명: ${v.pageTitle} | 상태: ${v.isHealthy ? '정상(200)' : '에러'} | 검증: ${v.verificationNotes}`
    )
    .join('\n');

  const youtubeEmbedHtml = `
  <div style="margin: 32px 0;">
    <p style="font-size: 14px; font-weight: bold; color: #191f28; margin-bottom: 8px;">🎬 [실시간 영상] 유튜브 쇼츠 & 화제 현장 영상 둘러보기</p>
    <div style="position: relative; width: 100%; max-width: 100%; padding-bottom: 56.25%; height: 0; overflow: hidden; border-radius: 14px; box-shadow: 0 4px 16px rgba(0,0,0,0.08); background: #000000;">
      <iframe src="https://www.youtube-nocookie.com/embed?listType=search&list=${encodeURIComponent(topic.keyword)}" style="position: absolute; top:0; left: 0; width: 100%; height: 100%; border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>
    </div>
  </div>`;

  const systemInstruction = `당신은 대한민국에서 가장 감각적인 트렌드 매거진 수석 에디터이자, 릴스/쇼츠 바이럴 및 모바일 UX 전문가입니다.
점심시간(12:00) 스마트폰을 켠 2030 직장인과 학생들이 호기심을 참지 못하고 클릭할 수밖에 없는 **키워드 중심 후킹(어그로) 제목**과 **군더더기 없는 고품질 반응형 HTML 칼럼**을 작성하세요.

[핵심 작성 원칙]
1. ★ **CTR 극대화 키워드 중심 후킹 제목**:
   - 클릭을 유발하는 강력한 호기심/의문형/경고형 후킹 기법 사용.
   - 밈/브랜드/상품명에 오탈자가 절대 없도록 정확한 표준 명칭을 사용하세요.
2. **모바일 3초 스크롤 가독성 (HTML 스타일)**:
   - 문단은 2~3문장 단위로 짧게 분리.
   - 핵심 단어는 <strong> 태그로 강조.
   - 도입부에 부드러운 파스텔톤의 3줄 핵심 요약 콜아웃 박스 필수 배치.
3. **카테고리별 특화 필수 구성**:
   - **HOT_PLACE (맛집/핫플)**:
     - 도로명 주소, 네이버 지도 검색 바로가기 링크(https://m.map.naver.com/search2/search.naver?query=[장소명]), 영업시간, 주차 팁, 대표 메뉴 가격표(Table), 웨이팅 피하는 시간대, 솔직한 호불호 평가.
   - **SHOPPING_ITEM (바이럴 꿀템/쇼핑)**:
     - 제품 스펙/가격표, 바이럴 이유, ★솔직한 단점 및 아쉬운 점, 강력 추천 대상 vs 비추천 대상, 모바일 쿠팡 파트너스 CTA 배너.
   - **MEME_TREND (화제의 밈/이슈)**:
     - 밈의 원본 출처 및 유래, 정확한 뜻과 맥락, 상황별 찰진 사용 예시, 패러디 반응.
4. **구글 검색 1페이지 상단 노출용 FAQ 3문 3답**:
   - 본문 하단에 독자들이 검색창에 직접 쳐볼 법한 핵심 질문 3선(Q&A)을 반드시 배치하세요.
5. **🚫 절대 금지 항목 (엄격 준수)**:
   - 텍스트 형태의 '📸 [이미지: ...]', '사진 가이드', 회색 빈 박스 등 모든 종류의 이미지 플레이스홀더 작성 절대 금지!
   - '단톡방 공유용 카톡 템플릿' 같은 가짜 공유 박스 작성 절대 금지.
6. **쿠팡 파트너스 CTA 배너 (${topic.category === 'SHOPPING_ITEM' ? '필수 포함' : '해당시 포함'})**:
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
