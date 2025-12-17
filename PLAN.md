# Web Landing Page for QR Code Scans

## Problem
When someone scans a disc's QR code but doesn't have the AceBack app installed, they need a graceful experience that:
1. Shows them the disc information
2. Directs them to install the app
3. Deep links them to the right place after install

## Solution Architecture

### Overview
Create a lightweight web landing page at `aceback.app/d/[code]` that:
- Displays disc preview information (using existing `lookup-qr-code` endpoint)
- Shows Smart App Banner (iOS) and install prompts
- Handles deferred deep linking via query params stored in localStorage

### Components

#### 1. New Web Repository (`discr/web`)
Simple Next.js or static site with:
- Single dynamic route: `/d/[code]`
- Mobile-first responsive design
- Smart App Banner meta tags for iOS
- Android install detection and Play Store redirect

#### 2. Landing Page Features
```
/d/[code]
├── Fetches disc info from lookup-qr-code API
├── Displays:
│   ├── Disc photo (if available)
│   ├── Disc name, manufacturer, color
│   ├── "Found this disc?" messaging
│   └── Install CTA buttons
├── iOS: Smart App Banner (meta tag)
├── Android: Play Store button
└── Deferred deep link storage (localStorage)
```

#### 3. Deep Link Flow

**User WITH app installed:**
1. Scans QR → `https://aceback.app/d/ABC123`
2. Universal Links / App Links intercept
3. App opens directly to scan result screen

**User WITHOUT app installed:**
1. Scans QR → `https://aceback.app/d/ABC123`
2. Web page loads (Universal Links don't intercept)
3. User sees disc preview + install prompt
4. Code `ABC123` stored in localStorage
5. User installs app from store
6. On first app open, app checks for deferred deep link
7. If found, navigates to scan result for that code

### Implementation Steps

#### Phase 1: Web Landing Page
1. Create new repo `discr/web`
2. Set up Next.js with App Router (simple, deploys anywhere)
3. Create `/d/[code]/page.tsx` route
4. Integrate with `lookup-qr-code` API
5. Design mobile-first landing page UI
6. Add Smart App Banner meta tag for iOS
7. Add Play Store button for Android
8. Store code in localStorage for deferred linking

#### Phase 2: Mobile App Updates
1. Add deferred deep link check on app startup
2. Check localStorage via WebView or use a linking solution
3. Navigate to scan result if deferred code found
4. Clear deferred code after handling

#### Phase 3: Deployment & DNS
1. Deploy web app to Vercel/Cloudflare Pages
2. Configure DNS for `aceback.app` domain
3. Ensure AASA file (iOS) and assetlinks.json (Android) are served
4. Test Universal Links / App Links still work

### Technical Details

#### Smart App Banner (iOS)
```html
<meta name="apple-itunes-app" content="app-id=YOUR_APP_ID, app-argument=com.aceback.app://d/ABC123">
```

#### Deferred Deep Link Storage
```javascript
// On landing page load
localStorage.setItem('aceback_deferred_code', code);

// In mobile app (via expo-linking or checking on startup)
const deferredCode = await getDeferredCode();
if (deferredCode) {
  clearDeferredCode();
  router.push(`/scan-result?code=${deferredCode}`);
}
```

#### API Integration
The `lookup-qr-code` endpoint is already public (no auth required) and returns:
- Disc info (name, manufacturer, color, etc.)
- Photo URL (signed, 1-hour expiry)
- `is_claimable` status
- Owner display name (if not claimable)

### File Structure (New Web Repo)
```
discr/web/
├── app/
│   ├── layout.tsx
│   ├── page.tsx (redirect to main site or 404)
│   └── d/
│       └── [code]/
│           └── page.tsx
├── components/
│   └── DiscPreview.tsx
├── lib/
│   └── api.ts
├── public/
│   ├── .well-known/
│   │   ├── apple-app-site-association
│   │   └── assetlinks.json
│   └── app-icon.png
└── package.json
```

### Questions to Resolve
1. App Store ID (needed for Smart App Banner)
2. Play Store package name (for Android intent)
3. Domain hosting setup (who controls aceback.app DNS?)
4. Deployment preference (Vercel, Cloudflare, AWS?)

### Alternative: Simpler Static Approach
If Next.js feels heavy, could use:
- Plain HTML/CSS/JS with client-side fetch
- 11ty or other static site generator
- Single HTML file deployed to S3/CloudFront

The key is the landing page just needs to:
1. Fetch and display disc info
2. Show install prompts
3. Store the code for deferred linking
