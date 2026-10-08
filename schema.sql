CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 is_18_plus BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, age INT NOT NULL, bio TEXT DEFAULT '',
 interests TEXT[] DEFAULT '{}', location TEXT DEFAULT '',
 avatar_url TEXT DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 from_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 to_user UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 type TEXT NOT NULL CHECK(type IN ('like','pass','super_like')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(from_user,to_user)
);

CREATE TABLE IF NOT EXISTS matches (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_a UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 user_b UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_a,user_b)
);

CREATE TABLE IF NOT EXISTS conversations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 match_id UUID UNIQUE NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan TEXT NOT NULL CHECK(plan IN ('monthly','quarterly','yearly')),
 status TEXT NOT NULL CHECK(status IN ('pending','active','canceled','expired')),
 provider TEXT NOT NULL DEFAULT 'demo',
 provider_subscription_id TEXT,
 started_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plan TEXT NOT NULL CHECK(plan IN ('monthly','quarterly','yearly')),
 amount_minor INT NOT NULL, currency TEXT NOT NULL DEFAULT 'USD',
 status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','canceled')),
 provider TEXT NOT NULL DEFAULT 'demo', provider_order_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscription_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 provider TEXT NOT NULL, provider_event_id TEXT NOT NULL,
 event_type TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(provider,provider_event_id)
);

CREATE TABLE IF NOT EXISTS usage_counters (
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
 likes_used INT NOT NULL DEFAULT 0,
 super_likes_used INT NOT NULL DEFAULT 0,
 messages_used INT NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,usage_date)
);


CREATE TABLE IF NOT EXISTS notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 type TEXT NOT NULL,
 title TEXT NOT NULL,
 body TEXT NOT NULL,
 data JSONB NOT NULL DEFAULT '{}',
 is_read BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_presence (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 is_online BOOLEAN NOT NULL DEFAULT FALSE,
 last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_tokens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 token TEXT NOT NULL,
 platform TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,token)
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
 ON notifications(user_id,created_at DESC);
