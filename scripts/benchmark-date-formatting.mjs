// Synthetic dates only; no server, DB, jobs, networking or integration imports.
// Run each variant in a fresh process with the production Node version and TZ.
import {createHash} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
const variant=process.argv[2] || 'candidate';
if (!['baseline', 'candidate'].includes(variant)) throw new Error('Use baseline or candidate');
const candidate=variant==='candidate'?await import('../server/lib/dateFormatting.js'):null;
const booking=variant==='candidate'?await import('../server/lib/bookingPolicy.js'):null;
const styles=[['date',undefined],['dayMonth',{day:'numeric',month:'short'}],['dayMonthYear',{day:'numeric',month:'short',year:'numeric'}],['weekdayDayMonth',{weekday:'short',day:'numeric',month:'short'}],['weekdayDayMonthYear',{weekday:'short',day:'numeric',month:'short',year:'numeric'}],['utcDate',{timeZone:'UTC'}]];
const mxopts={timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'};
const dates=['2026-08-01T04:52:03Z','2026-08-01T06:00:00Z','2024-02-29T23:59:59Z','2021-10-31T07:30:00Z','2026-12-31T23:59:59Z'].map(x=>new Date(x));
function operation(i){const date=dates[i%dates.length];const n=i%9;
 if(n<6)return candidate?candidate.formatEsMxDate(date,styles[n][0]):date.toLocaleDateString('es-MX',styles[n][1]);
 if(n===6)return candidate?candidate.formatMexicoCityTimestamp(date):date.toLocaleString('es-MX',{timeZone:'America/Mexico_City'});
 if(n===7)return JSON.stringify(candidate?candidate.mexicoCityDateParts(date):new Intl.DateTimeFormat('en-CA',mxopts).formatToParts(date));
 if(booking)return booking.mexicoCityDate(date);
 const parts=new Intl.DateTimeFormat('en-US',mxopts).formatToParts(date);const values=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${values.year}-${values.month}-${values.day}`;
}
const snapshots=[];
function sample(phase){snapshots.push({phase,...process.memoryUsage(),resource:process.resourceUsage(),uptime:process.uptime()});}
sample('import');const warmupHash=createHash('sha256');for(let i=0;i<300;i++)warmupHash.update(operation(i));sample('warmup300');
const timings=[];const hashes=[];
for(let wave=0;wave<3;wave++){const hash=createHash('sha256');const t=performance.now();for(let i=0;i<4800;i++)hash.update(operation(i));timings.push(performance.now()-t);hashes.push(hash.digest('hex'));sample('wave'+wave);await wait(1000);sample('between'+wave);}
for(let n=0;n<5;n++){await wait(1000);sample('idle'+n);}
console.log(JSON.stringify({variant,runtime:{node:process.version,platform:process.platform,arch:process.arch,icu:process.versions.icu,tz:process.env.TZ||'(default)'},warmupCalls:300,callsPerWave:4800,waves:3,timings,hashes,warmupHash:warmupHash.digest('hex'),snapshots}));
