import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.MIX_PORT || 9333;
const WAIT = +(process.env.WAIT || 6000);
const OUT = process.argv[2] || '.verify/shot.png';

const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = pages.find((t) => t.type === 'page');
if (!page) throw new Error('khong co tab');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const waits = new Map();
const msgs = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    msgs.push(m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  if (m.method === 'Runtime.exceptionThrown')
    msgs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.text));
};
const send = (method, params = {}) =>
  new Promise((res) => { const n = ++id; waits.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });

await send('Page.enable');
if (process.env.URL) await send('Page.navigate', { url: process.env.URL });
else await send('Page.reload', { ignoreCache: true });
await new Promise((r) => setTimeout(r, WAIT));
// bật Runtime SAU khi navigate: bật trước đó sẽ replay luôn buffer của document cũ,
// nên console[] đếm warning của lần chạy trước cộng sang.
await send('Runtime.enable');

if (process.env.EXPR) {
  const r = await send('Runtime.evaluate', {
    expression: process.env.EXPR, awaitPromise: true, returnByValue: true,
  });
  console.log('expr:', r.result?.result?.value ?? JSON.stringify(r.result)?.slice(0, 400));
  await new Promise((r) => setTimeout(r, 2500));
}

const st = await send('Runtime.evaluate', { expression: 'document.getElementById("status")?.textContent || ""', returnByValue: true });
const shots = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(shots.result.data, 'base64'));
console.log('status:', st.result.result.value);
console.log('console:', msgs.length ? msgs.slice(0, 8) : 'clean');
console.log('png:', OUT);
// headless=new không throttle rAF + Chrome hay rơi về SwiftShader trên Intel UHD,
// nên tab để mở sẽ render 60fps ngốn hết core. Run sau có reload/navigate nên loop sống lại.
await send('Runtime.evaluate', { expression: 'window.requestAnimationFrame = () => 0' });
ws.close();
