// Jest test environment setup — provides the minimum env vars required by src/config/index.ts
// so that module imports don't call process.exit(1).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-chars!';
process.env.UPSTOX_API_KEY = 'test-api-key';
process.env.UPSTOX_API_SECRET = 'test-api-secret';
process.env.UPSTOX_REDIRECT_URI = 'http://localhost:4000/api/broker/callback';
