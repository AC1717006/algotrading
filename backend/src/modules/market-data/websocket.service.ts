import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { Server } from 'http';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { upstoxClient } from '../broker/upstox.client';
import { paperEngine } from '../trading/paper-engine';
import { marketDataService } from './market-data.service';
import { logger } from '../../utils/logger';
import { JwtPayload, WsMessage } from '../../types';
import { prisma } from '../../database/client';

const log = logger.child({ category: 'WebSocket' });

interface AlgoClient extends WebSocket {
  userId: string;
  isAlive: boolean;
  subscriptions: Set<string>;
}

export class WebSocketService {
  private wss: WebSocketServer;
  private upstoxFeed: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });
    this.setupClientHandlers();
    this.startHeartbeat();
  }

  private setupClientHandlers(): void {
    this.wss.on('connection', (rawWs: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      const ws = rawWs as AlgoClient;

      if (!token) {
        ws.close(4001, 'Token required');
        return;
      }

      try {
        const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
        ws.userId = payload.sub;
        ws.isAlive = true;
        ws.subscriptions = new Set();
        log.info('Client connected', { userId: payload.sub });
      } catch {
        ws.close(4001, 'Invalid token');
        return;
      }

      ws.on('pong', () => { ws.isAlive = true; });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type: string; symbols?: string[] };
          if (msg.type === 'SUBSCRIBE' && Array.isArray(msg.symbols)) {
            msg.symbols.forEach((s) => ws.subscriptions.add(s));
            log.debug('Client subscribed', { userId: ws.userId, symbols: msg.symbols });
          }
          if (msg.type === 'UNSUBSCRIBE' && Array.isArray(msg.symbols)) {
            msg.symbols.forEach((s) => ws.subscriptions.delete(s));
          }
          if (msg.type === 'PING') {
            this.sendTo(ws, { type: 'ALERT', payload: { message: 'pong' }, timestamp: Date.now() });
          }
        } catch { /* ignore malformed */ }
      });

      ws.on('close', () => log.info('Client disconnected', { userId: ws.userId }));
      ws.on('error', (e) => log.error('Client error', { userId: ws.userId, e }));

      // Send initial welcome
      this.sendTo(ws, {
        type: 'ALERT',
        payload: { message: 'Connected to AlgoTrader live feed', userId: ws.userId },
        timestamp: Date.now(),
      });
    });
  }

  private startHeartbeat(): void {
    setInterval(() => {
      this.wss.clients.forEach((raw) => {
        const ws = raw as AlgoClient;
        if (!ws.isAlive) { ws.terminate(); return; }
        ws.isAlive = false;
        ws.ping();
      });
    }, 30_000);
  }

  sendTo(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: WsMessage, filter?: { symbol?: string; userId?: string }): void {
    this.wss.clients.forEach((raw) => {
      const ws = raw as AlgoClient;
      if (ws.readyState !== WebSocket.OPEN) return;
      if (filter?.userId && ws.userId !== filter.userId) return;
      if (filter?.symbol && !ws.subscriptions.has(filter.symbol)) return;
      ws.send(JSON.stringify(msg));
    });
  }

  broadcastQuote(symbol: string, ltp: number): void {
    this.broadcast(
      { type: 'QUOTE', payload: { symbol, ltp, timestamp: Date.now() }, timestamp: Date.now() },
      { symbol },
    );
  }

  broadcastOrderUpdate(userId: string, order: unknown): void {
    this.broadcast({ type: 'ORDER_UPDATE', payload: order, timestamp: Date.now() }, { userId });
  }

  broadcastSignal(signal: unknown): void {
    this.broadcast({ type: 'SIGNAL', payload: signal, timestamp: Date.now() });
  }

  broadcastAlert(message: string): void {
    this.broadcast({ type: 'ALERT', payload: { message }, timestamp: Date.now() });
  }

  connectedClients(): number {
    return this.wss.clients.size;
  }

  // ─── Upstox live market feed ─────────────────────────────────────────────────
  async connectUpstoxFeed(instrumentKeys: string[]): Promise<void> {
    if (!instrumentKeys.length) {
      log.warn('No instruments to subscribe — feed not started');
      return;
    }
    try {
      const feedUrl = await upstoxClient.getMarketFeedUrl();
      this.upstoxFeed = new WebSocket(feedUrl);

      this.upstoxFeed.on('open', () => {
        log.info('Upstox market feed connected');
        this.upstoxFeed?.send(JSON.stringify({
          guid: 'market-feed',
          method: 'sub',
          data: { mode: 'full', instrumentKeys },
        }));
      });

      this.upstoxFeed.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as {
            feeds?: Record<string, { ff?: { marketFF?: { ltpc?: { ltp: number } } } }>;
          };

          if (!msg.feeds) return;

          const quotes: Record<string, number> = {};
          for (const [key, feed] of Object.entries(msg.feeds)) {
            const ltp = feed.ff?.marketFF?.ltpc?.ltp;
            if (ltp !== undefined) {
              quotes[key] = ltp;
              marketDataService.setLtp(key, ltp);
              this.broadcastQuote(key, ltp);
            }
          }

          // Update paper positions mark-to-market
          await paperEngine.updatePositionPrices(quotes).catch(() => void 0);
        } catch { /* malformed frame */ }
      });

      this.upstoxFeed.on('close', (code, reason) => {
        log.warn('Upstox feed disconnected — reconnecting in 5s', { code, reason: reason.toString() });
        this.reconnectTimer = setTimeout(() => this.connectUpstoxFeed(instrumentKeys), 5_000);
      });

      this.upstoxFeed.on('error', (e) => {
        log.error('Upstox feed error', { e });
      });
    } catch (err) {
      log.error('Failed to connect Upstox feed', { err });
      this.reconnectTimer = setTimeout(() => this.connectUpstoxFeed(instrumentKeys), 10_000);
    }
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.upstoxFeed?.close();
    this.wss.close();
  }
}
