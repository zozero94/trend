import { TrendPost, TrendTopic } from './types.js';

function escapeHtml(text: string): string {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;
  private blogId: string;

  constructor(botToken: string, chatId: string, blogId: string = '2498717653629376483') {
    this.botToken = botToken;
    this.chatId = chatId;
    this.blogId = blogId;
  }

  async sendTrendDraftNotification(
    post: TrendPost,
    topic: TrendTopic,
    bloggerPostId: string,
    reviewSummary: string,
    officialSiteName?: string,
    officialLandingUrl?: string,
    bloggerPostUrl?: string
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    const tagText = post.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' ');
    const previewWebzineUrl = `https://trend.zozero94.com/post.html?id=${bloggerPostId}`;
    const cleanOfficialUrl = officialLandingUrl || post.verifiedLinks[0]?.finalUrl || `https://m.search.naver.com/search.naver?query=${encodeURIComponent(topic.keyword)}`;
    const cleanOfficialName = officialSiteName || `${topic.keyword} 관련 상세 정보`;
    const cleanBloggerUrl = bloggerPostUrl || `https://www.blogger.com/blog/post/edit/${this.blogId}/${bloggerPostId}`;

    const messageText = `📢 <b>[트렌드 매거진 2호점] ${escapeHtml(topic.categoryNameKo)} 포스팅 승인 요청</b>

📝 <b>제목:</b> ${escapeHtml(post.title)}

💡 <b>3줄 핵심 요약:</b>
${escapeHtml(post.summary)}

🔗 <b>대표 연계 링크:</b> <a href="${escapeHtml(cleanOfficialUrl)}">${escapeHtml(cleanOfficialName)}</a>
🏛️ <b>18인 콘텐츠 감수 & 5인 시스템 감사:</b> ${escapeHtml(reviewSummary)}
🏷️ <b>태그:</b> ${escapeHtml(tagText)}

🌐 <b>웹진 미리보기:</b> <a href="${previewWebzineUrl}">${previewWebzineUrl}</a>
📱 <b>구글 블로그:</b> <a href="${cleanBloggerUrl}">${cleanBloggerUrl}</a>

아래 버튼을 누르면 <b>즉시 공식 발행</b>됩니다:`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ 즉시 정식 발행', callback_data: `publish:${this.blogId}:${bloggerPostId}` },
          { text: '❌ 임시글 삭제', callback_data: `delete:${this.blogId}:${bloggerPostId}` },
        ],
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: messageText,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
        reply_markup: inlineKeyboard,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram 알림 발송 실패: ${err}`);
    }

    console.log('📱 [Telegram] 텔레그램 승인 알림 발송 완료 (@zozero94bot)');
  }

  async sendMessage(text: string, parseMode: string = 'HTML'): Promise<boolean> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: false,
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch (e) {
      console.error('Telegram sendMessage error:', e);
      return false;
    }
  }
}
