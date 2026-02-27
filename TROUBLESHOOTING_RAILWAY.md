# Railway Deployment Troubleshooting Guide

## What specific issues are you facing?

Tell me which error(s) you're seeing and I'll provide the fix:

---

## Common Issue #1: "Cannot find module" or Build Fails

### Symptoms:
```
Error: Cannot find module 'tsx'
Module not found: Can't resolve 'express'
```

### Cause:
Dependencies not installed correctly in Railway

### Fix:
1. Check your `package.json` has all dependencies (not devDependencies)
2. In Railway dashboard → **Settings** → **Build Command**:
   ```bash
   npm ci && npm run build
   ```
3. Ensure `nixpacks.toml` specifies Node 20:
   ```toml
   [phases.setup]
   nixPkgs = ["nodejs-20_x", "ffmpeg-full"]
   ```

✅ Your app: **Already configured correctly**

---

## Common Issue #2: "Stripe connection not found"

### Symptoms:
```
Error: Stripe connection not found (tried: env vars, connector development)
FATAL: Live mode required but no LIVE Stripe credentials found
```

### Cause:
Railway doesn't have the Replit Stripe connector. Need direct API keys.

### Fix:
In Railway dashboard → Your service → **Variables**, add:

```bash
STRIPE_SECRET_KEY=sk_live_xxxxx   # Your actual Stripe secret key
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET_LIVE=whsec_xxxxx
```

