/**
 * 트렌드 카테고리 및 키워드에 맞는 실제 고화질 이미지 URL 제공기
 */
export function getTopicImageUrl(keyword: string, category: string): { url: string; alt: string } {
  const kw = keyword.toLowerCase();

  // 1. 라면 / 분식 / 음식 관련
  if (kw.includes('라면') || kw.includes('신라면') || kw.includes('분식') || kw.includes('떡볶이')) {
    return {
      url: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=1200&q=80',
      alt: `${keyword} 현장 실시간 분위기`,
    };
  }

  // 2. 디저트 / 초콜릿 / 베이커리 / 카페
  if (kw.includes('초콜릿') || kw.includes('디저트') || kw.includes('카페') || kw.includes('베이커리') || kw.includes('빵')) {
    return {
      url: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=1200&q=80',
      alt: `${keyword} 비주얼 컷`,
    };
  }

  // 3. 뷰티 / 화장품 / 올리브영 / 다이소 꿀템
  if (kw.includes('올리브영') || kw.includes('화장품') || kw.includes('리들샷') || kw.includes('스킨') || kw.includes('세럼')) {
    return {
      url: 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&q=80',
      alt: `${keyword} 실사용 컷`,
    };
  }

  // 4. 패션 / 의류 / 신발 / 굿즈
  if (kw.includes('신발') || kw.includes('운동화') || kw.includes('패션') || kw.includes('옷') || kw.includes('굿즈')) {
    return {
      url: 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?auto=format&fit=crop&w=1200&q=80',
      alt: `${keyword} 컷`,
    };
  }

  // 5. 성수 / 팝업스토어 / 핫플레이스 일반
  if (category === 'HOT_PLACE' || kw.includes('성수') || kw.includes('팝업') || kw.includes('홍대')) {
    return {
      url: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80',
      alt: `${keyword} 핫플레이스 현장`,
    };
  }

  // 6. 전자기기 / IT / 테크
  if (kw.includes('폰') || kw.includes('아이폰') || kw.includes('갤럭시') || kw.includes('노트북') || kw.includes('이어폰')) {
    return {
      url: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80',
      alt: `${keyword} 테크 컷`,
    };
  }

  // 기본 트렌드 고화질 이미지
  return {
    url: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80',
    alt: `${keyword} 트렌드 컷`,
  };
}
