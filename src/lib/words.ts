const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const out: string[] = [];
  if (n >= 100) {
    out.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]);
    n %= 10;
  }
  if (n > 0) out.push(ONES[n]);
  return out.join(' ');
}

/** Whole number in the Indian system (thousand, lakh, crore). */
export function numberToWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${below1000(crore)} Crore`);
  if (lakh) parts.push(`${below1000(lakh)} Lakh`);
  if (thousand) parts.push(`${below1000(thousand)} Thousand`);
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

/** "INR Seven Thousand Five Hundred Fifty Two Only" — the amount line on a tax invoice. */
export function rupeesInWords(amount: number): string {
  const paise = Math.round((Math.abs(amount) + Number.EPSILON) * 100);
  const rupees = Math.floor(paise / 100);
  const ps = paise % 100;
  let s = `INR ${numberToWords(rupees)}`;
  if (ps) s += ` and ${numberToWords(ps)} Paise`;
  return `${s} Only`;
}
