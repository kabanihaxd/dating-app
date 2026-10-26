// Уменьшает фото до maxSize пикселей по большей стороне и сжимает в JPEG.
// Фото с телефона весит 3–5 МБ, после сжатия — около 30–60 КБ: столько можно хранить прямо в документе Firestore.
// createImageBitmap выбросит ошибку, если файл не картинка.
export async function resizeImage(file: File, maxSize = 512, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', quality);
}
