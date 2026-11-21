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
// A stay confirmation prints line items, then the local grand total with an "approx. US$…" line.
const stayTotal=api.extractOcrMoney('TOTAL\nKHR 232,035\nKHR 23,204\nKHR 25,524\nKHR 4,641\napprox. KHR 285,404\nUS$70.17','KHR');
assert.equal(stayTotal.currency,'KHR');
assert.equal(stayTotal.value,285404);
const stayTotalUsd=api.extractOcrMoney('TOTAL\napprox. KHR 285,404\nUS$70.17','USD');
assert.equal(stayTotalUsd.currency,'USD');
assert.equal(stayTotalUsd.value,70.17);
// A three-digit riel price is a misread of the US$ figure, not a real total.
assert.equal(api.extractOcrMoney('Total ៛70','KHR').value,0);
// With no label, the trip's own currency wins over a bigger foreign number.
const unlabelled=api.extractOcrMoney('KHR 15,000\nUS$ 3.70','KHR');
assert.equal(unlabelled.currency,'KHR');
assert.equal(unlabelled.value,15000);

// Rates read like a price: never "1 KHR = 0.0002 USD".
const khrRate=api.rateLines('KHR','USD',{USD:1,KHR:4080});
assert.equal(khrRate.line,'1 USD = 4,080 KHR');
assert.ok(khrRate.sample.includes('4,000')&&khrRate.sample.includes('0.98'));
assert.equal(api.convertMoney(32,'USD','USD',{USD:1,KHR:4000}),32);

