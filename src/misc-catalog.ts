import pg from 'pg';

export type CatalogItemType = 'manager' | 'manager_league' | 'chemistry_style';

const CHEMISTRY_STYLES: Record<string, string> = {
  '250':'Basic','251':'Sniper','252':'Finisher','253':'Deadeye','254':'Marksman',
  '255':'Hawk','256':'Artist','257':'Architect','258':'Powerhouse','259':'Maestro',
  '260':'Engine','261':'Sentinel','262':'Guardian','263':'Gladiator','264':'Backbone',
  '265':'Anchor','266':'Shadow','267':'Hunter','268':'Catalyst',
  '269':'Wall','270':'Shield','271':'Cat','272':'Glove',
};

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n,16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}
function attr(attrs:string,key:string):string {
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=attrs.match(new RegExp("\\b"+escaped+"\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')","i"));
  return match?.[1] ?? match?.[2] ?? '';
}
function cleanName(value:string):string {
  return decodeHtml(value)
    .replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim()
    .replace(/^M(?=[\s.:])/,'')
    .replace(/^manager\s+/i,'')
    .trim();
}
function usableName(name:string):boolean {
  return !!name && name.length<80 && /\p{L}/u.test(name) && !/^(manager|image|nation|league|gold|silver|bronze|m)$/i.test(name);
}

/** Parse FUT.GG manager-card artwork and profile links.
 * FUT.GG image URLs contain the exact manager item ID used by the price feed,
 * and their alt text carries the display name.
 */
export function parseManagers(html: string): Array<{ id:string; name:string }> {
  const found=new Map<string,string>();
  const add=(id:string|undefined,candidates:string[])=>{
    if(!id||!/^\d+$/.test(id))return;
    for(const raw of candidates){
      const name=cleanName(raw);
      if(usableName(name)){found.set(id,name);return;}
    }
  };
  for(const match of html.matchAll(/<(?:img|source)\b([^>]*)>/gi)){
    const attrs=match[1];
    const source=[attr(attrs,'src'),attr(attrs,'data-src'),attr(attrs,'data-original'),attr(attrs,'srcset')].join(' ');
    const id=source.match(/\/27\/managers\/portrait\/(\d+)(?:[./?\s]|$)/i)?.[1];
    if(id)add(id,[attr(attrs,'alt'),attr(attrs,'aria-label'),attr(attrs,'title')]);
  }
  for(const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)){
    const [,attrs,inner]=match;
    const href=decodeHtml(attr(attrs,'href'));
    let path=href;
    try{path=new URL(href,'https://www.futnext.com').pathname;}catch{}
    const route=path.match(/\/(?:managers|manager)\/[^/]+\/(\d+)(?:\/|$)/i);
    const id=route?.[1]||[href,inner].join(' ').match(/\/27\/managers\/portrait\/(\d+)(?:[./?\s]|$)/i)?.[1];
    if(!id)continue;
    const imageNames=[...inner.matchAll(/<img\b([^>]*)>/gi)].map(m=>attr(m[1],'alt'));
    const visible=inner.replace(/<img\b[^>]*>/gi,' ').replace(/<(script|style|svg)[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ');
    add(id,[attr(attrs,'aria-label'),attr(attrs,'title'),...imageNames,visible]);
  }
  return [...found].map(([id,name])=>({id,name}));
}

export class MiscCatalog {
  private names = new Map<string,string>();
  private loaded = false;
  private refreshing?: Promise<number>;
  constructor(private readonly pool: pg.Pool, private readonly year: number) {
    for (const [id,name] of Object.entries(CHEMISTRY_STYLES)) this.names.set('chemistry_style:'+id,name);
  }
  label(type: CatalogItemType, id: string): string {
    return this.names.get(type+':'+id) ?? (type === 'manager' ? 'Manager' : type === 'manager_league' ? 'Manager league' : 'Chemistry style') + ' #' + id;
  }
  async ready(): Promise<void> {\n    try { await this.load(); } catch {}\n    if (this.refreshing) await this.refreshing.catch(() => {});\n  }\n  async load(): Promise<void> {
    if (this.loaded) return;
    const {rows}=await this.pool.query(
      'SELECT item_type,item_id::text,display_name FROM futbot_misc_item_catalog WHERE game_year=$1',
      [this.year],
    );
    for (const row of rows) this.names.set(row.item_type+':'+row.item_id,row.display_name);
    this.loaded=true;
  }
  async refresh(): Promise<number> {
    if (this.refreshing) return this.refreshing;
    const task=(async()=>{
      await this.load();
      const rows:Array<{type:CatalogItemType;id:string;name:string;source:string}>=[];
      for (const [id,name] of Object.entries(CHEMISTRY_STYLES)) rows.push({type:'chemistry_style',id,name,source:'ea-chemistry-style-resource-ids'});
      const pages:Array<Array<{id:string;name:string}>>=[];
      for(let start=0;start<11;start+=3){
        const batch=await Promise.all(Array.from({length:Math.min(3,11-start)},async(_,offset)=>{
          const page=start+offset;
          const url='https://www.fut.gg/managers/'+(page?'?page='+(page+1):'');
          const response=await fetch(url,{headers:{'user-agent':'FutBot/1.0 (FC27 item name lookup)'},signal:AbortSignal.timeout(12000)});
          if(!response.ok)throw new Error('FUT.GG manager catalogue returned HTTP '+response.status);
          return parseManagers(await response.text());
        }));
        pages.push(...batch);
      }
      const managers=new Map<string,string>();
      for(const page of pages)for(const manager of page)managers.set(manager.id,manager.name);
      if(managers.size<100)throw new Error('FUT.GG manager catalogue was incomplete ('+managers.size+' names); keeping saved names.');
      for(const [id,name] of managers)rows.push({type:'manager',id,name,source:'futgg-manager-catalog'});
      const ids=rows.map(r=>r.id),types=rows.map(r=>r.type),names=rows.map(r=>r.name),sources=rows.map(r=>r.source);
      await this.pool.query(
        `INSERT INTO futbot_misc_item_catalog(game_year,item_type,item_id,display_name,source,updated_at)
         SELECT $1,u.item_type,u.item_id::bigint,u.display_name,u.source,now()
         FROM unnest($2::text[],$3::text[],$4::text[],$5::text[]) AS u(item_id,item_type,display_name,source)
         ON CONFLICT(game_year,item_type,item_id) DO UPDATE SET
           display_name=EXCLUDED.display_name,source=EXCLUDED.source,updated_at=now()`,
        [this.year,ids,types,names,sources],
      );
      for(const row of rows)this.names.set(row.type+':'+row.id,row.name);
      return managers.size;
    })().finally(()=>{this.refreshing=undefined;});
    this.refreshing=task;
    return task;
  }
}
