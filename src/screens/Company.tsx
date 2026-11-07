import { useRef, useState, type ChangeEvent } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useStore } from '../store';
import { useNav } from '../nav';
import { GST_STATES, stateFromGstin } from '@honeypackers/box-core/gst';
import type { Settings } from '../lib/types';
import { Field, Header, NumInput, Page, Section } from '../ui';

const LOGO_MAX = 400; // px; keeps the logo (and every backup that contains it) small

/** Reads an image file and returns a PNG data URL no bigger than LOGO_MAX on its longest side. */
export function logoFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, LOGO_MAX / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image we can read'));
    };
    img.src = url;
  });
}

type TextKey =
  | 'businessName'
  | 'businessTagline'
  | 'businessAddress'
  | 'businessPhone'
  | 'businessEmail'
  | 'businessGstin'
  | 'bankHolder'
  | 'bankName'
  | 'bankAccount'
  | 'bankBranch'
  | 'bankIfsc'
  | 'invoicePrefix'
  | 'defaultHsn'
  | 'defaultUnit'
  | 'invoiceDeclaration';

/** Company profile: who the invoices come from — name, logo, GST, address, bank and invoice defaults. */
export function Company() {
  const { data, updateSettings, toast } = useStore();
  const nav = useNav();
  const [s, setS] = useState<Settings>(data.settings);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = (k: TextKey) => (e: { target: { value: string } }) => setS((x) => ({ ...x, [k]: e.target.value }));

  const setGstin = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.toUpperCase();
    const st = stateFromGstin(v);
    setS((x) => ({ ...x, businessGstin: v, businessState: st || x.businessState }));
  };

  const pickLogo = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const logo = await logoFromFile(f);
      setS((x) => ({ ...x, businessLogo: logo }));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that image');
    }
  };

  const save = () => {
    if (!s.businessName.trim()) {
      toast('Enter the company name');
      return;
    }
    updateSettings({
      businessName: s.businessName.trim(),
      businessTagline: s.businessTagline.trim(),
      businessAddress: s.businessAddress.trim(),
      businessPhone: s.businessPhone.trim(),
      businessEmail: s.businessEmail.trim(),
      businessGstin: s.businessGstin.trim().toUpperCase(),
      businessState: s.businessState,
      businessLogo: s.businessLogo,
      bankHolder: s.bankHolder.trim(),
      bankName: s.bankName.trim(),
      bankAccount: s.bankAccount.trim(),
      bankBranch: s.bankBranch.trim(),
      bankIfsc: s.bankIfsc.trim().toUpperCase(),
      invoicePrefix: s.invoicePrefix.trim(),
      nextInvoiceNo: Math.max(1, Math.floor(s.nextInvoiceNo) || 1),
      defaultHsn: s.defaultHsn.trim(),
      defaultUnit: s.defaultUnit.trim() || 'Nos.',
      invoiceDeclaration: s.invoiceDeclaration.trim(),
    });
    toast('Company profile saved');
    nav.back();
  };

  return (
    <>
      <Header title="Company profile" subtitle="Printed on your invoices" back />
      <Page>
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
          <div>
            <Section title="Logo">
              <div className="card flex items-center gap-4 p-4">
                <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-2xl border border-border bg-card">
                  {s.businessLogo ? <img src={s.businessLogo} alt="Company logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus size={30} className="text-muted-foreground" />}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[13px] text-muted-foreground">Shown at the top of every invoice and kept inside your backups.</p>
                  <div className="flex gap-2">
                    <button className="btn-ghost !px-3 !py-2 text-[14px]" onClick={() => fileRef.current?.click()}>
                      <ImagePlus size={16} /> {s.businessLogo ? 'Change' : 'Add logo'}
                    </button>
                    {s.businessLogo && (
                      <button className="btn-danger !px-3 !py-2 text-[14px]" aria-label="Remove logo" onClick={() => setS((x) => ({ ...x, businessLogo: '' }))}>
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={pickLogo} />
                </div>
              </div>
            </Section>

            <Section title="Company">
              <div className="card space-y-4 p-4">
                <Field label="Company name *">
                  <input className="input" value={s.businessName} onChange={text('businessName')} placeholder="HONEY PACKERS" />
                </Field>
                <Field label="Tagline (optional)" hint="Printed under the address, e.g. an ISO certification line.">
                  <input className="input" value={s.businessTagline} onChange={text('businessTagline')} placeholder="An ISO 9001 : 2015 Certified Company" />
                </Field>
                <Field label="Address">
                  <textarea className="input min-h-[88px]" value={s.businessAddress} onChange={text('businessAddress')} placeholder={'845, Valayampatty, Thirumayam (TK)\nPudukkottai - 622506'} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Mobile">
                    <input className="input" type="tel" inputMode="tel" value={s.businessPhone} onChange={text('businessPhone')} />
                  </Field>
                  <Field label="E-mail">
                    <input className="input" type="email" inputMode="email" value={s.businessEmail} onChange={text('businessEmail')} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="GSTIN">
                    <input className="input uppercase" value={s.businessGstin} onChange={setGstin} maxLength={15} />
                  </Field>
                  <Field label="State">
                    <select className="input" value={s.businessState} onChange={(e) => setS({ ...s, businessState: e.target.value })}>
                      <option value="">— Select —</option>
                      {Object.entries(GST_STATES).map(([code, name]) => (
                        <option key={code} value={code}>
                          {name} ({code})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            </Section>
          </div>

          <div>
            <Section title="Bank details">
              <div className="card space-y-4 p-4">
                <Field label="Account holder">
                  <input className="input" value={s.bankHolder} onChange={text('bankHolder')} placeholder={s.businessName || 'Same as company name'} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Bank name">
                    <input className="input" value={s.bankName} onChange={text('bankName')} />
                  </Field>
                  <Field label="A/c number">
                    <input className="input" inputMode="numeric" value={s.bankAccount} onChange={text('bankAccount')} />
                  </Field>
                  <Field label="Branch">
                    <input className="input" value={s.bankBranch} onChange={text('bankBranch')} />
                  </Field>
                  <Field label="IFSC">
                    <input className="input uppercase" value={s.bankIfsc} onChange={text('bankIfsc')} maxLength={11} />
                  </Field>
                </div>
              </div>
            </Section>

            <Section title="Invoice settings">
              <div className="card space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Invoice prefix" hint="Optional, e.g. HP/">
                    <input className="input" value={s.invoicePrefix} onChange={text('invoicePrefix')} />
                  </Field>
                  <Field label="Next invoice no.">
                    <NumInput value={s.nextInvoiceNo} onValue={(v) => setS((x) => ({ ...x, nextInvoiceNo: v }))} />
                  </Field>
                  <Field label="Default HSN / SAC">
                    <input className="input" inputMode="numeric" value={s.defaultHsn} onChange={text('defaultHsn')} />
                  </Field>
                  <Field label="Default unit">
                    <input className="input" value={s.defaultUnit} onChange={text('defaultUnit')} />
                  </Field>
                </div>
                <Field label="Declaration">
                  <textarea className="input min-h-[88px]" value={s.invoiceDeclaration} onChange={text('invoiceDeclaration')} />
                </Field>
              </div>
            </Section>
          </div>
        </div>

        <button className="btn-primary w-full lg:mx-auto lg:block lg:max-w-sm" onClick={save}>
          Save company profile
        </button>
      </Page>
    </>
  );
}
