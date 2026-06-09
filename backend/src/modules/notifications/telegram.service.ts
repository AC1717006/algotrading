import TelegramBot from 'node-telegram-bot-api';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'Telegram' });

class TelegramService {
  private bot: TelegramBot | null = null;
  private enabled = false;

  constructor() {
    if (config.TELEGRAM_BOT_TOKEN && config.TELEGRAM_CHAT_ID) {
      try {
        this.bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: false });
        this.enabled = true;
        log.info('Telegram bot initialized');
      } catch (err) {
        log.warn('Telegram bot init failed', { err });
      }
    } else {
      log.debug('Telegram not configured — notifications disabled');
    }
  }

  async notify(message: string): Promise<void> {
    if (!this.enabled || !this.bot || !config.TELEGRAM_CHAT_ID) return;
    try {
      await this.bot.sendMessage(config.TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' });
    } catch (err) {
      log.error('Telegram send failed', { err });
    }
  }

  async alert(title: string, body: string): Promise<void> {
    await this.notify(`${title}\n${body}`);
  }

  async sendDailySummary(
    mode: string,
    dailyPnl: number,
    totalTrades: number,
    winRate: number,
    balance: number,
  ): Promise<void> {
    const icon = dailyPnl >= 0 ? '🟢' : '🔴';
    await this.notify(
      `📊 *Daily Summary* — ${new Date().toLocaleDateString('en-IN')}\n` +
      `Mode: ${mode}\n` +
      `${icon} P&L: ₹${dailyPnl.toFixed(2)}\n` +
      `Trades: ${totalTrades} | Win Rate: ${winRate.toFixed(1)}%\n` +
      `Balance: ₹${balance.toFixed(2)}`,
    );
  }
}

export const telegramService = new TelegramService();
