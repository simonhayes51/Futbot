import pg from 'pg';
import type { Card, Price } from './domain.js';
export class PriceRepository {
  pool: pg.Pool;
  constructor(url: string, public year = 27) {
    this.pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 8000,
      options: '-c default_transaction_read_only=on', application_name: 'futbot-price-reader' });
  }
  async search(query: string): Promise<Card[]> {
    const term = query.replace(/[\\%_]/g, '\\$&').slice(0, 80);
    const { rows } = await this.pool.query(`SELECT source_card_id::text AS id,
      COALESCE(display_name,name,full_name,'Unknown card') AS name, rating,
      primary_position AS position, rarity, club,
      COALESCE(card_image_stored_url,card_image_url,player_image_url) AS image
      FROM public.futgg_players WHERE game_year=$1 AND is_active=true
      AND (COALESCE(name,'') ILIKE $2 OR COALESCE(display_name,'') ILIKE $2 OR source_card_id::text=$3)
      ORDER BY rating DESC NULLS LAST,source_card_id LIMIT 25`, [this.year, `%${term}%`, query]);
    return rows;
  }
  async card(id: string): Promise<Card | null> {
    const { rows } = await this.pool.query(`SELECT source_card_id::text AS id,
      COALESCE(display_name,name,full_name,'Unknown card') AS name,rating,primary_position AS position,rarity,club,
      COALESCE(card_image_stored_url,card_image_url,player_image_url) AS image
      FROM public.futgg_players WHERE source_card_id=$1 AND game_year=$2`, [id,this.year]);
    return rows[0] || null;
  }
  async latest(cardId: string, platform: string): Promise<Price | null> {
    const { rows } = await this.pool.query(`SELECT source_card_id::text AS "cardId",platform,
      lowest_bin AS value,captured_at AS "capturedAt" FROM public.futgg_bin_history
      WHERE source_card_id=$1 AND platform=$2 AND game_year=$3 AND lowest_bin>0
      ORDER BY captured_at DESC,id DESC LIMIT 1`, [cardId,platform,this.year]);
    return rows[0] || null;
  }
  async history(cardId: string, platform: string, hours = 24): Promise<{ at: Date; value: number }[]> {
    const { rows } = await this.pool.query(`SELECT date_trunc('hour',captured_at) AS at,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY lowest_bin)::int AS value
      FROM public.futgg_bin_history WHERE source_card_id=$1 AND platform=$2 AND game_year=$3
      AND captured_at>=now()-($4::int * interval '1 hour') AND lowest_bin>0
      GROUP BY 1 ORDER BY 1`,[cardId,platform,this.year,Math.min(hours,168)]);
    return rows;
  }
}
