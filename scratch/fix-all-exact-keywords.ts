import 'dotenv/config';
import { BloggerClient } from '../src/blogger.js';
import { GoogleGenAI } from '@google/genai';
import { generateContentWithFallback, safeJsonParse } from '../src/model-resolver.js';

async function extractExactKeywordsForPost(apiKey: string, title: string, content: string): Promise<{
  productKeyword: string;
  youtubeKeyword: string;
  naverMapKeyword: string;
}> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `당신은 쇼핑/트렌드 키워드 정제 전문가입니다.
블로그 포스트 제목: "${title}"
본문 발췌: "${content.slice(0, 500)}"

[작성 규칙]
1. 'productKeyword': 쿠팡에서 검색했을 때 100% 관련 상품이 와르르 나오는 가장 정확하고 깔끔한 1~3단어 핵심 명사/상품명 (예: '말랑이', '신라면', '국새 키링', '야구 유니폼', '비상식량 찬물 컵라면'). 문장이나 수식어('[단독]', '오픈 1시간만에', '퇴근 후' 등) 절대 금지!
2. 'youtubeKeyword': 유튜브에서 검색했을 때 가장 적합한 1~3단어 핵심 검색어 (예: '말랑이 수술 챌린지', '삐끼삐끼 댄스', '신라면 팝업스토어', '국새 키링 뮷즈', '일본 찬물 컵라면').
3. 'naverMapKeyword': 네이버 지도에서 검색할 장소명/키워드 (예: '성수동 팝업스토어', '국립중앙박물관 뮷즈', '신라면 팝업').

반드시 다음 JSON 포맷으로만 응답하세요:
{
  "productKeyword": "깔끔한 핵심 상품명",
  "youtubeKeyword": "핵심 유튜브 검색어",
  "naverMapKeyword": "핵심 장소명"
}`;

  try {
    const res = await generateContentWithFallback(ai, {
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.1 },
    });
    return safeJsonParse(res.text || '{}', {
      productKeyword: '인기 상품',
      youtubeKeyword: title,
      naverMapKeyword: title,
    });
  } catch {
    return {
      productKeyword: '인기 상품',
      youtubeKeyword: title,
      naverMapKeyword: title,
    };
  }
}

async function main() {
  const blogger = new BloggerClient(
    process.env.BLOGGER_BLOG_ID!,
    process.env.BLOGGER_CLIENT_ID!,
    process.env.BLOGGER_CLIENT_SECRET!,
    process.env.BLOGGER_REFRESH_TOKEN!
  );

  const apiKey = process.env.GEMINI_API_KEY!;
  const posts = await blogger.getPosts(20);
  const token = await (blogger as any).getAccessToken();

  console.log(`🔍 총 ${posts.length}개 포스트 정밀 키워드 복원 및 링크 교정 시작...`);

  for (const post of posts) {
    if (!post.id) continue;
    console.log(`\n==================================================`);
    console.log(`포스트 ID: ${post.id}`);
    console.log(`제목: ${post.title}`);

    const extracted = await extractExactKeywordsForPost(apiKey, post.title, post.content);
    console.log(`🎯 정제된 쿠팡 검색어: "${extracted.productKeyword}"`);
    console.log(`🎬 정제된 유튜브 검색어: "${extracted.youtubeKeyword}"`);

    const exactCoupangUrl = `https://www.coupang.com/np/search?q=${encodeURIComponent(extracted.productKeyword)}`;
    const exactYoutubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(extracted.youtubeKeyword)}`;
    const exactNaverMapUrl = `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(extracted.naverMapKeyword)}`;

    let updated = post.content;

    // 1. 모든 쿠팡 링크를 정확한 핵심 상품명 검색 URL로 교체
    updated = updated.replace(/href=['"]https:\/\/(?:www|m)\.coupang\.com\/[^'"]*['"]/gi, `href="${exactCoupangUrl}"`);

    // 2. 모든 유튜브 링크를 정확한 핵심 영상 검색 URL로 교체
    updated = updated.replace(/href=['"]https:\/\/(?:www|m)\.youtube\.com\/results\?search_query=[^'"]*['"]/gi, `href="${exactYoutubeUrl}"`);

    // 3. 네이버 지도 링크 교정
    updated = updated.replace(/href=['"]https:\/\/(?:www|m)\.map\.naver\.com\/[^'"]*['"]/gi, `href="${exactNaverMapUrl}"`);

    // 4. CTA 버튼 텍스트의 키워드도 깔끔하게 교정
    updated = updated.replace(/🔥\s*\[.*?\]\s*최저가 & 실시간 재고 확인하기/gi, `🔥 [${extracted.productKeyword}] 최저가 & 실시간 재고 확인하기`);

    // 5. 모든 <a> 태그에 target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer" 보장
    updated = updated.replace(/<a\s+([^>]*?)>/gi, (match, attrs) => {
      let cleanAttrs = attrs.replace(/\s*(target|rel|referrerpolicy)=['"][^'"]*['"]/gi, '');
      return `<a ${cleanAttrs} target="_blank" rel="noreferrer noopener" referrerpolicy="no-referrer">`;
    });

    const url = `https://www.googleapis.com/blogger/v3/blogs/${process.env.BLOGGER_BLOG_ID}/posts/${post.id}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: post.id,
        title: post.title,
        content: updated,
        labels: post.labels,
      }),
    });

    if (res.ok) {
      console.log(`✅ 포스트 ${post.id} 쿠팡/유튜브 링크 정확한 키워드로 원격 수정 완료!`);
    } else {
      console.error(`❌ 포스트 ${post.id} 수정 실패:`, await res.text());
    }
  }
}
main();
