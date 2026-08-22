import { TrendPost, TrendTopic } from './types.js';

export class TelegramNotifier {
  private botToken: string;
  private chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async sendTrendDraftNotification(
    post: TrendPost,
    topic: TrendTopic,
    bloggerPostId: string,
    reviewSummary: string
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    const verifiedLinksText = post.verifiedLinks.length > 0
      ? post.verifiedLinks.map((l, i) => `🔗 [링크 ${i+1}] ${l.pageTitle || '확인'} (${l.isHealthy ? '정상' : '에러'})\n   👉 ${l.originalUrl}`).join('\n')
      : '🔗 기본 검색 키워드 기반';

    const messageText = `🔥 [트렌드 블로그 2호점 글 생성 완료]

📌 카테고리: ${topic.categoryNameKo}
🎯 키워드: #${topic.keyword}

📰 제목: ${post.title}

📝 3줄 요약:
${post.summary}

${verifiedLinksText}

🏛️ 감수 결과:
${reviewSummary}

Blogger ID: ${bloggerPostId}
아래 버튼을 눌러 즉시 발행하거나 취소하세요:`;

    const inlineKeyboard = {
      inline_keyboard: [
        [
          { text: '✅ 즉시 발행', callback_data: `publish:${bloggerPostId}` },
          { text: '❌ 글 삭제', callback_data: `delete:${bloggerPostId}` },
        ],
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: messageText,
        reply_markup: inlineKeyboard,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram 알림 발송 실패: ${err}`);
    }

    console.log('📱 [Telegram] 텔레그램 승인 알림 발송 완료 (@zozero94bot)');
  }
}
