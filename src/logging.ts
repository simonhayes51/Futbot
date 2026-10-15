// Log actionable codes and fixed hints only. Never log a connection URL or token.
export function errorDetails(error:unknown){
 const e=error as {code?:unknown;message?:unknown};let code=typeof e?.code==='number'&&Number.isSafeInteger(e.code)?String(e.code):typeof e?.code==='string'&&/^[A-Z0-9_]{2,30}$/.test(e.code)?e.code:'UNKNOWN';
 if(code==='UNKNOWN'&&typeof e?.message==='string'){if(/connection terminated|connection closed|socket hang up/i.test(e.message))code='CONNECTION_CLOSED';else if(/timeout|timed out/i.test(e.message))code='TIMEOUT';}
 const hints:Record<string,string>={
 '50007':'Discord DMs are unavailable. The recipient may have DMs disabled or the bot blocked.',
 '50013':'Discord reports missing permissions.',
 '53100':'PostgreSQL reports disk full. Free database host storage.',
 '53200':'PostgreSQL reports insufficient memory.',
 '53300':'PostgreSQL connection limit reached.',
 '57P01':'Database is shutting down or restarting.',
 '57P02':'Database terminated due to a crash.',
 '57P03':'Database is temporarily not accepting connections.',
 '28P01':'Database authentication failed. Check credentials.',
 '3D000':'Configured database does not exist.',
 '42501':'Database account lacks the required permission.',
 '42P01':'Required table is missing. Check migrations and database selection.',
 '57014':'Database query exceeded its statement timeout. Check load and indexes.',
 ECONNREFUSED:'Database endpoint refused the connection.',
 ENOTFOUND:'Database hostname could not be resolved.',
 ECONNRESET:'Database connection was reset.',
 ETIMEDOUT:'Database connection timed out.',
 TIMEOUT:'Database operation timed out.',
 CONNECTION_CLOSED:'Database connection closed unexpectedly. Check database host health.'
 };
 return {code,hint:hints[code]??'Check service availability and hosting logs; the worker will retry on the next cycle.'};
}
export function logFailure(stage:string,error:unknown){console.error(stage,errorDetails(error));}
