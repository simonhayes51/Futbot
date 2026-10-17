CREATE TABLE IF NOT EXISTS futbot_misc_item_catalog (
  game_year integer NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('manager','manager_league','chemistry_style')),
  item_id bigint NOT NULL,
  display_name text NOT NULL,
  source text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_year,item_type,item_id)
);
