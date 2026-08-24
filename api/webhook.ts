import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BloggerClient } from '../src/blogger.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { callback_query, message } = req.body;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_CHAT_ID;
  const defaultBlogId = process.env.BLOGGER_BLOG_ID || '2498717653629376483';
  const clientId = process.env.BLOGGER_CLIENT_ID;
  const clientSecret = process.env.BLOGGER_CLIENT_SECRET;
  const refreshToken = process.env.BLOGGER_REFRESH_TOKEN;

  // 1. 인라인 버튼 콜백 처리
  if (callback_query) {
    const senderChatId = callback_query.message?.chat?.id?.toString() || callback_query.from?.id?.toString();
    const data = callback_query.data; // e.g. "publish:2498717653629376483:postId" or "publish:postId"
    const messageId = callback_query.message?.message_id;

    // 텔레그램 모바일 로딩 스피너 즉시 해제
    if (botToken && callback_query.id) {
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callback_query_id: callback_query.id, text: '요청을 처리 중입니다...' }),
      }).catch(() => {});
    }

    // 관리자 인증 체크
    if (adminChatId && senderChatId !== adminChatId) {
      return res.status(403).json({ error: 'Unauthorized user' });
    }

    // 3-part 및 2-part 콜백 데이터 정규화
    const parts = (data || '').split(':');
    const action = parts[0];
    let targetBlogId = defaultBlogId;
    let targetPostId = '';

    if (parts.length === 3) {
      targetBlogId = parts[1];
      targetPostId = parts[2];
    } else if (parts.length === 2) {
      targetPostId = parts[1];
    }

    if (!targetPostId) {
      return res.status(400).json({ error: 'Invalid callback data format' });
    }

    if (!clientId || !clientSecret || !refreshToken) {
      return res.status(500).json({ error: 'Blogger API credentials missing' });
    }

    const blogger = new BloggerClient(targetBlogId, clientId, clientSecret, refreshToken);

    try {
      if (action === 'publish') {
        await blogger.publishPost(targetPostId);
        if (botToken && senderChatId && messageId) {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: senderChatId,
              message_id: messageId,
              text: `✅ [트렌드 2호점] 포스팅이 성공적으로 정식 발행되었습니다!\n\n🌐 웹진: https://trend.zozero94.com`,
              parse_mode: 'HTML',
            }),
          }).catch(() => {});
        }
        return res.status(200).json({ success: true, action: 'published', postId: targetPostId });
      } else if (action === 'delete') {
        await blogger.deletePost(targetPostId);
        if (botToken && senderChatId && messageId) {
          await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: senderChatId,
              message_id: messageId,
              text: `🗑️ [트렌드 2호점] 임시 저장글이 삭제(반려)되었습니다.`,
              parse_mode: 'HTML',
            }),
          }).catch(() => {});
        }
        return res.status(200).json({ success: true, action: 'deleted', postId: targetPostId });
      }
    } catch (err: any) {
      if (botToken && senderChatId) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: senderChatId,
            text: `❌ 작업 처리 중 오류가 발생했습니다:\n${err.message}`,
          }),
        }).catch(() => {});
      }
      return res.status(500).json({ error: err.message });
    }
  }

  // 2. 텍스트 메시지 응답
  if (message && message.text) {
    const text = message.text.trim();
    const chatId = message.chat.id;

    if (botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🤖 [트렌드 2호점 봇]\n수신된 메시지: "${text}"\n모든 통합 명령은 메인 웹진(https://zozero94.com/api/webhook)에서 자동 관리됩니다.`,
        }),
      }).catch(() => {});
    }
    return res.status(200).json({ success: true, message: 'Message received' });
  }

  return res.status(200).json({ success: true });
}