// Bucket list: a wish phrase must not become a street name in another country.
assert.equal(api.cleanBucketQuery('Sunrise at Angkor Wat'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('Sunset at Angkor Wat'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('Sunset and Sunrise at Angkor Wat'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('Angkor Wat at sunrise'),'Angkor Wat');
assert.equal(api.cleanBucketQuery('  Koh Rong  '),'Koh Rong');
assert.equal(api.placeNameScore('Angkor Wat','Angkor Wat'),4);
assert.equal(api.placeNameScore('Vann Sophea Cambodia Knits Fairly Made Toys','Angkor Wat'),0);
assert.ok(api.distanceKm([13.4125,103.867],[13.3622,103.8597])<10);
assert.ok(api.distanceKm([13.4125,103.867],[48.5,-122.6])>1000);

// Photos: maps and AI renders are not travel photography.
assert.equal(api.photoIsPhotograph('File:Angkor site map.svg','map of the temples'),false);
assert.equal(api.photoIsPhotograph('File:Angkor Wat.jpg','AI generated sunset'),false);
assert.equal(api.photoIsPhotograph('File:Angkor Wat sunrise.jpg','Temple at dawn, photograph'),true);
assert.ok(api.osmInterestScore({kind:'Archaeological Site'})>api.osmInterestScore({kind:'Park'}));

// The local Pinterest service returns photo objects; the slideshow still stores URLs.
assert.deepEqual(
  api.photoServiceUrls({photos:[{imageUrl:'https://i.pinimg.com/originals/a.jpg'},{imageUrl:'javascript:alert(1)'},{url:'https://i.pinimg.com/originals/b.jpg'},{imageUrl:'https://i.pinimg.com/originals/a.jpg'}]}),
  ['https://i.pinimg.com/originals/a.jpg','https://i.pinimg.com/originals/b.jpg']
);
assert.deepEqual(api.photoServiceUrls(null),[]);
assert.equal(api.photoServiceUrls({photos:['https://i.pinimg.com/originals/c.jpg']},5).length,1);
assert.equal(api.photoServiceUrls({photos:[{imageUrl:'https://i.pinimg.com/a.jpg'},{imageUrl:'https://i.pinimg.com/b.jpg'}]},1).length,1);
assert.equal(api.PHOTO_SERVICE_ORIGIN,'http://127.0.0.1:3211');
assert.ok(api.APP_VERSION&&api.BUILD_NUMBER);


// Flight boarding pass: airport + airline codes win, and boarding/issue times are not the journey.
const flightText=['BOARDING PASS','Passenger: DARA SOK','Flight K6 801','PNH -> REP','Date 24 Nov 2026','Boarding 07:10','Departure 08:05','Arrival 08:55','Gate B4 Seat 14C','Issued 10 Nov 2026','Booking Ref: X7Q2LM'].join('\n');
const flight=api.parseBookingOcr(flightText,{startDate:'2026-11-24',endDate:'2026-11-26'},null,'boarding-pass.png');
assert.equal(flight.type,'transport');
assert.equal(flight.transport.vehicleType,'Flight');
assert.equal(flight.transport.origin,'Phnom Penh (PNH)');
assert.equal(flight.transport.destination,'Siem Reap (REP)');
assert.equal(flight.transport.operator,'Cambodia Angkor Air K6 801');
assert.equal(flight.transport.departureTime,'08:05','boarding time must not be the departure');
assert.equal(flight.transport.arrivalTime,'08:55');
assert.equal(flight.transport.travelDate,'2026-11-24','issue date must not be the travel date');
assert.equal(api.extractFlight('THE TOTAL 12 PAID'),null,'ordinary text is not a flight');
assert.equal(api.extractFlight('Flight AA 100 JFK LAX').operator,'American Airlines');

// Header row of labels with values underneath, read from word positions.
const cell=(text,x0,x1,y0)=>({text,bbox:{x0,x1,y0,y1:y0+20},confidence:90});
const colWords=[cell('FROM',50,110,100),cell('TO',300,340,100),cell('DATE',520,580,100),
  cell('Phnom',50,120,140),cell('Penh',128,180,140),cell('Siem',300,350,140),cell('Reap',358,410,140),cell('18',520,545,140),cell('Nov',552,590,140),cell('2026',598,650,140)];
const cols=api.ocrColumnFields(colWords);
assert.equal(cols.origin,'Phnom Penh');
assert.equal(cols.destination,'Siem Reap');
assert.equal(cols.date,'18 Nov 2026');
const colTicket=api.parseBookingOcr('Giant Ibis Minivan\nFROM TO DATE\nPhnom Penh Siem Reap 18 Nov 2026\nSeat 12A',{startDate:'2026-11-18'},colWords,'ticket.png');
assert.equal(colTicket.transport.origin,'Phnom Penh');
assert.equal(colTicket.transport.destination,'Siem Reap');
assert.equal(colTicket.transport.travelDate,'2026-11-18');

// Two OCR passes: the more complete reading wins and the other fills its gaps.
const multi=api.parseBookingOcrMulti([
  {text:'E-TICKET\nFrom Phnom Penh To Siem Reap\nDate 18 Nov 2026\nTotal US$ 32.00',words:null},
  {text:'E-TICKET\nFrom Phnom Penh To Siem Reap\nDate 18 Nov 2026\nDeparture 08:30 Arrival 12:00\nSeat 12A\nTotal US$ 32.00',words:null}
],{startDate:'2026-11-18'},'e-ticket.png');
assert.equal(multi.parsed.transport.departureTime,'08:30');
assert.equal(multi.parsed.transport.arrivalTime,'12:00');
assert.ok(api.bookingScore(multi.parsed)>=api.bookingScore(api.parseBookingOcr('E-TICKET\nFrom Phnom Penh To Siem Reap',null,null,'')));
assert.equal(api.parseBookingOcrMulti([{text:'  '}],null,''),null);

// Recommendations: the first usable mirror wins, and the query is light and global.
assert.deepEqual(await api.firstUsable([new Promise(r=>setTimeout(()=>r(null),30)),Promise.resolve([1,2]),Promise.reject(new Error('down'))]),[1,2]);
assert.equal(await api.firstUsable([Promise.resolve(null),Promise.reject(new Error('down'))]),null);
assert.equal(await api.firstUsable([]),null);
const overpassQuery=api.buildOverpassQuery(11.5564,104.9282,12000);
assert.ok(overpassQuery.includes('around:12000,11.5564,104.9282')&&overpassQuery.includes('out center tags'));
assert.ok(!/node\(around/.test(overpassQuery),'uses nwr, not three separate node/way/relation queries');
assert.ok(api.wikiInterestScore({views:90000,langs:60},1)>api.wikiInterestScore({views:40,langs:1},1));
assert.ok(api.wikiInterestScore({views:1e9,langs:999},0)<=10);

// Photos: scans, postcards and pre-digital shots are out; recent wide frames are in.
assert.equal(api.photoLooksOld('File:Angkor Wat 1998.jpg','',''),true);
assert.equal(api.photoLooksOld('File:Angkor postcard.jpg','',''),true);
assert.equal(api.photoLooksOld('File:Temple.jpg','scanned slide',''),true);
assert.equal(api.photoLooksOld('File:Temple.jpg','','1993-04-02 10:00:00'),true);
assert.equal(api.photoLooksOld('File:Angkor Wat sunrise.jpg','Sunrise over the temple','2019-02-11 06:10:00'),false);
assert.equal(api.photoWanted({width:1200,height:700}),false);
assert.equal(api.photoWanted({width:3000,height:1800}),true);
assert.deepEqual(api.pexelsUrls({photos:[
  {width:4000,height:2500,alt:'Temple at sunrise',src:{large2x:'https://images.pexels.com/a.jpeg'}},
  {width:2000,height:3000,alt:'Tall',src:{large2x:'https://images.pexels.com/tall.jpeg'}},
  {width:4000,height:2500,alt:'Portrait of a model',src:{large2x:'https://images.pexels.com/m.jpeg'}},
  {width:4000,height:2500,alt:'Beach',src:{large2x:'http://insecure.example/b.jpeg'}}
]}),['https://images.pexels.com/a.jpeg']);
assert.deepEqual(api.pexelsUrls(null),[]);

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
