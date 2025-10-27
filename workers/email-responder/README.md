# Arugami Email Auto-Responder Worker

Cloudflare Worker that handles emails to `hello@arugami.com`.

## What It Does

1. **Forwards** all emails to `jordan@arugami.com` (so you still get everything)
2. **Sends** a branded auto-reply to anyone who emails you

## Deployment

### First Time Setup

1. **Install Wrangler CLI** (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**:
   ```bash
   wrangler login
   ```

3. **Navigate to worker directory**:
   ```bash
   cd workers/email-responder
   ```

4. **Deploy the worker**:
   ```bash
   npm run deploy
   ```

### Configure Email Routing

After deploying, go to Cloudflare Dashboard:

1. Navigate to **Email Routing** → **Routes**
2. Edit the `hello@arugami.com` route
3. Change action from "Send to an email" to **"Send to Worker"**
4. Select `arugami-email-responder` worker
5. Save changes

## Testing

Send a test email to `hello@arugami.com` and you should:
- Receive the email in `jordan@arugami.com` inbox
- Sender receives a branded auto-reply instantly

## Auto-Reply Features

✅ **Branded Design** - Matches Arugami visual identity
✅ **Reynolds Voice** - Self-aware, conversational tone
✅ **W+K Style** - Bold, cinematic messaging
✅ **Mobile Responsive** - Looks great on any device
✅ **CTA Button** - Links back to arugami.com
✅ **Quick Response** - Sends within seconds

## Customizing the Message

Edit `src/index.js` to change:
- Email subject line
- Body copy
- Design/styling
- CTA button text/link

After changes, redeploy:
```bash
npm run deploy
```

## Cost

Cloudflare Workers Email Routing is **FREE** for up to 1,000 emails/day.
(More than enough for lead generation)
