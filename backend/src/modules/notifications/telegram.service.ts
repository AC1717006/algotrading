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

  // ─── Phase 8: Structured notification methods ─────────────────────────────────

  async notifyBuy(symbol: string, qty: number, price: number, mode: string): Promise<void> {
    await this.notify(
      `📈 *BUY* [${mode}]\n` +
      `Symbol: ${symbol}\n` +
      `Qty: ${qty} @ ₹${price.toFixed(2)}`,
    );
  }

  async notifySell(symbol: string, qty: number, price: number, pnl: number, mode: string): Promise<void> {
    const icon = pnl >= 0 ? '🟢' : '🔴';
    await this.notify(
      `📉 *SELL* [${mode}]\n` +
      `Symbol: ${symbol}\n` +
      `Qty: ${qty} @ ₹${price.toFixed(2)}\n` +
      `${icon} P&L: ₹${pnl.toFixed(2)}`,
    );
  }

  async notifySlHit(symbol: string, price: number, pnl: number): Promise<void> {
    await this.notify(
      `⛔ *SL HIT*\n` +
      `Symbol: ${symbol}\n` +
      `Exit: ₹${price.toFixed(2)}\n` +
      `P&L: ₹${pnl.toFixed(2)}`,
    );
  }

  async notifyTargetHit(symbol: string, price: number, pnl: number): Promise<void> {
    await this.notify(
      `🎯 *TARGET HIT*\n` +
      `Symbol: ${symbol}\n` +
      `Exit: ₹${price.toFixed(2)}\n` +
      `P&L: ₹${pnl.toFixed(2)}`,
    );
  }

  async notifyForceExit(symbol: string, reason: string): Promise<void> {
    await this.notify(
      `🔔 *FORCE EXIT* — ${reason}\n` +
      `Symbol: ${symbol}`,
    );
  }

  async notifySignal(
    strategyName: string,
    type: string,
    symbol: string,
    price: number,
    sl?: number,
    target?: number,
  ): Promise<void> {
    await this.notify(
      `📊 *${type}* Signal — ${strategyName}\n` +
      `Symbol: ${symbol}\n` +
      `Price: ₹${price.toFixed(2)}\n` +
      `Stop Loss: ₹${sl?.toFixed(2) ?? 'N/A'}\n` +
      `Target: ₹${target?.toFixed(2) ?? 'N/A'}`,
    );
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
