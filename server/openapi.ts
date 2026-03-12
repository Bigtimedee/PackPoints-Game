/**
 * OpenAPI 3.0 specification for PackPTS API.
 * Hand-authored static spec — no swagger-ui-express needed.
 *
 * Served at GET /api/docs (JSON) when NODE_ENV !== 'production' or SHOW_API_DOCS=true
 *
 * To add Swagger UI in the future:
 *   npm install swagger-ui-express @types/swagger-ui-express
 *   import swaggerUi from 'swagger-ui-express';
 *   app.use('/api/docs/ui', swaggerUi.serve, swaggerUi.setup(openApiSpec));
 */

export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'PackPTS API',
    version: '1.0.0',
    description: 'Sports card trivia game API. Players guess players from card images to earn redeemable PackPTS.',
    contact: { name: 'PackPTS Support' },
  },
  servers: [
    { url: '/api', description: 'Current server' },
  ],
  components: {
    securitySchemes: {
      session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'Session cookie set after authentication',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          message: { type: 'string' },
        },
        required: ['message'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          username: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['user', 'admin'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      WalletBalance: {
        type: 'object',
        properties: {
          balance: { type: 'integer', description: 'Current PackPTS balance' },
          lifetimeEarned: { type: 'integer' },
          lifetimeSpent: { type: 'integer' },
        },
      },
      GameQuestion: {
        type: 'object',
        properties: {
          cardId: { type: 'integer' },
          imageUrl: { type: 'string', format: 'uri' },
          options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          timeLimit: { type: 'integer', description: 'Seconds to answer' },
        },
      },
      AnswerResult: {
        type: 'object',
        properties: {
          correct: { type: 'boolean' },
          correctAnswer: { type: 'string' },
          pointsEarned: { type: 'integer' },
          explanation: { type: 'string' },
        },
      },
      LeaderboardEntry: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          username: { type: 'string' },
          points: { type: 'integer' },
          gamesPlayed: { type: 'integer' },
        },
      },
    },
  },
  security: [{ session: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': {
            description: 'System is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    timestamp: { type: 'string', format: 'date-time' },
                    database: { type: 'string', example: 'connected' },
                    stripe: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current authenticated user',
        responses: {
          '200': { description: 'Authenticated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '401': { description: 'Not authenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a new account',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'email', 'password'],
                properties: {
                  username: { type: 'string', minLength: 3, maxLength: 30 },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Account created', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Username or email already taken', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Log in with credentials',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Logged in', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Authentication'],
        summary: 'Log out current session',
        responses: {
          '200': { description: 'Logged out successfully' },
        },
      },
    },
    '/game/start': {
      post: {
        tags: ['Game'],
        summary: 'Start a new solo game session',
        responses: {
          '200': {
            description: 'Game started',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    question: { $ref: '#/components/schemas/GameQuestion' },
                  },
                },
              },
            },
          },
          '401': { description: 'Not authenticated' },
          '429': { description: 'Rate limited' },
        },
      },
    },
    '/game/answer': {
      post: {
        tags: ['Game'],
        summary: 'Submit an answer for the current question',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sessionId', 'answer'],
                properties: {
                  sessionId: { type: 'string' },
                  answer: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Answer result', content: { 'application/json': { schema: { $ref: '#/components/schemas/AnswerResult' } } } },
        },
      },
    },
    '/leaderboard': {
      get: {
        tags: ['Game'],
        summary: 'Get global leaderboard',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'period', in: 'query', schema: { type: 'string', enum: ['all', 'weekly', 'daily'], default: 'all' } },
        ],
        responses: {
          '200': {
            description: 'Leaderboard entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    entries: { type: 'array', items: { $ref: '#/components/schemas/LeaderboardEntry' } },
                    total: { type: 'integer' },
                    page: { type: 'integer' },
                    pageSize: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/wallet': {
      get: {
        tags: ['Wallet'],
        summary: 'Get current user wallet balance and history',
        responses: {
          '200': { description: 'Wallet data', content: { 'application/json': { schema: { $ref: '#/components/schemas/WalletBalance' } } } },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/profile/stats': {
      get: {
        tags: ['Profile'],
        summary: 'Get profile statistics for current user',
        responses: {
          '200': {
            description: 'Profile stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string' },
                    points: { type: 'integer' },
                    gamesPlayed: { type: 'integer' },
                    correctAnswers: { type: 'integer' },
                    totalAnswers: { type: 'integer' },
                    rank: { type: 'integer' },
                    level: { type: 'integer' },
                    pointsToNextLevel: { type: 'integer' },
                    levelProgress: { type: 'number' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/lobby': {
      post: {
        tags: ['Multiplayer'],
        summary: 'Create a new game lobby',
        responses: {
          '201': {
            description: 'Lobby created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    lobbyId: { type: 'string' },
                    joinCode: { type: 'string', description: '6-character code for friends to join' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/lobby/{lobbyId}': {
      get: {
        tags: ['Multiplayer'],
        summary: 'Get lobby status',
        parameters: [
          { name: 'lobbyId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Lobby state' },
          '404': { description: 'Lobby not found' },
        },
      },
    },
    '/admin/dashboard': {
      get: {
        tags: ['Admin'],
        summary: 'Get admin dashboard metrics',
        responses: {
          '200': { description: 'Dashboard metrics' },
          '403': { description: 'Not admin' },
        },
      },
    },
  },
  tags: [
    { name: 'System', description: 'Health and system status' },
    { name: 'Authentication', description: 'User registration, login, and session management' },
    { name: 'Game', description: 'Solo game play, questions, and leaderboard' },
    { name: 'Wallet', description: 'PackPTS balance, transactions, and redemption' },
    { name: 'Profile', description: 'User statistics and achievements' },
    { name: 'Multiplayer', description: 'Lobbies, matchmaking, and 1v1 matches' },
    { name: 'Admin', description: 'Admin-only management endpoints' },
  ],
};

/**
 * Register the /api/docs endpoint on an Express app.
 * Only available in development or when SHOW_API_DOCS=true.
 */
export function registerOpenApiRoute(app: any): void {
  const shouldShow = process.env.NODE_ENV !== 'production' || process.env.SHOW_API_DOCS === 'true';
  if (!shouldShow) return;

  app.get('/api/docs', (_req: any, res: any) => {
    res.json(openApiSpec);
  });

  app.get('/api/docs.html', (_req: any, res: any) => {
    // Serve a simple Swagger UI via CDN (no npm package needed)
    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>PackPTS API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" >
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"> </script>
<script>
  SwaggerUIBundle({
    url: "/api/docs",
    dom_id: '#swagger-ui',
    presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
    layout: "StandaloneLayout"
  })
</script>
</body>
</html>`);
  });

  console.log('[OpenAPI] Docs available at /api/docs (JSON) and /api/docs.html (UI)');
}
