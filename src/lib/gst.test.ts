import { describe, expect, it } from 'vitest';
import { splitTax, stateFromGstin, stateName } from './gst';
import { numberToWords, rupeesInWords } from './words';

describe('amount in words (Indian system)', () => {
  it('matches the sample invoice wording', () => {
    expect(rupeesInWords(7552)).toBe('INR Seven Thousand Five Hundred Fifty Two Only');
    expect(rupeesInWords(1152)).toBe('INR One Thousand One Hundred Fifty Two Only');
  });
  it('uses lakh and crore', () => {
    expect(numberToWords(100000)).toBe('One Lakh');
    expect(numberToWords(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
  });
  it('handles paise and zero', () => {
    expect(rupeesInWords(10.5)).toBe('INR Ten and Fifty Paise Only');
    expect(rupeesInWords(0)).toBe('INR Zero Only');
  });
});

describe('GST', () => {
  it('reads the state from the GSTIN', () => {
    expect(stateFromGstin('33ABQFM7004D1ZH')).toBe('33');
    expect(stateName('33')).toBe('Tamil Nadu');
    expect(stateFromGstin('99XXXX')).toBe('');
    expect(stateFromGstin('')).toBe('');
  });
  it('splits into CGST and SGST inside the state (sample invoice)', () => {
    const t = splitTax(6400, 18, false);
    expect(t).toMatchObject({ cgst: 576, sgst: 576, igst: 0, total: 1152 });
  });
  it('charges IGST between states', () => {
    expect(splitTax(6400, 18, true)).toMatchObject({ cgst: 0, sgst: 0, igst: 1152, total: 1152 });
  });
  it('keeps CGST + SGST equal to the total when it has an odd paisa', () => {
    const t = splitTax(100.5, 5, false); // 5.025 -> 5.03 total
    expect(t.cgst + t.sgst).toBeCloseTo(t.total, 2);
  });
});
