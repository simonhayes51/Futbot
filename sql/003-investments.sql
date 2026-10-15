CREATE TABLE IF NOT EXISTS futbot_investments (
 id bigserial PRIMARY KEY,user_id text NOT NULL,card_id bigint NOT NULL,card_name text NOT NULL,
 game_year smallint NOT NULL,platform text NOT NULL,buy_price integer NOT NULL CHECK(buy_price BETWEEN 1 AND 15000000),
 quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS futbot_investments_user_idx ON futbot_investments(user_id,game_year,platform);
