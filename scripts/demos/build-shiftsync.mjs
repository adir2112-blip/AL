// Builds the public ShiftSync demo (demo/shiftsync/index.html) from the real app source.
// Usage: node scripts/demos/build-shiftsync.mjs "<path to moked-shifts/index.html>"
// The demo runs entirely in the browser: Firebase, EmailJS and the WhatsApp API are
// replaced by an in-memory mock, client names are swapped for generic departments,
// and a guided 4-step tour is layered on top.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const src = process.argv[2] || 'C:/Users/אדיר לוי/Desktop/moked-shifts/index.html';
let html = fs.readFileSync(src, 'utf8');

function mustReplace(from, to) {
  if (!html.includes(from)) throw new Error('marker not found: ' + from.slice(0, 80));
  html = html.split(from).join(to);
}

// 1. Secrets and live endpoints out
html = html.replace(/const FB_URL\s*=\s*'[^']*';/, "const FB_URL   = 'https://demo.local';");
html = html.replace(/const FB_API_KEY\s*=\s*'[^']*';/, "const FB_API_KEY = 'demo';");
html = html.replace(/const WA_REMIND_API\s*=\s*'[^']*';/, "const WA_REMIND_API = 'https://demo.local/wa';");
html = html.replace(/const ADMIN_PASS\s*=\s*'[^']*';/, "const ADMIN_PASS   = '0000';");
html = html.replace(/const EMAILJS_SERVICE_ID\s*=\s*'[^']*';/, "const EMAILJS_SERVICE_ID  = 'demo';");
html = html.replace(/const EMAILJS_TEMPLATE_ID\s*=\s*'[^']*';/, "const EMAILJS_TEMPLATE_ID = 'demo';");
html = html.replace(/const EMAILJS_PUBLIC_KEY\s*=\s*'[^']*';/, "const EMAILJS_PUBLIC_KEY  = 'demo';");
html = html.replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@emailjs[^"]*"><\/script>\s*/, '');
html = html.split('adir2112-blip.github.io/moked-shifts').join('al-systems.co.il/demo/shiftsync/');
for (const s of ['AIzaSy', 'firebasedatabase.app', 'railway.app', 'service_anrdikj', 'adirgal']) {
  if (html.includes(s)) throw new Error('secret/endpoint still present: ' + s);
}

// 2. Real client names -> generic departments (longest first)
const rename = [
  ['מעוף לעמית מכירות', 'מוקד גבייה'],
  ['פריפיט מכירות', 'מוקד מכירות'],
  ['פריפיט שירות', 'תמיכה טכנית'],
  ['מובמנט', 'מוקד שירות'],
  ['מאוחדת', 'שירות VIP'],
  ['הולנדיה', 'בק אופיס'],
  ['פריפיט', 'מוקד'],
];
for (const [a, b] of rename) html = html.split(a).join(b);

// 3. Head: title, noindex, canonical
mustReplace('<title>ShiftSync – מערכת סידור עבודה</title>',
  '<title>הדגמת ShiftSync</title>\n<meta name="robots" content="noindex, follow">\n<meta name="description" content="הדגמה חיה של ShiftSync – מערכת סידור עבודה: עובד מגיש אילוצים, מנהל מאשר ומפיץ סידור במייל.">');

// 4. Mock backend, before the app script
const mock = fs.readFileSync(path.join(here, 'shiftsync-mock.js'), 'utf8');
const appScriptStart = '<script>\n// ══════════════════════════════════════════════════════════\n//  FIREBASE CONFIG';
const appScriptStartCRLF = appScriptStart.replace(/\n/g, '\r\n');
if (html.includes(appScriptStartCRLF)) html = html.replace(appScriptStartCRLF, '<script>\n' + mock + '\n</script>\n' + appScriptStartCRLF);
else mustReplace(appScriptStart, '<script>\n' + mock + '\n</script>\n' + appScriptStart);

// 5. Guided tour, after the app script
const tour = fs.readFileSync(path.join(here, 'shiftsync-tour.js'), 'utf8');
const tourCss = fs.readFileSync(path.join(here, 'shiftsync-tour.css'), 'utf8');
mustReplace('</head>', '<style>\n' + tourCss + '\n</style>\n</head>');
const lastBody = html.lastIndexOf('</body>');
html = html.slice(0, lastBody) + '<script>\n' + tour + '\n</script>\n' + html.slice(lastBody);

const out = path.join(root, 'demo', 'shiftsync', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote', out, html.length, 'bytes');
