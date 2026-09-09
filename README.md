# KeepFresh AI

**Smarter Food Management, Less Waste, More Savings.**

A complete, production-ready mobile application for smart food inventory management, expiration tracking, grocery lists, recipe recommendations, and food waste analytics.

## Features

- **Smart Inventory Management** - Track food items with quantities, expiration dates, and categories
- **Barcode Scanning** - Scan product barcodes to quickly add items
- **Expiration Alerts** - Get notified before food expires (1, 3, 5, 7 days before)
- **Recipe Recommendations** - AI-suggested recipe
s based on available inventory
- **Grocery Lists** - Create and manage shopping lists with budget tracking
- **Food Waste Analytics** - Track consumption vs waste with charts
- **Push Notifications** - Real-time expiration warnings
- **Multi-user Authentication** - Email/password, Google OAuth, Facebook OAuth
- **Offline Support** - Graceful network failure handling
- **Secure Storage** - Supabase Row Level Security (RLS)

## Technology Stack

### Frontend
- **React Native** with **Expo**
- **TypeScript** for type safety
- **Expo Router** for file-based navigation
- **React Native Paper** for UI components
- **Expo Camera** for barcode scanning
- **Expo Notifications** for push notifications
- **Expo Secure Store** for secure token storage

### Backend
- **Supabase** (PostgreSQL + Auth + Storage + Realtime)
- **Row Level Security** for data protection
- **Edge Functions** for serverless logic

## Prerequisites

- Node.js 18+
- Expo CLI (`npm install -g expo-cli`)
- Supabase account
- Expo Go app on mobile device (for testing)

## Installation

1. **Clone and install dependencies:**
```bash
npx create-expo-app@latest keepfresh-ai
cd keepfresh-ai
npm install
```

2. **Configure environment variables:**
```bash
cp .env.example .env
```

Add your Supabase credentials to `.env`:
```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

3. **Set up Supabase database:**
   - Go to Supabase Dashboard → SQL Editor
   - Run the schema file first: `supabase/migrations/keepfreshdb.sql`
   - Then load real data: `supabase/migrations/seed.sql`
   - This creates all tables, RLS policies, functions, storage buckets, 14 seed
     recipes, and a demo household. Log in with `demo@keepfresh.app` /
     `KeepFresh123!`. Full walkthrough + serverless backend setup:
     [supabase/README.md](supabase/README.md)

5. **Configure Authentication:**
   - Go to Authentication → Providers
   - Enable **Email/Password**
   - Enable **Google** OAuth
   - Enable **Facebook** OAuth

6. **Configure OAuth Redirect URLs:**
   ```
   Supabase Dashboard → Authentication → URL Configuration
   Site URL: keepfreshai://auth/callback
   ```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create OAuth 2.0 Client ID
3. Add authorized redirect URIs:
   - `https://your-project.supabase.co/auth/v1/callback`
   - `keepfreshai://auth/callback`
4. Add Client ID to `.env`

### Facebook OAuth Setup

