import { useEffect, type ReactNode } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { Header, Page, Section } from '../ui';

interface Qa {
  q: string;
  a: ReactNode;
}

const GROUPS: { title: string; items: Qa[] }[] = [
  {
    title: 'App settings',
    items: [
      {
        q: 'Where do I change my company details, defaults and lists?',
        a: 'More → App settings has a page for each: Business, Invoice & bank, Pricing, Paper stock, Lists (payment methods), Backup and Appearance. On a phone pick one from the list and come back by swiping in from the left edge or with the back button. On a computer the sections are tabs at the top of the page. Typed fields are saved with the Save button that appears; switches, chips and lists apply straight away.',
      },
    ],
  },
  {
    title: 'Box calculator',
    items: [
      {
        q: 'How do I work out a box?',
        a: 'Open Calculator, enter the inner length, width and height in mm, pick the ply and the paper (GSM, BF and price per kg). You get the box weight, bursting strength, cut size, deckle, sheets and paper cost straight away. Then set quantity, overhead, profit and GST to see the price per box and the total.',
      },
      {
        q: 'What do the 3D box and its numbers show?',
        a: 'The 3D box is drawn from your inner size. Drag it (or use the arrow keys) to turn it; L, W and H are drawn outside the box and stay readable from every angle. The play button turns it slowly and the reset button brings back the first view. It appears while you create a box and in every saved box.',
      },
      {
        q: 'Can I save a box and reuse it?',
        a: 'Yes. Tap Save box, give it a name and, if you like, a customer. Saved boxes are under More → Saved boxes and on the customer’s page. From a saved box you can create an order in one tap.',
      },
    ],
  },
  {
    title: 'Orders & invoices',
    items: [
      {
        q: 'How do I make a GST tax invoice?',
        a: 'First fill in More → App settings → Business profile and Invoice & bank (name, logo, GSTIN, address, bank details). Then open an order and tap “Make & share invoice (PDF)”. The PDF opens the share sheet, so you can send it on WhatsApp, e-mail or save it to Drive. On a computer it downloads instead.',
      },
      {
        q: 'CGST + SGST or IGST?',
        a: 'BoxBook compares the state of your company with the customer’s state (taken from the GSTIN, or chosen in the customer’s details). Same state: CGST + SGST. Different state: IGST. Set the customer’s state if the GSTIN is missing.',
      },
      {
        q: 'How are invoice numbers given?',
        a: 'The first time you make an invoice for an order it gets the next number from App settings → Invoice & bank (with your prefix, if any). The number is kept for that order, so sharing it again never creates a new one. To start from another number, change “Next invoice no.”.',
      },
      {
        q: 'Where do I add HSN, dispatch and delivery details?',
        a: 'In the order editor: HSN and unit per item, and “Tax invoice details” for dispatch, destination, terms of payment and delivery note.',
      },
    ],
  },
  {
    title: 'Paper stock',
    items: [
      {
        q: 'How do I add paper reels?',
        a: 'Open More → Paper stock and tap Add reel. Enter BF, GSM, width (mm), weight (kg) and the rate, plus the reel number and supplier. “Save & add another” keeps the grade and supplier, which is quick when several reels arrive together.',
      },
      {
        q: 'Tiles or list?',
        a: 'Paper stock opens as tiles: one card per reel with the kg left and a bar that empties as the reel is used. Tap the list icon next to the switch for a compact list; BoxBook remembers your choice. “By paper grade” and “By reel size” both work in either layout.',
      },
      {
        q: 'What are common reel sizes?',
        a: 'In More → App settings → Paper stock → Common reel sizes, add the widths you usually buy (for example 1000, 1200 mm). Switch the list to “By reel size” to see, for each width, the reels in stock, the kg in stock and the kg you have bought. “Purchased …” under a size opens the reel form with that width ready. Set “Reels” to add a batch at once (each with the same weight). The order page also shows the nearest common size that fits the box.',
      },
      {
        q: 'How does an order use the stock?',
        a: 'An order made from calculator boxes shows “Paper needed” per grade (BF and GSM): the kg from the box size and quantity, plus the extra % you set in App settings → Paper stock for start-up waste. When you confirm the order (or save it as confirmed), BoxBook takes the paper from the best-fitting reels by itself, if all of that grade is in stock. If something is short you get a message saying which grade and how many kg, and nothing is taken for that grade. Turn this off in App settings → Paper stock if you prefer to issue by hand.',
      },
      {
        q: 'A grade was short. What now?',
        a: 'Buy or add the reels (More → Paper stock → Add reel), then open the order and tap “Issue automatically”. You can also tap “Issue reels” on a grade to choose the reels and kg yourself.',
      },
      {
        q: 'How do low-stock alerts work?',
        a: 'In More → App settings → Paper stock → Reorder levels, set the least kg you want to keep for a grade. When stock falls below it, a red “Time to buy paper” card appears on Home and in Paper stock. The same card also appears when open orders need more of a grade than you have.',
      },
      {
        q: 'Which reel should I pick?',
        a: 'BoxBook lists reels with the same GSM, the same or a higher BF, and a width at least as wide as the box’s deckle. The one with the least side trim comes first, so part-used reels get finished before new ones. A wider reel costs more kg because the extra width is trimmed off; the suggested kg already includes that.',
      },
      {
        q: 'Some paper was left over or wasted. What now?',
        a: 'On the order, tap Return next to the reel and enter the leftover kg. For spoilage not tied to an order, or after weighing a reel, open the reel and use “Record waste or correct the weight”. Every change is in the reel’s movement list and can be undone there.',
      },
    ],
  },
  {
    title: 'Backup & restore',
    items: [
      {
        q: 'Where is my data kept?',
        a: 'On this phone (or in this browser). With Cloud sync on, also in your business’s cloud, where only staff the owner invites can sign in and each sees what their role allows.',
      },
      {
        q: 'Is my data backed up automatically?',
        a: 'Yes. Once a day, when you open the app, a copy is saved on the phone (Documents/BoxBook/Backups; on iPhone in the Files app under BoxBook). The last 7, 14 or 30 are kept. A backup holds everything: customers, orders, saved boxes, company profile, bank details, invoice numbers and the logo.',
      },
      {
        q: 'How do I keep a copy off the phone?',
        a: 'Use More → Backup & restore. Connect Google Drive to upload backups to your own Drive, or tap Export file and send it to WhatsApp or e-mail. A lost or reset phone takes the on-phone copies with it, so do this now and then.',
      },
      {
        q: 'How does Google Drive backup work?',
        a: 'Tap “Connect Google Drive”, choose your Google account and allow access. Backups are saved in a “BoxBook Backups” folder in your own Drive. Turn on “Upload the daily backup too” to add the daily copy there. On the phone the connection stays; in a browser Google asks again after about an hour.',
      },
      {
        q: 'How do I restore?',
        a: 'In Backup & restore pick a backup on the phone, choose “Restore from file”, or tap Restore under Google Drive. BoxBook shows what the backup contains and saves a safety copy of the current data first. Restoring replaces what is on the phone now.',
      },
      {
        q: 'I changed phone. What do I do?',
        a: 'With Cloud sync: install BoxBook and sign in under More → Cloud sync. Without it: open Backup & restore and restore from Google Drive (same Google account) or from the exported file.',
      },
    ],
  },
];

