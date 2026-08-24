import { TrendPost, TrendTopic } from './types.js';

export interface DevAuditFeedback {
  agentId: string;
  agentName: string;
  role: string;
  score: number; // 1~10
  passed: boolean;
  issues: string[];
  recommendations: string[];
}

export interface DevSystemAuditResult {
  overallPassed: boolean;
  averageDevScore: number;
  feedbacks: DevAuditFeedback[];
  sanitizedHtml: string;
  technicalIssuesSummary: string;
}

/**
 * ★ 2호점 5인 개발/아키텍처 감사 위원회 (역할 완전 독립 · 결정론적 규칙 기반)
 * - 각 감사관은 자신의 전담 영역만 검사하고, 가능한 경우 자동 교정(auto-fix)까지 수행한다.
 * - 감점 규칙: 10점 시작, 이슈 유형별 명시된 점수 차감 (최저 1점).
 */
export const DEV_ENGINEERING_AGENTS = [
  {
    id: 'dom_integrity',
    name: 'DOM 무결성 감사관',
    role: 'HTML 열림/닫힘 태그 균형(div/p/table/ul/ol/li)만 전수 검사하고 부족한 닫힘 태그를 자동 보정. 감점: 태그 불일치 유형 1건당 -2점',
  },
  {
    id: 'mobile_viewport',
    name: '모바일 뷰포트 감사관',
    role: '360px 기준 가로 스크롤 유발 요소만 검사: 360px 초과 고정 width 인라인 스타일 자동 교정, overflow-x 래퍼 없는 표 자동 래핑. 감점: 고정폭 1건당 -2점, 미래핑 표 1건당 -1점',
  },
  {
    id: 'security_xss',
    name: 'XSS/스크립트 보안 감사관',
    role: '악성 실행 벡터만 검사: <script> 블록, 인라인 이벤트 핸들러(onerror/onclick 등), javascript: URI, 유튜브 외 도메인 iframe 전량 제거. 감점: 발견 유형 1건당 -3점',
  },
  {
    id: 'affiliate_compliance',
    name: '외부 링크/제휴 컴플라이언스 감사관',
    role: '외부 링크 보안·제휴 규정만 검사: 모든 <a>에 target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" 강제 주입, 쿠팡 링크 존재 시 파트너스 고지 문구 필수. 감점: 고지 문구 누락 -4점, 속성 자동 보정 발생 시 -1점',
  },
  {
    id: 'media_placeholder',
    name: '더미/플레이스홀더 소제 감사관',
    role: '[이미지: ...] 등 더미 텍스트, 빈 <p>/<div> 껍데기, "이미지 준비중" 잔존물만 검사 후 전량 삭제. 감점: 더미 유형 1건당 -3점',
  },
];

/**
 * 2호점 트렌드 블로그 5인 개발/아키텍처 감사 수행 (결정론적 규칙 엔진)
 */
