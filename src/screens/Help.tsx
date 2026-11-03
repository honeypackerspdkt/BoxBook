import { useEffect, type ReactNode } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { Header, Page, Section } from '../ui';

interface Qa {
  q: string;
  a: ReactNode;
}

const GROUPS: { title: string; items: Qa[] }[] = [
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
        a: 'First fill in More → Company profile (name, logo, GSTIN, address, bank details). Then open an order and tap “Make & share invoice (PDF)”. The PDF opens the share sheet, so you can send it on WhatsApp, e-mail or save it to Drive. On a computer it downloads instead.',
      },
      {
        q: 'CGST + SGST or IGST?',
        a: 'BoxBook compares the state of your company with the customer’s state (taken from the GSTIN, or chosen in the customer’s details). Same state: CGST + SGST. Different state: IGST. Set the customer’s state if the GSTIN is missing.',
      },
      {
        q: 'How are invoice numbers given?',
        a: 'The first time you make an invoice for an order it gets the next number from Company profile (with your prefix, if any). The number is kept for that order, so sharing it again never creates a new one. To start from another number, change “Next invoice no.”.',
      },
      {
        q: 'Where do I add HSN, dispatch and delivery details?',
        a: 'In the order editor: HSN and unit per item, and “Tax invoice details” for dispatch, destination, terms of payment and delivery note.',
      },
    ],
  },
  {
    title: 'Backup & restore',
    items: [
      {
        q: 'Where is my data kept?',
        a: 'Only on this phone (or in this browser). There is no BoxBook server and no account.',
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
        a: 'Install BoxBook, open Backup & restore and either restore from Google Drive (sign in with the same Google account) or from the exported file.',
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
                <ShieldCheck size={18} className="text-primary" /> Your data stays with you
              </div>
              <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
                <li>
                  <b className="text-foreground">What BoxBook stores.</b> Your customers, orders, saved boxes, company profile (including bank details and logo) and settings. They are kept only on your device.
                </li>
                <li>
                  <b className="text-foreground">No account, no server, no tracking.</b> BoxBook has no sign-up, no analytics, no advertising and sends nothing to its developer.
                </li>
                <li>
                  <b className="text-foreground">Google Drive (optional).</b> If you connect it, BoxBook asks Google for two permissions: to see and manage only the files BoxBook itself creates in your Drive (“drive.file”), and your e-mail address, to show which account is connected. Backup files go to a “BoxBook Backups” folder in your own Drive and are read only by you and the app. BoxBook cannot open any other file in your Drive. The sign-in token is kept on your device only.
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
