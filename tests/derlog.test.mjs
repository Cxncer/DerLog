/* Fixture checks for DerLog's pure helpers: OCR parsing, migration, money and calendar export.
   Run with: node tests/derlog.test.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const html=fs.readFileSync(path.join(root,'DerLog-v19.html'),'utf8');
const marker='<script type="text/babel">';
const start=html.indexOf(marker)+marker.length;
const end=html.indexOf('</script>',start);
const script=html.slice(start,end);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'derlog-test-'));
const jsxPath=path.join(dir,'app.jsx');
const modulePath=path.join(dir,'app.mjs');
fs.writeFileSync(jsxPath,script);
execSync(`npx --yes esbuild "${jsxPath}" --outfile="${modulePath}" --format=esm --loader:.jsx=jsx`,{stdio:'inherit'});

const store=new Map();
globalThis.window=globalThis;
globalThis.localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>store.set(key,String(value)),removeItem:key=>store.delete(key)};
globalThis.document={
  getElementById:()=>({innerHTML:''}),
  createElement:()=>({style:{},setAttribute(){},appendChild(){},remove(){},click(){}}),
  body:{className:'',appendChild(){}},
  head:{appendChild(){}},
  addEventListener(){}
};
Object.defineProperty(globalThis,"navigator",{value:{},configurable:true});
globalThis.location={protocol:'file:'};
globalThis.React={Component:class{constructor(props){this.props=props}},useState:value=>[typeof value==='function'?value():value,()=>{}],useEffect(){},useRef:value=>({current:value}),createElement:()=>({})};
globalThis.ReactDOM={createRoot:()=>({render(){}})};

await import(pathToFileURL(modulePath).href);
const api=globalThis.window.__DERLOG_TEST__;
assert.ok(api,'test hook is missing');

const ticket=[
 'E-TICKET',
 'E-Ticket No: KHVAH60991731',
 'Passenger: MEYSON SOPANHA',
 'Seat: 12A',
 'From Phnom Penh To Siem Reap',
 'Departure 08:30 Arrival 12:00',
 'Date 18 Nov 2026',
 'Total US$ 32.00'
].join('\n');
const parsed=api.parseBookingOcr(ticket,{startDate:'2026-11-18',endDate:'2026-11-20'},null,'e-ticket.pdf');
assert.equal(parsed.type,'transport','transport ticket should be detected');
assert.ok(parsed.transport.passengers.some(person=>person.seat==='12A'),'seat 12A should be captured');
assert.ok(String(parsed.transport.ticketNumber||'').includes('KHVAH60991731'),'ticket number should be captured');
assert.equal(parsed.transport.departureTime,'08:30');

const migrated=api.migrateData({trips:[{id:'a',title:'Siem Reap',items:[{id:'i',title:'Angkor',cost:'12'}]}]});
assert.equal(migrated.schemaVersion,4);
assert.equal(migrated.trips[0].currency,'USD');
assert.equal(migrated.trips[0].items[0].cost,12);
assert.deepEqual(migrated.destinationCache,{});

assert.equal(api.money(12.5,{currency:'USD'}),'$12.50');
assert.ok(api.money(15000,{currency:'KHR'}).includes('៛'));

const ics=api.buildICS({id:'t1',title:'Siem Reap',startDate:'2026-11-18',items:[{id:'i1',title:'Angkor Wat',date:'2026-11-18',time:'05:30',category:'Explore',notes:'Sunrise, gate 2'}]});
assert.ok(ics.includes('BEGIN:VEVENT'));
assert.ok(ics.includes('DTSTART:20261118T053000'));
assert.ok(ics.includes('DTEND:20261118T063000'));
assert.ok(ics.includes('SUMMARY:Angkor Wat'));
assert.ok(ics.includes('DESCRIPTION:Sunrise'));
assert.ok(ics.includes('END:VCALENDAR'));

assert.equal(api.isMediaPayload('data:image/png;base64,'+'A'.repeat(14000)),true);
assert.equal(api.isMediaPayload('https://example.com/a.png'),false);
assert.equal(api.currencyOf({currency:'EUR'}).code,'EUR');

const scannedKhr=api.extractOcrMoney('Total paid 130,000 KHR','USD');
assert.equal(scannedKhr.currency,'KHR');
assert.equal(scannedKhr.value,130000);
const scannedUsd=api.extractOcrMoney('Total US$ 32.00','KHR');
assert.equal(scannedUsd.currency,'USD');
assert.equal(scannedUsd.value,32);
assert.equal(Number(api.convertMoney(130000,'KHR','USD',{USD:1,KHR:4000}).toFixed(2)),32.5);
assert.equal(api.convertMoney(32,'USD','USD',{USD:1,KHR:4000}),32);

// Bucket list: a wish phrase must not become a street name in another country.
assert.equal(api.cleanBucketQuery('Sunrise at Angkor Wat'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('Sunset at Angkor Wat'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('Sunset and Sunrise at Angkor Wat'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('Angkor Wat at sunrise'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('  Koh Rong  '),'Koh Rong');
assert.ok(api.distanceKm([13.4125,103.867],[13.3622,103.8597])<10);
assert.ok(api.distanceKm([13.4125,103.867],[48.5,-122.6])>1000);

// Photos: maps and AI renders are not travel photography.
assert.equal(api.photoIsPhotograph('File:Angkor site map.svg','map of the temples'),false);
assert.equal(api.photoIsPhotograph('File:Angkor Wat.jpg','AI generated sunset'),false);
assert.equal(api.photoIsPhotograph('File:Angkor Wat sunrise.jpg','Temple at dawn, photograph'),true);
assert.ok(api.osmInterestScore({kind:'Archaeological Site'})>api.osmInterestScore({kind:'Park'}));
assert.ok(api.APP_VERSION&&api.BUILD_NUMBER);

console.log('DerLog fixtures passed');

// Google credential decoding: only name/email/picture should ever be used, never the raw token.
const googlePayload={name:'Meyson Sopanha',email:'meyson@example.com',picture:'https://lh3.googleusercontent.com/a/photo=s96-c',sub:'1234567890'};
const fakeJwt=`eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify(googlePayload)).toString('base64url')}.signature`;
const decoded=api.decodeGoogleCredential(fakeJwt);
assert.equal(decoded.name,'Meyson Sopanha');
assert.equal(decoded.email,'meyson@example.com');
assert.ok(decoded.picture.startsWith('https://lh3.googleusercontent.com/'));
assert.equal(api.decodeGoogleCredential('not-a-token'),null);
assert.equal(api.decodeGoogleCredential(''),null);
console.log('Google credential decode passed');
