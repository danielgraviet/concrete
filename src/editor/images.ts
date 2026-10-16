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

/**
 * One upload/preview pair, shared by paste, drag-drop, and the image dialog's
 * file picker (all three route through MDXEditor's imagePlugin handlers).
 * `getContext` is read at call time so it stays correct across note switches
 * without needing to rebuild the MDXEditor plugin list.
 */
export function createImageHandlers(getContext: () => ImageEditingContext) {
  const imageUploadHandler = async (file: File): Promise<string> => {
    const { vaultRoot, notePath } = getContext();
    if (!vaultRoot || !notePath || !window.vault?.saveImage) {
      throw new Error('Image upload is only available inside the desktop app.');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new Error('Image is larger than 8 MB.');
    }
    // A Blob built from a `data:...;charset=utf-8,...` URI (how ChatGPT/Claude
    // web expose a copied inline-SVG diagram) keeps the charset on `.type` —
    // strip it before matching/forwarding the bare mime type.
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

/** Inserted images default to this width (px) instead of their native size — still fully resizable larger. */
export const DEFAULT_IMAGE_WIDTH = 420;

/**
 * Natural width for a not-yet-uploaded image file, so a freshly inserted
 * image can default to a sensible size instead of rendering at native
 * (often huge) resolution. Never upscales a smaller image.
 */
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

/**
 * ChatGPT/Claude web render a generated diagram as an `<img src="data:image/...">`
 * rather than a hosted URL, so there's no real bitmap for the browser to put
 * on the clipboard as an `image/*` item — only the HTML fragment (and often a
 * plain-text fallback that's just the raw data URI). MDXEditor's image paste
 * handling only watches for `image/*` clipboard items, so it never sees this;
 * worse, Lexical's own default HTML-paste conversion will happily create an
 * `ImageNode` straight from that `<img src="data:...">` tag — full native
 * size, never saved to disk, de facto invisible (any further edit/reload
 * round-trip chokes on a multi-KB `src`). We pull the URI out of either
 * clipboard representation ourselves and ingest it through the normal
 * upload pipeline instead.
 */
export function extractPastedImageDataUrl(clipboardData: DataTransfer): string | null {
  const plain = clipboardData.getData('text/plain');
  if (isImageDataUrl(plain)) return plain.trim();
  const html = clipboardData.getData('text/html');
  const match = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html);
  if (match && isImageDataUrl(match[1])) return match[1];
  return null;
}

/** Turns a pasted `data:image/...` URI into markdown ready for `insertMarkdown`. */
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
