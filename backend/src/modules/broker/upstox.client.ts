import axios, { AxiosInstance, AxiosError } from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { UpstoxOrderPayload, UpstoxOrderResponse } from '../../types';
import { AppError } from '../../middleware/errorHandler';

const log = logger.child({ category: 'UpstoxClient' });

export class UpstoxClient {
  private http: AxiosInstance;
  private accessToken: string;

  constructor(initialToken = '') {
    this.accessToken = initialToken || config.UPSTOX_ACCESS_TOKEN;

    this.http = axios.create({
      baseURL: config.UPSTOX_BASE_URL,
      timeout: 15_000,
    });

    this.http.interceptors.request.use((cfg) => {
      cfg.headers['Authorization'] = `Bearer ${this.accessToken}`;
      cfg.headers['Accept'] = 'application/json';
      cfg.headers['Api-Version'] = '2.0';
      return cfg;
    });

    this.http.interceptors.response.use(
      (r) => r,
      (err: AxiosError) => {
        if (err.response?.status === 401) {
          log.error('Upstox token invalid or expired');
        }
        return Promise.reject(err);
      },
    );
  }

  setToken(token: string): void {
    this.accessToken = token;
    log.info('Upstox access token updated');
  }

  getToken(): string {
    return this.accessToken;
  }

  // ─── OAuth ───────────────────────────────────────────────────────────────────
  getAuthorizationUrl(): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.UPSTOX_API_KEY,
      redirect_uri: config.UPSTOX_REDIRECT_URI,
    });
    return `https://api.upstox.com/v2/login/authorization/dialog?${params.toString()}`;
  }

  async exchangeAuthCode(code: string): Promise<string> {
    const resp = await axios.post<{ access_token: string }>(
      'https://api.upstox.com/v2/login/authorization/token',
      new URLSearchParams({
        code,
        client_id: config.UPSTOX_API_KEY,
        client_secret: config.UPSTOX_API_SECRET,
        redirect_uri: config.UPSTOX_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    this.setToken(resp.data.access_token);
    return resp.data.access_token;
  }

  // ─── Profile & Account ───────────────────────────────────────────────────────
  async getProfile(): Promise<unknown> {
    const { data } = await this.http.get<{ data: unknown }>('/user/profile');
    return data.data;
  }

  async getFunds(): Promise<unknown> {
    const { data } = await this.http.get<{ data: unknown }>('/user/get-funds-and-margin');
    return data.data;
  }

  async getHoldings(): Promise<unknown> {
    const { data } = await this.http.get<{ data: unknown }>('/portfolio/long-term-holdings');
    return data.data;
  }

  async getPositions(): Promise<unknown> {
    const { data } = await this.http.get<{ data: unknown }>('/portfolio/short-term-positions');
    return data.data;
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────
  async placeOrder(payload: UpstoxOrderPayload): Promise<UpstoxOrderResponse> {
    try {
      const { data } = await this.http.post<{ data: UpstoxOrderResponse }>('/order/place', payload);
      return data.data;
    } catch (err) {
      const ax = err as AxiosError<{ errors: Array<{ message: string }> }>;
      const msg = ax.response?.data?.errors?.[0]?.message ?? 'Upstox order placement failed';
      throw new AppError(502, msg);
    }
  }

  async modifyOrder(orderId: string, updates: Partial<UpstoxOrderPayload>): Promise<UpstoxOrderResponse> {
    try {
      const { data } = await this.http.put<{ data: UpstoxOrderResponse }>('/order/modify', {
        order_id: orderId,
        ...updates,
      });
      return data.data;
    } catch (err) {
      const ax = err as AxiosError<{ errors: Array<{ message: string }> }>;
      throw new AppError(502, ax.response?.data?.errors?.[0]?.message ?? 'Order modification failed');
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.http.delete(`/order/cancel?order_id=${orderId}`);
    } catch {
      throw new AppError(502, 'Order cancellation failed');
    }
  }

  async getOrderDetails(orderId: string): Promise<unknown> {
    const { data } = await this.http.get<{ data: unknown }>(`/order/details?order_id=${orderId}`);
    return data.data;
  }

  async getOrderHistory(): Promise<unknown[]> {
    const { data } = await this.http.get<{ data: unknown[] }>('/order/history');
    return data.data ?? [];
  }

  // ─── Market Data ─────────────────────────────────────────────────────────────
  async getHistoricalCandles(
    instrumentKey: string,
    interval: string,
    toDate: string,
    fromDate: string,
  ): Promise<unknown[][]> {
    const { data } = await this.http.get<{ data: { candles: unknown[][] } }>(
      `/historical-candle/${encodeURIComponent(instrumentKey)}/${interval}/${toDate}/${fromDate}`,
    );
    return data.data?.candles ?? [];
  }

  async getIntradayCandles(
    instrumentKey: string,
    interval: string,
  ): Promise<unknown[][]> {
    const { data } = await this.http.get<{ data: { candles: unknown[][] } }>(
      `/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/${interval}`,
    );
    return data.data?.candles ?? [];
  }

  async getQuotes(instrumentKeys: string[]): Promise<Record<string, unknown>> {
    const { data } = await this.http.get<{ data: Record<string, unknown> }>(
      `/market-quote/quotes?instrument_key=${instrumentKeys.join(',')}`,
    );
    return data.data ?? {};
  }

  async getLtp(instrumentKeys: string[]): Promise<Record<string, unknown>> {
    const { data } = await this.http.get<{ data: Record<string, unknown> }>(
      `/market-quote/ltp?instrument_key=${instrumentKeys.join(',')}`,
    );
    return data.data ?? {};
  }

  // ─── Live Market Feed authorization ──────────────────────────────────────────
  async getMarketFeedUrl(): Promise<string> {
    const { data } = await this.http.get<{ data: { authorized_redirect_uri: string } }>(
      '/feed/market-data-feed',
      {
        baseURL: 'https://api.upstox.com/v3',
      }
    );
    return data.data.authorized_redirect_uri;
  }
}

export const upstoxClient = new UpstoxClient();
