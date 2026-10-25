/** Reduce una foto en el navegador (máx. 1600 px por lado, JPEG): el servidor no procesa imágenes pesadas. */
export async function reducirImagen(archivo: File, maximo = 1600): Promise<Blob> {
  const bmp = await createImageBitmap(archivo);
  const k = Math.min(1, maximo / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok, mal) => c.toBlob((b) => (b ? ok(b) : mal(new Error('No pudimos leer la imagen.'))), 'image/jpeg', 0.85));
}