**Get these from:**
1. [Stripe Dashboard](https://dashboard.stripe.com/apikeys)
2. For webhook secret: [Stripe Webhooks](https://dashboard.stripe.com/webhooks)
   - Create new endpoint: `https://your-app.up.railway.app/webhooks/stripe`

✅ Your code: **Already handles env vars as fallback**

---

## Common Issue #3: Database Connection Error

### Symptoms:
```
Error: getaddrinfo ENOTFOUND
Connection terminated unexpectedly
DATABASE_URL is not set
```

### Cause:
PostgreSQL not added to Railway project OR wrong connection string

### Fix:
1. In Railway project, click **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Railway auto-generates `DATABASE_URL` variable
3. Restart your service
4. Run migrations:
   ```bash
   railway run npm run db:push
   ```

**Verify connection string format:**
```
postgresql://username:password@hostname:port/database
```

NOT:
```
postgres://...  ❌ (missing 'ql')
postgresql://...?sslmode=require  ⚠️ (Railway handles SSL automatically)
```

---

## Common Issue #4: App Starts but Returns 404

### Symptoms:
- Build succeeds
- Server starts
- But all routes return 404
- Or blank page

### Cause:
Static files not served or wrong build output

### Fix:
1. Check build output exists:
   ```bash
   railway run ls -la dist/
   ```
   Should show: `dist/index.cjs` and `dist/public/`

2. Verify start command in Railway:
   ```bash
   node dist/index.cjs
   ```
   OR
   ```bash
   npm run start
   ```

3. Check `script/build.ts` copies static files to `dist/public/`

✅ Your app: **Build script already configured**

---

## Common Issue #5: Environment Variables Not Loaded

### Symptoms:
```
WorkOS is not configured
OpenAI API key missing
Email service unavailable
```

### Cause:
Environment variables not set in Railway

### Fix:
1. Go to Railway dashboard → Your service → **Variables**
2. Click **"RAW Editor"**
3. Copy entire contents of `.env.railway.example`
4. Paste and replace all `your-key-here` placeholders with actual values

**Required minimum variables:**
```bash
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
WORKOS_API_KEY=sk_...
WORKOS_CLIENT_ID=client_...
APP_URL=https://your-app.up.railway.app
```

**Optional (for full features):**
- `OPENAI_API_KEY` - Growth agent
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` - Email
- `TWITTER_*` - Social media posting
- `EBAY_*` - Marketplace
- `CARDHEDGE_API_KEY` - Card data

---

## Common Issue #6: WebSocket Connection Fails

### Symptoms:
```
WebSocket connection to 'wss://...' failed
Unexpected server response: 502
```

### Cause:
Railway needs WebSocket configuration

### Fix:
Railway supports WebSockets by default, but ensure:

1. Your `server/index.ts` creates HTTP server:
   ```typescript
   const httpServer = createServer(app);
   setupWebSocket(httpServer);
   httpServer.listen(port);
   ```
   ✅ **Already configured**

2. Client connects to correct URL:
   ```javascript
   const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
   const ws = new WebSocket(`${protocol}//${window.location.host}`);
   ```

---

## Common Issue #7: FFmpeg Not Found

### Symptoms:
```
Error: Cannot find ffmpeg
spawn ffmpeg ENOENT
```

### Cause:
FFmpeg not installed on Railway

### Fix:
Ensure `nixpacks.toml` includes FFmpeg:
```toml
[phases.setup]
nixPkgs = ["nodejs-20_x", "ffmpeg-full"]
```

✅ Your app: **Already configured with ffmpeg-full**

Your code uses `ffmpeg-static` npm package as fallback, which bundles FFmpeg binary.

---

## Common Issue #8: Session/Auth Errors

### Symptoms:
```
Error: connect-pg-simple
Session store error
Failed to authenticate
```

### Cause:
Session table not created or session secret missing

### Fix:
1. **Run migrations to create session table:**
   ```bash
   railway run npm run db:push
   ```

2. **Add session secret to Railway variables:**
   ```bash
   SESSION_SECRET=your-random-32-char-string-here
   ```

3. **Check `server/index.ts` session config:**
   ```typescript
   app.use(session({
     store: new pgStore({
       conString: process.env.DATABASE_URL
     }),
     secret: process.env.SESSION_SECRET || 'fallback-dev-secret'
   }));
   ```

---

## Common Issue #9: Deployment Succeeds but App Crashes

### Symptoms:
- Build: ✅ Success
- Deploy: ✅ Success
- But app crashes immediately with exit code 1

### Cause:
Runtime error (missing env var, database connection, etc.)

### Fix:
**View logs:**
```bash
railway logs
```

OR in dashboard: Your service → **Deployments** → Click latest → **View Logs**

**Common crash causes:**
- `DATABASE_URL` missing → Add PostgreSQL service
- `STRIPE_SECRET_KEY` missing → Add Stripe keys
- Port not binding → Check `process.env.PORT` usage

**Enable debug mode:**
Add to Railway variables:
```bash
DEBUG=*
LOG_LEVEL=debug
```

---

## Quick Diagnosis Commands

Run these from Railway CLI or dashboard shell:

```bash
# Check Node version
railway run node --version

# Check env vars (safe ones)
railway run node -e "console.log('PORT:', process.env.PORT); console.log('NODE_ENV:', process.env.NODE_ENV);"

# Test database connection
railway run node -e "const {Pool}=require('pg'); const p=new Pool({connectionString:process.env.DATABASE_URL}); p.query('SELECT NOW()').then(r=>console.log('✅ DB connected:',r.rows[0])).catch(e=>console.error('❌ DB error:',e));"

# Check if dist/ was built
railway run ls -la dist/

# Check FFmpeg
railway run which ffmpeg
```

---

## Still Stuck?

### Option 1: Share Your Error
Tell me:
1. **Exact error message** from logs
2. **What step you're on** (build, deploy, runtime)
3. **What you've tried** so far

### Option 2: Enable Full Debug
Add to Railway variables:
```bash
DEBUG=express:*,drizzle:*,stripe:*
LOG_LEVEL=debug
```

Then send me the logs.

### Option 3: Compare with Working Replit
```bash
# On Replit, check what env vars are set:
env | grep -E "STRIPE|DATABASE|WORKOS|REPLIT" | sort
```

Copy those (except REPLIT_* ones) to Railway.

---

## Railway-Specific Gotchas

| Replit Feature | Railway Equivalent |
|----------------|-------------------|
| Secrets Tab | Variables Tab |
| PostgreSQL (built-in) | Add as service |
| Stripe Connector | Direct API keys in variables |
| `REPLIT_DB_URL` | Use `${{Postgres.DATABASE_URL}}` |
| Auto-restart | Automatic (with health checks) |
| `.replit` file | Use `railway.json` |
| Nix packages | Use `nixpacks.toml` |

---

## Deployment Checklist

Before asking for help, verify:

- [ ] PostgreSQL service added to Railway project
- [ ] At least 7 critical env vars set (see Issue #5)
- [ ] Build succeeds (green checkmark in Railway)
- [ ] Migrations ran (`railway run npm run db:push`)
- [ ] Viewed deployment logs (`railway logs`)
- [ ] App URL accessible (may need to wait 2-3 min after first deploy)
- [ ] Checked for typos in environment variables

---

**What specific error are you seeing?** Share the logs and I'll help debug.