function Item({ q, a }: Qa) {
  return (
    <details className="group border-b border-border/60 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-[15px] font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronDown size={18} className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 text-[14px] leading-relaxed text-muted-foreground">{a}</div>
    </details>
  );
}

/** Help, frequently asked questions and the privacy policy. On the web it is also reachable at #help / #privacy. */
export function Help() {
  useEffect(() => {
    if (/^#privacy$/i.test(location.hash)) document.getElementById('privacy')?.scrollIntoView();
  }, []);
  return (
    <>
      <Header title="Help & FAQ" subtitle="Answers, and how your data is handled" back />
      <Page>
        <div className="lg:mx-auto lg:max-w-3xl">
          {GROUPS.map((g) => (
            <Section key={g.title} title={g.title}>
              <div className="card overflow-hidden">
                {g.items.map((it) => (
                  <Item key={it.q} {...it} />
                ))}
              </div>
            </Section>
          ))}

          <Section title="Privacy policy">
            <div id="privacy" className="card space-y-3 p-4 text-[14px] leading-relaxed">
              <div className="flex items-center gap-2 font-semibold">
                <ShieldCheck size={18} className="text-primary" /> Your data
              </div>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <b className="text-foreground">What BoxBook stores.</b> Your customers, orders, saved boxes, company profile (including bank details and logo) and settings, on this device, and in your business’s cloud when Cloud sync is on.
                </li>
                <li>
                  <b className="text-foreground">Staff only, no tracking.</b> Only people the owner invites can sign in, and each sees what their role allows. BoxBook has no analytics and no advertising.
                </li>
                <li>
                  <b className="text-foreground">Google Drive (optional).</b> If you connect it, BoxBook asks Google for two permissions: to see and manage only the files BoxBook itself creates in your Drive (“drive.file”), and your e-mail address, to show which account is connected. Backup files go to a “BoxBook Backups” folder in your own Drive and are read only by you and BoxBook. BoxBook cannot open any other file in your Drive. The sign-in token is kept on your device only.
                </li>
                <li>
                  <b className="text-foreground">Sharing is your choice.</b> Invoices, quotations and backups leave the device only when you press share, export or upload, and go where you send them (WhatsApp, e-mail, Drive…).
                </li>
                <li>
                  <b className="text-foreground">Taking it back.</b> Tap Disconnect in Backup & restore to forget the Google account on this device, and remove BoxBook’s access any time at myaccount.google.com → Security → Third-party access. Delete the “BoxBook Backups” folder in Drive to remove uploaded copies. Uninstalling the app removes the data stored inside it; backups you saved in Documents or exported yourself stay until you delete them.
                </li>
                <li>
                  <b className="text-foreground">Google’s rules.</b> BoxBook’s use of information received from Google APIs follows the Google API Services User Data Policy, including the Limited Use requirements.
                </li>
              </ul>
            </div>
          </Section>
        </div>
      </Page>
    </>
  );
}
