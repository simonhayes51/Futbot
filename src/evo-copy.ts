/** Turn source abbreviations into short player-facing copy. */
export function evoText(value:string){
 return value.replace(/\(\^(\d+)\)/g,'(cap $1)').replace(/\bMax PS\+\b/g,'Max PlayStyles+').replace(/\bMax PS\b/g,'Max PlayStyles').replace(/\bMin PS\b/g,'Min PlayStyles').replace(/\[SP\+?\s*\d+\]/gi,'').replace(/[*_`~|\\<>]/g,'').replace(/\s+/g,' ').trim();
}
export function shortUnlock(value:string){
 const text=evoText(value).replace(/^.*?:\s*(?=Unlocked by)/i,'').replace(/^Unlocked by reaching level (\d+) in the Premium Season Pass\.?$/i,'Premium Season Pass · level $1 required');
 return text.length>150?text.slice(0,147)+'…':text;
}
