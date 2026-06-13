import axios, { AxiosError } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export const api = axios.create({ baseURL: BASE_URL, timeout: 15_000 });

export const publicApi = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api',
  timeout: 10_000,
});

api.interceptors.request.use((cfg) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) cfg.headers.Authorization = `Bearer ${token}`;
  }
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  async (err: AxiosError) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      const refresh = localStorage.getItem('refresh_token');
      if (refresh) {
        try {
          const { data } = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: refresh });
          const newToken = (data as { data: { accessToken: string } }).data.accessToken;
          localStorage.setItem('access_token', newToken);
          if (err.config) {
            err.config.headers.Authorization = `Bearer ${newToken}`;
            return api.request(err.config);
          }
        } catch {
          localStorage.clear();
          window.location.href = '/login';
        }
      } else {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(err);
  },
);

// ─── API helpers ─────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    api.post<{ data: { accessToken: string; refreshToken: string; user: { id: string; email: string; role: string } } }>('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
};

export const tradingApi = {
  getMode: () => api.get<{ data: { mode: string } }>('/trading/mode'),
  setMode: (mode: string) => api.put('/trading/mode', { mode }),
  getSummary: () => api.get('/trading/summary'),
  getOrders: (params?: Record<string, string>) => api.get('/trading/orders', { params }),
  getTrades: (params?: Record<string, string>) => api.get('/trading/trades', { params }),
  placeOrder: (body: Record<string, unknown>) => api.post('/trading/orders', body),
  cancelOrder: (id: string) => api.post(`/trading/orders/${id}/cancel`),
  resetCircuitBreaker: () => api.post('/trading/risk/reset-circuit-breaker'),
};

export const strategyApi = {
  list: () => api.get('/strategies'),
  create: (body: Record<string, unknown>) => api.post('/strategies', body),
  update: (id: string, body: Record<string, unknown>) => api.put(`/strategies/${id}`, body),
  enable: (id: string) => api.post(`/strategies/${id}/enable`),
  disable: (id: string) => api.post(`/strategies/${id}/disable`),
  delete: (id: string) => api.delete(`/strategies/${id}`),
  signals: (id: string) => api.get(`/strategies/${id}/signals`),
};

export const brokerApi = {
  validate: () => api.get('/broker/validate'),
  account: () => api.get('/broker/account'),
  getAuthUrl: () => api.get('/broker/auth-url'),
  updateToken: (accessToken: string) => api.post('/broker/token', { accessToken }),
};

export const marketApi = {
  candles: (params: Record<string, string>) => api.get('/market/candles', { params }),
  history: (params: { symbol: string; interval?: string; days?: number }) => api.get('/market/history', { params }),
  quotes: (symbols: string) => publicApi.get('/market/quotes', { params: { symbols } }),
  ltp: (symbol?: string) => api.get('/market/ltp', { params: symbol ? { symbol } : {} }),
};

export const systemApi = {
  metrics: () => api.get('/system/metrics'),
};

export const s3Api = {
  listFiles: (prefix?: string) => api.get('/s3/files', { params: prefix ? { prefix } : {} }),
  generateReport: () => api.post('/s3/reports/generate'),
  getReportUrl: (key: string) => api.get('/s3/presign', { params: { key } }),
};

export const logsApi = {
  list: (params?: Record<string, string>) => api.get('/logs', { params }),
  audit: (params?: Record<string, string>) => api.get('/logs/audit', { params }),
};

export const settingsApi = {
  list: () => api.get('/settings'),
  update: (key: string, value: string) => api.put(`/settings/${key}`, { value }),
  updateBulk: (updates: Record<string, string>) => api.put('/settings/bulk/update', updates),
};
