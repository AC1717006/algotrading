import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import swaggerJSDoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { apiLimiter } from './middleware/rateLimiter';
import { errorHandler, notFound } from './middleware/errorHandler';
import routes from './routes';

export function createApp() {
  const app = express();

  // ─── Security ───────────────────────────────────────────────────────────────
  app.use(helmet());
  app.use(cors({
    origin: config.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }));
  app.set('trust proxy', 1);

  // ─── Body / Compression ─────────────────────────────────────────────────────
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(compression());

  // ─── Logging ─────────────────────────────────────────────────────────────────
  if (config.NODE_ENV !== 'test') {
    app.use(morgan('combined'));
  }

  // ─── Rate Limiting ───────────────────────────────────────────────────────────
  app.use('/api', apiLimiter);

  // ─── Swagger ─────────────────────────────────────────────────────────────────
  const swaggerSpec = swaggerJSDoc({
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'AlgoTrading Platform API',
        version: '1.0.0',
        description: 'Production-ready algorithmic trading platform with Upstox integration',
        contact: { name: 'Admin', email: config.ADMIN_EMAIL },
      },
      servers: [{ url: `/api`, description: 'Current server' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    apis: ['./src/modules/**/*.routes.ts', './src/routes/*.ts'],
  });

  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

  // ─── Routes ──────────────────────────────────────────────────────────────────
  app.use('/api', routes);

  // ─── Error Handling ──────────────────────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
