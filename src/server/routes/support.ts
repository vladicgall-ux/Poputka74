import { Router } from 'express';
import { requireTelegramAuth, type AuthedRequest } from '../middleware/auth';
import { createSupportMessage } from '../../services/supportService';
import { notifyAdmins } from '../../bot/notifier';

export const supportRouter = Router();

// Специально без requireActiveUser: даже забаненный или неверифицированный
// пользователь должен иметь возможность написать в поддержку и разобраться в ситуации.
supportRouter.use(requireTelegramAuth);

supportRouter.post('/', async (req, res) => {
  const { user } = req as AuthedRequest;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  if (!message) {
    res.status(400).json({ error: 'Введите текст сообщения' });
    return;
  }

  const record = createSupportMessage(user.telegram_id, message);

  const senderName = [user.first_name, user.username ? `@${user.username}` : null]
    .filter(Boolean)
    .join(' ');
  await notifyAdmins(
    `🆘 <b>Сообщение в поддержку</b>\nОт: ${senderName} (ID ${user.telegram_id})${user.phone ? `, ${user.phone}` : ''}\n\n${message}`
  );

  res.status(201).json({ message: record });
});
