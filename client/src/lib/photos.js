// Micșorarea pozelor în browser, înainte de salvare (enunțul: „fotografii demonstrative”).
// Latura lungă devine maximum 640 px, apoi JPEG; calitatea scade până când poza are ≤ 200 KB.

export const MAX_PHOTOS = 3;
export const MAX_PHOTO_BYTES = 200 * 1024;
const MAX_SIDE = 640;

const bytesOf = (dataUrl) => Math.floor(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4);

export async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  for (const quality of [0.7, 0.55, 0.4, 0.3]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (bytesOf(dataUrl) <= MAX_PHOTO_BYTES) return dataUrl;
  }
  throw new Error('Poza nu poate fi micșorată sub 200 KB');
}