export function auditEngineeringAndArchitecture(
  post: TrendPost,
  topic: TrendTopic
): DevSystemAuditResult {
  const feedbacks: DevAuditFeedback[] = [];
  let sanitizedHtml = post.htmlContent;

  const clamp = (score: number) => Math.max(1, score);

  // =========================================================================
  // 1. [dom_integrity] 태그 열림/닫힘 균형 전수 검사 + div 자동 보정
  // =========================================================================
  const domIssues: string[] = [];
  const balanceTags = ['div', 'p', 'table', 'ul', 'ol', 'li'];
  for (const tag of balanceTags) {
    const openCount = (sanitizedHtml.match(new RegExp(`<${tag}\\b(?![^>]*\\/>)`, 'gi')) || []).length;
    const closeCount = (sanitizedHtml.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
    if (openCount !== closeCount) {
      domIssues.push(`${tag} 태그 불일치 (열림: ${openCount}, 닫힘: ${closeCount})`);
      if (tag === 'div' && openCount > closeCount) {
        sanitizedHtml += '</div>'.repeat(openCount - closeCount);
      }
    }
  }
  feedbacks.push({
    agentId: 'dom_integrity',
    agentName: 'DOM 무결성 감사관',
    role: 'HTML 열림/닫힘 태그 균형 전수 검사 및 자동 보정',
    score: clamp(10 - domIssues.length * 2),
    passed: true,
    issues: domIssues,
    recommendations: domIssues.length > 0 ? ['부족한 div 닫힘 태그 자동 보정 완료, 초안 생성기의 태그 완결성 점검 권장'] : ['전 태그 열림/닫힘 균형 완벽'],
  });

  // =========================================================================
  // 2. [mobile_viewport] 360px 가로 스크롤 방지: 고정폭 교정 + 표 래핑
  // =========================================================================
  const viewportIssues: string[] = [];
  let fixedWidthCount = 0;
  sanitizedHtml = sanitizedHtml.replace(/width\s*:\s*(\d{3,})px/gi, (match, px) => {
    const width = parseInt(px, 10);
    if (width > 360) {
      fixedWidthCount++;
      return `width: 100%; max-width: ${width}px`;
    }
    return match;
  });
  if (fixedWidthCount > 0) {
    viewportIssues.push(`360px 초과 고정 width ${fixedWidthCount}건 ➔ max-width 반응형 자동 교정`);
  }

  let unwrappedTableCount = 0;
  sanitizedHtml = sanitizedHtml.replace(/<table[\s\S]*?<\/table>/gi, (tableBlock, offset: number) => {
    const preceding = sanitizedHtml.slice(Math.max(0, offset - 200), offset);
    if (/overflow-x/i.test(preceding)) return tableBlock;
    unwrappedTableCount++;
    return `<div style="overflow-x: auto; -webkit-overflow-scrolling: touch;">${tableBlock}</div>`;
  });
  if (unwrappedTableCount > 0) {
    viewportIssues.push(`overflow-x 래퍼 없는 표 ${unwrappedTableCount}건 ➔ 스크롤 래퍼 자동 래핑`);
  }

  feedbacks.push({
    agentId: 'mobile_viewport',
    agentName: '모바일 뷰포트 감사관',
    role: '360px 가로 스크롤 방지 및 인라인 스타일 반응형 교정',
    score: clamp(10 - fixedWidthCount * 2 - unwrappedTableCount),
    passed: true,
    issues: viewportIssues,
    recommendations: viewportIssues.length > 0 ? ['고정폭/표 반응형 자동 교정 완료'] : ['360px 뷰포트 가로 스크롤 요소 없음'],
  });

  // =========================================================================
  // 3. [security_xss] 스크립트 / 인라인 핸들러 / javascript: URI / 비인가 iframe 차단
  //    (유튜브 공식 임베드 도메인 iframe만 화이트리스트 허용)
  // =========================================================================
  const securityIssues: string[] = [];
  if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(sanitizedHtml)) {
    securityIssues.push('위험 스크립트(<script>) 감지 ➔ 즉시 제거');
    sanitizedHtml = sanitizedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  }
  if (/\son\w+\s*=\s*["'][^"']*["']/gi.test(sanitizedHtml)) {
    securityIssues.push('인라인 이벤트 핸들러(onerror/onclick 등) 감지 ➔ 속성 제거');
    sanitizedHtml = sanitizedHtml.replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '');
  }
  if (/href\s*=\s*["']\s*javascript:/gi.test(sanitizedHtml)) {
    securityIssues.push('javascript: URI 감지 ➔ 무해화(#) 처리');
    sanitizedHtml = sanitizedHtml.replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');
  }
  let blockedIframeCount = 0;
  sanitizedHtml = sanitizedHtml.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>|<iframe\b[^>]*\/>/gi, (iframeTag) => {
    if (/src\s*=\s*["']https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com)\//i.test(iframeTag)) {
      return iframeTag;
    }
    blockedIframeCount++;
    return '';
  });
  if (blockedIframeCount > 0) {
    securityIssues.push(`유튜브 외 비인가 도메인 iframe ${blockedIframeCount}건 ➔ 전량 제거`);
  }
  feedbacks.push({
    agentId: 'security_xss',
    agentName: 'XSS/스크립트 보안 감사관',
    role: '악성 스크립트, 인라인 이벤트 핸들러 및 비인가 iframe 원천 차단',
    score: clamp(10 - securityIssues.length * 3),
    passed: true,
    issues: securityIssues,
    recommendations: securityIssues.length > 0 ? ['실행 가능 벡터 전량 제거 완료 (유튜브 공식 임베드만 유지)'] : ['XSS 실행 벡터 없음 (클린)'],
  });

  // =========================================================================
  // 4. [affiliate_compliance] 외부 링크 보안 속성 강제 + 쿠팡 고지 문구 검사
  // =========================================================================
  const affiliateIssues: string[] = [];
  let patchedLinkCount = 0;
  sanitizedHtml = sanitizedHtml.replace(/<a\b([^>]*)>/gi, (match, attrs: string) => {
    if (!/href\s*=\s*["']https?:\/\//i.test(attrs)) return match; // 외부 링크만 대상
    let newAttrs = attrs;
    let patched = false;
    if (!/target\s*=/i.test(newAttrs)) { newAttrs += ' target="_blank"'; patched = true; }
    if (!/rel\s*=/i.test(newAttrs)) { newAttrs += ' rel="noopener noreferrer"'; patched = true; }
    if (!/referrerpolicy\s*=/i.test(newAttrs)) { newAttrs += ' referrerpolicy="no-referrer"'; patched = true; }
    if (patched) patchedLinkCount++;
    return `<a${newAttrs}>`;
  });
  if (patchedLinkCount > 0) {
    affiliateIssues.push(`보안/추적 방지 속성 미비 외부 링크 ${patchedLinkCount}건 ➔ 필수 속성 자동 주입`);
  }
  const hasCoupangLink = /coupang\.com/i.test(sanitizedHtml);
  const hasDisclosure = /쿠팡\s*파트너스/i.test(sanitizedHtml);
  const disclosureMissing = hasCoupangLink && !hasDisclosure;
  if (disclosureMissing) {
    affiliateIssues.push('쿠팡 링크 존재하나 파트너스 활동 고지 문구 누락 (공정위 위반 위험)');
  }
  feedbacks.push({
    agentId: 'affiliate_compliance',
    agentName: '외부 링크/제휴 컴플라이언스 감사관',
    role: '외부 링크 referrerpolicy="no-referrer" 필수 속성 및 제휴 고지 문구 감사',
    score: clamp(10 - (patchedLinkCount > 0 ? 1 : 0) - (disclosureMissing ? 4 : 0)),
    passed: !disclosureMissing,
    issues: affiliateIssues,
    recommendations: disclosureMissing
      ? ['쿠팡 파트너스 고지 문구를 CTA 하단에 추가 필요']
      : ['전 외부 링크 보안 속성 및 제휴 규정 준수 확인'],
  });

  // =========================================================================
  // 5. [media_placeholder] 더미 텍스트 / 빈 껍데기 요소 전량 소제
  // =========================================================================
  const placeholderIssues: string[] = [];
  const dummyPattern = /\[\s*(이미지|사진|포토존|가이드|비주얼|영상|썸네일)[^\]]*\]|📸\s*\[[^\]]*\]|이미지\s*준비\s*중/gi;
  if (dummyPattern.test(sanitizedHtml)) {
    placeholderIssues.push('이미지/미디어 더미 플레이스홀더 텍스트 잔존 ➔ 전량 삭제');
    sanitizedHtml = sanitizedHtml.replace(dummyPattern, '');
  }
  const emptyShellPattern = /<(p|div)\b[^>]*>\s*(&nbsp;)?\s*<\/\1>/gi;
  if (emptyShellPattern.test(sanitizedHtml)) {
    placeholderIssues.push('빈 <p>/<div> 껍데기 요소 잔존 ➔ 전량 삭제');
    sanitizedHtml = sanitizedHtml.replace(emptyShellPattern, '');
  }
  feedbacks.push({
    agentId: 'media_placeholder',
    agentName: '더미/플레이스홀더 소제 감사관',
    role: '[이미지: ...] 등 더미 텍스트 잔존 여부 감사 및 소제',
    score: clamp(10 - placeholderIssues.length * 3),
    passed: true,
    issues: placeholderIssues,
    recommendations: placeholderIssues.length > 0 ? ['더미 요소 전량 소제 완료'] : ['플레이스홀더 잔존물 없음 (클린)'],
  });

  const totalScore = feedbacks.reduce((acc, f) => acc + f.score, 0);
  const averageDevScore = Number((totalScore / feedbacks.length).toFixed(1));
  const overallPassed = feedbacks.every((f) => f.passed);

  const technicalIssuesSummary = feedbacks
    .filter((f) => f.issues.length > 0)
    .map((f) => `[${f.agentName}] ${f.issues.join(', ')}`)
    .join('\n');

  return {
    overallPassed,
    averageDevScore,
    feedbacks,
    sanitizedHtml,
    technicalIssuesSummary,
  };
}
