// Small image helpers.

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
