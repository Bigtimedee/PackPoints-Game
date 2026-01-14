# WorkOS Integration Guide

This document describes how to set up and configure WorkOS authentication for PackPoints.

## Overview

WorkOS has been integrated as a third authentication method alongside existing Replit OAuth and local username/password authentication. This integration uses WorkOS AuthKit (User Management) with the redirect-based OAuth flow.

## Prerequisites

1. A WorkOS account with User Management enabled
2. Access to the WorkOS Dashboard

## Environment Variables

Add the following secrets to your Replit project:

| Variable | Description | Example |
|----------|-------------|---------|
| `WORKOS_API_KEY` | Your WorkOS API key (starts with `sk_`) | `sk_live_xxx...` |
| `WORKOS_CLIENT_ID` | Your WorkOS Client ID (starts with `client_`) | `client_xxx...` |
| `WORKOS_REDIRECT_URI` | Callback URL for OAuth (optional, auto-detected) | `https://your-domain.replit.app/api/auth/workos/callback` |

## WorkOS Dashboard Configuration

1. Go to [WorkOS Dashboard](https://dashboard.workos.com)
2. Navigate to **User Management** > **Authentication**
3. Under **Redirect URIs**, add:
   - `https://your-domain.replit.app/api/auth/workos/callback`
   - For development: `https://your-repl-name.your-username.repl.co/api/auth/workos/callback`

4. Configure your authentication methods (Email + Password, Google, etc.)

## Files Modified

### Backend
- `server/services/workosAuth.ts` - WorkOS route handlers (start, callback, logout)
- `server/storage.ts` - Added `getUserByWorkosId`, `createWorkosUser`, `linkWorkosUser` methods
- `server/replit_integrations/auth/storage.ts` - Added `getUserByWorkosId` to AuthStorage
- `server/replit_integrations/auth/routes.ts` - Updated `/api/auth/user` to check WorkOS sessions
- `server/index.ts` - Registered WorkOS routes
- `shared/schema.ts` - Added `workosUserId` column to users table

### Frontend
- `client/src/pages/auth.tsx` - Added "Continue with WorkOS" button
- `client/src/pages/auth-success.tsx` - New page for post-login redirect handling
- `client/src/App.tsx` - Added `/auth/success` route

### Database
- Added `workos_user_id` column to `users` table (varchar, unique, nullable)

## Authentication Flow

1. User clicks "Continue with WorkOS" on login page
2. Browser redirects to `GET /api/auth/workos/start`
3. Server generates CSRF state, stores in session, redirects to WorkOS hosted login
4. User authenticates via WorkOS (email/password, Google, etc.)
5. WorkOS redirects back to `GET /api/auth/workos/callback` with authorization code
6. Server validates state, exchanges code for user info via WorkOS SDK
7. Server upserts/links local user record:
   - If user exists by `workosUserId` -> use that user
   - If user exists by email -> link WorkOS ID to existing user
   - Otherwise -> create new user
8. Server sets `localUserId` and `workosUserId` in session
9. Browser redirects to `/auth/success` which fetches user and redirects to app

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/auth/workos/start` | GET | Initiates WorkOS OAuth flow |
| `/api/auth/workos/callback` | GET | Handles OAuth callback from WorkOS |
| `/api/auth/workos/logout` | POST | Logs out WorkOS user and destroys session |

## Session Handling

WorkOS authentication uses the same session mechanism as local auth:
- `req.session.localUserId` - The local user ID (set for all auth methods)
- `req.session.workosUserId` - The WorkOS user ID (set only for WorkOS auth)

The `isAuthenticated` middleware checks for `localUserId` first, so WorkOS users are treated the same as local users for route protection.

## User Linking Policy

- If a logged-in user authenticates via WorkOS with a matching email, the accounts are linked
- If email is already linked to a different WorkOS account, authentication fails with `email_conflict`
- New users are created with a unique username derived from their email

## Testing

1. Ensure environment variables are set
2. Click "Continue with WorkOS" on the login page
3. Complete authentication via WorkOS hosted login
4. Verify redirect to `/auth/success` then to home page
5. Verify `/api/auth/user` returns the logged-in user with `workosUserId` populated
6. Test logout via regular logout flow

## Troubleshooting

### "WorkOS is not configured" error
- Ensure `WORKOS_API_KEY` and `WORKOS_CLIENT_ID` are set in Replit secrets

### State mismatch error
- This indicates a potential CSRF attack or session issue
- Try clearing cookies and attempting again

### Email conflict error
- The email is already linked to a different WorkOS user
- Contact support to resolve account conflicts

## Future Enhancements (Optional)

The schema supports future SSO/Organization features:
- Organization-based authentication
- Enterprise SSO via SAML/OIDC
- Directory Sync for user provisioning
