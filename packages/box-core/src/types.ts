/** Shared data model for BoxBook (app), the honeypackers.in website and server functions. */

export type Ply = 3 | 5 | 7 | 9;

export interface PaperLayer {
  gsm: number;
  bf: number;
  price: number; // per kg
}

export interface BoxSpec {
  length: number; // mm
  width: number; // mm
  height: number; // mm
  ply: Ply;
  perLayer: boolean; // false = same paper for every layer (layer 1 used)
  layers: PaperLayer[]; // always 9 entries, index 0 = top liner
}

export interface BoxResult {
  cutSize: number; // mm
  deckleSize: number; // mm
  sheets: number;
  weight: number; // grams
  bs: number; // bursting strength (kg/cm²)
  paperCost: number; // per box
}

export interface Pricing {
  overhead: number; // per box
  profitPct: number;
  taxPct: number;
}

export interface SavedBox {
  id: string;
  name: string;
  customerId?: string;
  spec: BoxSpec;
  pricing: Pricing;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  /** GST state code (e.g. '33'); when empty it is taken from the GSTIN. */
  stateCode?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus = 'quote' | 'confirmed' | 'production' | 'ready' | 'delivered' | 'cancelled';

export interface OrderItem {
  id: string;
  description: string;
  qty: number;
  rate: number;
  /** HSN/SAC code for the tax invoice; falls back to the company default. */
  hsn?: string;
  /** Unit shown after the rate on the invoice, e.g. 'Nos.'. */
  unit?: string;
  spec?: BoxSpec;
  boxId?: string;
}

export interface Payment {
  id: string;
  date: string; // yyyy-mm-dd
  amount: number;
  mode: string;
  note: string;
}

/** Extra fields printed in the header grid of the tax invoice. All optional. */
export interface InvoiceMeta {
  deliveryNote?: string;
  termsOfPayment?: string;
  dispatchDocNo?: string;
  deliveryNoteDate?: string;
  dispatchedThrough?: string;
  destination?: string;
  termsOfDelivery?: string;
}

export interface Order {
  id: string;
  number: string;
  customerId: string;
  date: string; // yyyy-mm-dd
  dueDate: string; // yyyy-mm-dd or ''
  status: OrderStatus;
  items: OrderItem[];
  discount: number; // amount
  taxPct: number;
  payments: Payment[];
  notes: string;
  /** Assigned the first time an invoice PDF is made, then kept. */
  invoiceNo?: string;
  invoice?: InvoiceMeta;
  /** Delivery details (address, pincode, zone, courier, AWB) — filled for website orders and at dispatch. */
  delivery?: Record<string, unknown>;
  /** Customer name from the server, for staff who cannot see customer records (production). */
  customerName?: string;
  /** Where the order came from; missing = made in the app. */
  source?: 'app' | 'web';
  createdAt: string;
  updatedAt: string;
}

/** Company profile, invoice set-up and pricing defaults: the part of the settings shared by every device
 *  and the website (org_settings in Supabase). Device-only preferences live in the app's Settings. */
/** A pack size of a standard product: `qty` boxes for `price` (before GST). */
export interface ProductPack {
  qty: number;
  price: number;
}

/** A fixed-size box sold in packs on the website (Supabase `products`). */
export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  ply: Ply;
  /** Inside size and board (paper layers; prices in it are not used). */
  spec: BoxSpec;
  packs: ProductPack[];
  hsn: string;
  taxPct: number;
  /** Boxes in stock; null = made to order. */
  stockQty: number | null;
  photos: string[];
  active: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface CompanySettings {
  businessName: string;
  businessPhone: string;
  businessAddress: string;
  businessGstin: string;
  businessEmail: string;
  /** One line under the name on the invoice, e.g. 'An ISO 9001 : 2015 Certified Company'. */
  businessTagline: string;
  /** GST state code of the company, e.g. '33' for Tamil Nadu. */
  businessState: string;
  /** Company logo as a data URL (kept inside backups). */
  businessLogo: string;
  bankHolder: string;
  bankName: string;
  bankAccount: string;
  bankBranch: string;
  bankIfsc: string;
  invoiceDeclaration: string;
  invoicePrefix: string;
  nextInvoiceNo: number;
  defaultHsn: string;
  defaultUnit: string;
  currency: string;
  defaults: Pricing;
}
