import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './storage';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

/**
 * Sends a file through the system share sheet (WhatsApp, e-mail, Drive…). In a browser it uses the
 * Web Share API where files are supported (phones) and otherwise downloads the file.
 * Returns a message to toast when the file was downloaded instead of shared.
 */
export async function shareFile(name: string, bytes: Uint8Array, mime: string, title: string, text?: string): Promise<string | void> {
  if (isNative) {
    const w = await Filesystem.writeFile({ path: name, directory: Directory.Cache, data: toBase64(bytes) });
    await Share.share({ title, text, files: [w.uri], dialogTitle: title });
    return;
  }
  const file = new File([bytes as BlobPart], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
    } catch {
      /* cancelled */
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `Downloaded ${name}`;
}
