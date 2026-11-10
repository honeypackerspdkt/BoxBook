import type { CompanySettings } from './types';

/** Starting values for a new company (also the defaults the app fills in for missing fields). */
export const defaultCompany: CompanySettings = {
  businessName: '',
  businessPhone: '',
  businessAddress: '',
  businessGstin: '',
  businessEmail: '',
  businessTagline: '',
  businessState: '33',
  businessLogo: '',
  bankHolder: '',
  bankName: '',
  bankAccount: '',
  bankBranch: '',
  bankIfsc: '',
  invoiceDeclaration: 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  invoicePrefix: '',
  nextInvoiceNo: 1,
  defaultHsn: '48191010',
  defaultUnit: 'Nos.',
  currency: '₹',
  // GST on corrugated boxes (HSN 4819) is 5% from 22 Sep 2025.
  defaults: { overhead: 0, profitPct: 25, taxPct: 5 },
  stockWastePct: 5,
  autoIssue: true,
  stockMin: {},
  reelWidths: [],
  payModes: ['Cash', 'UPI', 'Bank transfer', 'Cheque', 'Other'],
};
