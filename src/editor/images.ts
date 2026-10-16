const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

export type ImageEditingContext = {
  vaultRoot?: string;
  notePath?: string;
};

export function createImageHandlers(getContext: () => ImageEditingContext) {
  const imageUploadHandler = async (file: File): Promise<string> => {
    const { vaultRoot, notePath } = getContext();
    if (!vaultRoot || !notePath || !window.vault?.saveImage) {
      throw new Error('Image upload is only available inside the desktop app.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Image is larger than 8 MB.');
    }
    // blob built from a `data:...;charset=utf-8,...` so copy paste from LLMs works
    const mime = file.type.split(';')[0].trim().toLowerCase();
    if (mime && !ALLOWED_IMAGE_MIME.has(mime)) {
      throw new Error(`Unsupported image type: ${mime}`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return window.vault.saveImage(vaultRoot, notePath, bytes, mime, file.name);
  };

  const imagePreviewHandler = async (src: string): Promise<string> => {
    if (/^(https?:|data:|blob:)/i.test(src)) return src;
    const { vaultRoot, notePath } = getContext();
    if (!vaultRoot || !notePath || !window.vault?.readImageDataUrl) return src;
    const dataUrl = await window.vault.readImageDataUrl(vaultRoot, notePath, src);
    return dataUrl || src;
  };

  return { imageUploadHandler, imagePreviewHandler };
}

export const DEFAULT_IMAGE_WIDTH = 420;

// make default images small, user can enlarge.
export function computeDefaultImageWidth(file: File): Promise<number> {
  if (file.type.startsWith('image/svg+xml')) return Promise.resolve(DEFAULT_IMAGE_WIDTH);
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const probe = new Image();
    probe.onload = () => {
      resolve(probe.naturalWidth > 0 ? Math.min(DEFAULT_IMAGE_WIDTH, probe.naturalWidth) : DEFAULT_IMAGE_WIDTH);
      URL.revokeObjectURL(url);
    };
    probe.onerror = () => {
      resolve(DEFAULT_IMAGE_WIDTH);
      URL.revokeObjectURL(url);
    };
    probe.src = url;
  });
}

function isImageDataUrl(text: string): boolean {
  return /^data:image\//i.test(text.trim());
}

export function extractPastedImageDataUrl(clipboardData: DataTransfer): string | null {
  const plain = clipboardData.getData('text/plain');
  if (isImageDataUrl(plain)) return plain.trim();
  const html = clipboardData.getData('text/html');
  const match = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html);
  if (match && isImageDataUrl(match[1])) return match[1];
  return null;
}

export async function buildImageMarkdownFromDataUrl(
  dataUrl: string,
  imageUploadHandler: (file: File) => Promise<string>,
): Promise<string> {
  const blob = await (await fetch(dataUrl.trim())).blob();
  const file = new File([blob], 'pasted-image', { type: blob.type });
  const width = await computeDefaultImageWidth(file);
  const src = await imageUploadHandler(file);
  return `<img src="${src.replace(/"/g, '&quot;')}" alt="" width="${width}" />`;
}
