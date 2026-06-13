import Redis from 'ioredis';
import { prisma, redis } from '../../database/client';
import { upstoxClient } from './upstox.client';
import { s3Service } from '../s3/s3.service';
import { logger } from '../../utils/logger';

const log = logger.child({ category: 'BrokerService' });

// Pub/sub channel used to hot-reload the Upstox access token across all PM2
// cluster instances without a process restart (see saveToken/initTokenSync).
const TOKEN_UPDATE_CHANNEL = 'broker:token-updated';

export class BrokerService {
  private subscriber: Redis | null = null;

  /**
   * Subscribes this instance to broker token updates so that when any other
   * instance (or the token-refresh script via POST /broker/token) saves a
   * new Upstox token, every instance's in-memory UpstoxClient is updated
   * immediately — no PM2 restart required.
   */
  async initTokenSync(): Promise<void> {
    this.subscriber = redis.duplicate();
    await this.subscriber.subscribe(TOKEN_UPDATE_CHANNEL);
    this.subscriber.on('message', (_channel: string, token: string) => {
      if (!token) return;
      upstoxClient.setToken(token);
      log.info('Upstox access token hot-reloaded via pub/sub');
    });
    log.info('Subscribed to broker token update channel', { channel: TOKEN_UPDATE_CHANNEL });
  }

  async validateToken(): Promise<boolean> {
    try {
      await upstoxClient.getProfile();
      await prisma.setting.update({ where: { key: 'upstox_token_valid' }, data: { value: 'true' } });
      return true;
    } catch {
      await prisma.setting.update({ where: { key: 'upstox_token_valid' }, data: { value: 'false' } }).catch(() => void 0);
      return false;
    }
  }

  async saveToken(token: string): Promise<void> {
    upstoxClient.setToken(token);

    // Persist in DB settings
    await prisma.setting.upsert({
      where: { key: 'upstox_access_token' },
      update: { value: token },
      create: { key: 'upstox_access_token', value: token, description: 'Current Upstox access token' },
    });
    await prisma.setting.update({ where: { key: 'upstox_token_valid' }, data: { value: 'true' } }).catch(() => void 0);

    // Notify all PM2 cluster instances to hot-reload the in-memory token.
    await redis.publish(TOKEN_UPDATE_CHANNEL, token).catch((err) => {
      log.warn('Failed to publish token update — other instances will pick it up from DB on next loadTokenFromDb', { err });
    });

    // Backup to S3
    try {
      const date = new Date().toISOString().split('T')[0];
      await s3Service.uploadJson(`tokens/upstox-token-${date}.json`, { token, savedAt: new Date().toISOString() });
      log.info('Token backed up to S3');
    } catch (err) {
      log.warn('S3 token backup failed', { err });
    }
  }

  async handleOAuthCallback(code: string): Promise<string> {
    const token = await upstoxClient.exchangeAuthCode(code);
    await this.saveToken(token);
    return token;
  }

  async getAccountSummary() {
    const [profile, funds, positions, holdings] = await Promise.allSettled([
      upstoxClient.getProfile(),
      upstoxClient.getFunds(),
      upstoxClient.getPositions(),
      upstoxClient.getHoldings(),
    ]);

    return {
      profile: profile.status === 'fulfilled' ? profile.value : null,
      funds: funds.status === 'fulfilled' ? funds.value : null,
      positions: positions.status === 'fulfilled' ? positions.value : null,
      holdings: holdings.status === 'fulfilled' ? holdings.value : null,
    };
  }

  async loadTokenFromDb(): Promise<void> {
    try {
      const setting = await prisma.setting.findUnique({ where: { key: 'upstox_access_token' } });
      if (setting?.value) {
        upstoxClient.setToken(setting.value);
        log.info('Upstox token loaded from database');
      }
    } catch {
      log.warn('Could not load Upstox token from DB');
    }
  }
}

export const brokerService = new BrokerService();
