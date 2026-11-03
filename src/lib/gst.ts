/** GST state codes (first two digits of a GSTIN). */
export const GST_STATES: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

export const stateName = (code: string): string => GST_STATES[code] || '';

/** State code from the first two digits of a GSTIN, or '' when it is not a known code. */
export function stateFromGstin(gstin: string): string {
  const code = (gstin || '').trim().slice(0, 2);
  return GST_STATES[code] ? code : '';
}

export interface TaxSplit {
  /** true = IGST (buyer in another state); false = CGST + SGST. */
  inter: boolean;
  rate: number; // total GST rate in %
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

/**
 * Splits the GST on a taxable value. Same state: half CGST, half SGST. Different state: IGST.
 * Amounts are rounded to paise individually, as on a printed invoice, so the lines add up.
 */
export function splitTax(taxable: number, ratePct: number, inter: boolean): TaxSplit {
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const total = r2((taxable * ratePct) / 100);
  if (inter) return { inter, rate: ratePct, taxable, cgst: 0, sgst: 0, igst: total, total };
  const half = r2(total / 2);
  return { inter, rate: ratePct, taxable, cgst: half, sgst: r2(total - half), igst: 0, total };
}
