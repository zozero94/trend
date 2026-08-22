import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BloggerClient } from '../src/blogger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(200).send('Telegram Webhook Endpoint for Trend Blog');
  }

  const blogId = process.env.BLOGGER_BLOG_ID || '';
  const clientId = process.env.BLOGGER_CLIENT_ID || '';
  const clientSecret = process.env.BLOGGER_CLIENT_SECRET || '';
  const refreshToken = process.env.BLOGGER_REFRESH_TOKEN || '';
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

  try {
    const update = req.body;

    if (update.callback_query) {
      const callbackQuery = update.callback_query;
      const data = callbackQuery.data;
      const callbackQueryId = callbackQuery.id;
      const chatId = callbackQuery.message.chat.id;
      const messageId = callbackQuery.message.message_id;

      const [action, postId] = data.split(':');
      const blogger = new BloggerClient(blogId, clientId, clientSecret, refreshToken);

      if (action === 'publish') {
        await blogger.publishPost(postId);
        await answerCallbackQuery(botToken, callbackQueryId, '🎉 트렌드 글이 즉시 발행되었습니다!');
        await editMessageReplyMarkup(botToken, chatId, messageId, '✅ [발행 완료] trend.zozero94.com에 라이브되었습니다.');
      } else if (action === 'delete') {
        await blogger.deletePost(postId);
        await answerCallbackQuery(botToken, callbackQueryId, '🗑️ 트렌드 글이 삭제되었습니다.');
        await editMessageReplyMarkup(botToken, chatId, messageId, '❌ [삭제됨] 해당 글이 취소되었습니다.');
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: false });
  }
}

async function answerCallbackQuery(botToken: string, callbackQueryId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

async function editMessageReplyMarkup(botToken: string, chatId: number, messageId: number, statusText: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text: `${statusText}\n\n상태가 변경되었습니다.`,
    }),
  });
}