1. Go to [Meta Developer Dashboard](https://developers.facebook.com)
2. Create App → Facebook Login
3. Add redirect URI:
   - `https://your-project.supabase.co/auth/v1/callback`
   - `keepfreshai://auth/callback`
4. Add App ID to `.env`

7. **Start the app:**
```bash
npx expo start
```

## Running on Devices

### Android
```bash
npx expo start --android
```
Or scan QR code with Expo Go app.

### iOS
```bash
npx expo start --ios
```
Or scan QR code with Expo Go app.

### Development Build (Required for Camera/Notifications)
```bash
npx expo install expo-dev-client
npx expo run:android
npx expo run:ios
```

**Note:** Camera, push notifications, and OAuth require a development build. They will not work in Expo Go.

## Project Structure

```
keepfresh-ai/
├── app/                    # Expo Router screens
│   ├── _layout.tsx         # Root layout
│   ├── (auth)/             # Auth screens
│   │   ├── login.tsx
│   │   ├── signup.tsx
│   │   ├── forgot-password.tsx
│   │   └── reset-password.tsx
│   ├── (tabs)/             # Main tab navigation
│   │   ├── _layout.tsx
│   │   ├── index.tsx       # Home Dashboard
│   │   ├── inventory.tsx
│   │   ├── recipes.tsx
│   │   ├── alerts.tsx
│   │   └── profile.tsx
│   ├── scan/               # Product scanning
│   │   ├── index.tsx
│   │   └── product.tsx
│   ├── inventory/          # Inventory management
│   │   ├── add.tsx
│   │   ├── edit.tsx
│   │   └── details.tsx
│   ├── recipes/            # Recipe details
│   │   └── [id].tsx
│   ├── grocery/            # Grocery list
│   │   └── index.tsx
│   ├── analytics/          # Analytics dashboard
│   │   └── index.tsx
│   └── settings/           # Settings screens
│       ├── account.tsx
│       ├── notifications.tsx
│       ├── preferences.tsx
│       ├── help.tsx
│       └── about.tsx
├── src/
│   ├── components/         # Reusable components
│   ├── context/            # React contexts
│   │   └── AuthContext.tsx
│   ├── hooks/              # Custom hooks
│   ├── services/           # Business logic
│   ├── lib/                # Library configs
│   │   └── supabase.ts
│   ├── types/              # TypeScript types
│   ├── utils/              # Utility functions
│   └── theme/              # Design system
├── supabase/
│   ├── migrations/         # SQL: keepfreshdb.sql (schema) then seed.sql (data)
│   ├── functions/          # Edge Functions (expiration-notifier, recipe-suggestions, weekly-summary)
│   ├── schedule.sql        # pg_cron job for the daily expiration scan
│   ├── README.md           # full setup walkthrough
│   └── config.toml         # Supabase CLI / function JWT config
├── assets/                 # Static assets
├── .env.example
├── app.json
├── package.json
├── tsconfig.json
└── README.md
```

## Database Schema

Key tables:
- `profiles` - User profiles
- `inventory_items` - Food inventory
- `inventory_consumption` - Consumption tracking
- `food_waste` - Waste records
- `recipes` - Recipe catalog
- `recipe_ingredients` - Recipe ingredients
- `favorite_recipes` - User favorites
- `grocery_lists` - Shopping lists
- `grocery_items` - List items
- `notification_preferences` - Notification settings
- `notification_logs` - Notification history
- `user_preferences` - Units, currency, language

All user tables have **Row Level Security** enabled.

## Testing Checklist

- [ ] User signup with email/password
- [ ] User login with email/password
- [ ] Google OAuth login
- [ ] Facebook OAuth login
- [ ] Forgot password flow
- [ ] Add inventory item manually
- [ ] Scan product barcode
- [ ] View inventory with filters
- [ ] Edit inventory item
- [ ] Delete inventory item
- [ ] Mark item as consumed
- [ ] Mark item as waste
- [ ] Receive expiration notifications
- [ ] View recipe suggestions
- [ ] View recipe details
- [ ] Save/favorite recipes
- [ ] Create grocery list
- [ ] Add/remove grocery items
- [ ] View analytics dashboard
- [ ] Update profile settings
- [ ] Update notification preferences
- [ ] Update units/preferences
- [ ] Logout and login again
- [ ] Offline mode handling
- [ ] Camera permission handling

## Troubleshooting

### Common Issues

**Camera not working:**
- Ensure development build is used
- Check camera permissions in Settings

**Notifications not received:**
- Use development build
- Check notification permissions
- Verify FCM/APNs configuration

**OAuth fails:**
- Verify redirect URLs in Supabase and provider consoles
- Check scheme configuration in app.json

**Database errors:**
- Run migrations in order
- Check RLS policies
- Verify user is authenticated

### Reset Development Database
```bash
npx supabase db reset
```

## Deployment

### Build for Production
```bash
eas build --platform all
```

### Submit to App Stores
```bash
eas submit --platform ios
eas submit --platform android
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| EXPO_PUBLIC_SUPABASE_URL | Supabase project URL | Yes |
| EXPO_PUBLIC_SUPABASE_ANON_KEY | Supabase anonymous key | Yes |
| EXPO_PUBLIC_GOOGLE_CLIENT_ID | Google OAuth client ID | For Google login |
| EXPO_PUBLIC_FACEBOOK_APP_ID | Facebook App ID | For Facebook login |

## License

MIT License - see LICENSE file for details.

## Support

For issues, please check:
- [Expo Documentation](https://docs.expo.dev)
- [Supabase Documentation](https://supabase.com/docs)
- [React Native Documentation](https://reactnative.dev)

---

**KeepFresh AI** - Making food management smarter, one scan at a time.