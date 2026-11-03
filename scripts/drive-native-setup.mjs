// Registers the Google sign-in redirect (com.googleusercontent.apps.<client id>:/oauth2redirect) in the native
// projects so Google can hand the login result back to the app. Safe to run again; it replaces its own block.
//   npm run drive:native        (reads VITE_GOOGLE_ANDROID_CLIENT_ID / VITE_GOOGLE_IOS_CLIENT_ID from .env or the environment)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const env = { ...process.env };
for (const f of ['.env', '.env.local']) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const scheme = (id) => 'com.googleusercontent.apps.' + id.replace(/\.apps\.googleusercontent\.com$/, '');

/** Puts `block` between the markers, replacing an earlier copy, or inserts it before `anchor` the first time. */
function place(text, block, anchor, start, end) {
  const re = new RegExp(`[ \\t]*${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n?`);
  const wrapped = `${start}\n${block}\n${end}\n`;
  if (re.test(text)) return text.replace(re, wrapped);
  if (!text.includes(anchor)) throw new Error(`Could not find ${anchor}`);
  return text.replace(anchor, wrapped + anchor);
}

let did = 0;

const androidId = (env.VITE_GOOGLE_ANDROID_CLIENT_ID || '').trim();
if (androidId) {
  const file = 'android/app/src/main/AndroidManifest.xml';
  const block = `            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${scheme(androidId)}" />
            </intent-filter>`;
  writeFileSync(file, place(readFileSync(file, 'utf8'), block, '        </activity>', '            <!-- boxbook-drive-redirect:start -->', '            <!-- boxbook-drive-redirect:end -->'));
  console.log(`Android: registered ${scheme(androidId)}`);
  did++;
}

const iosId = (env.VITE_GOOGLE_IOS_CLIENT_ID || '').trim();
if (iosId) {
  const file = 'ios/App/App/Info.plist';
  const block = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${scheme(iosId)}</string>
\t\t\t</array>
\t\t</dict>
\t</array>`;
  writeFileSync(file, place(readFileSync(file, 'utf8'), block, '\t<key>LSSupportsOpeningDocumentsInPlace</key>', '\t<!-- boxbook-drive-redirect:start -->', '\t<!-- boxbook-drive-redirect:end -->'));
  console.log(`iOS: registered ${scheme(iosId)}`);
  did++;
}

if (!did) console.log('Nothing to do: set VITE_GOOGLE_ANDROID_CLIENT_ID and/or VITE_GOOGLE_IOS_CLIENT_ID in .env first.');
