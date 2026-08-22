export type TrendCategory = 'HOT_PLACE' | 'SHOPPING_ITEM' | 'MEME_TREND' | 'LIFE_HACK';

export interface TrendRawItem {
  source: 'youtube' | 'google_trends' | 'naver_datalab';
  keyword: string;
  title: string;
  snippet?: string;
  rank?: number;
  url?: string;
}

export interface TrendTopic {
  keyword: string;
  category: TrendCategory;
  categoryNameKo: string; // "SNS 핫플레이스/맛집" | "바이럴 꿀템/쇼핑" | "화제의 밈/이슈"
  headlineHook: string;
  sources: ('youtube' | 'google_trends' | 'naver_datalab')[];
  matchScore: number;
  searchQueries: string[];
}

export interface VerifiedLink {
  originalUrl: string;
  finalUrl: string;
  status: number;
  isHealthy: boolean;
  pageTitle: string;
  screenshotBase64?: string;
  isContentMatched: boolean;
  verificationNotes: string;
}

export interface TrendPost {
  title: string;
  summary: string;
  metaDescription: string;
  category: TrendCategory;
  categoryNameKo: string;
  tags: string[];
  htmlContent: string;
  verifiedLinks: VerifiedLink[];
  coupangUrl?: string;
}

export interface AgentFeedback {
  agentName: string;
  role: string;
  score: number;
  strengths: string;
  improvements: string;
}
