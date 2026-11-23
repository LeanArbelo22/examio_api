import { isAbsolute, resolve } from 'node:path';

// valida formato idPublicacion e idIntento
const formatoId = /^[1-9]\d*$/;
// valida formato uuid del nombre del archivo (captura) + formato
const formatoNombreArchivo =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/;

export function resolverRutaCaptura(rutaRelativa: string): string {
  const partes = rutaRelativa.split('/');
  const [publicacion = '', intento = '', archivo = ''] = partes;

  // estructura carpetas: idPublicacion/idIntento/idCaptura.formato
  const formatoValido =
    partes.length === 3 &&
    formatoId.test(publicacion) &&
    formatoId.test(intento) &&
    formatoNombreArchivo.test(archivo);

  if (rutaRelativa.length > 255 || !formatoValido) { // rutaRelativa es varchar(255) en la base de datos
    throw new Error('La ruta relativa de la captura es inválida.');
  }

  const carpetaCapturas = (process.env.CAPTURAS_ALUMNOS_DIR ?? '').trim();

  if (!isAbsolute(carpetaCapturas)) {
    throw new Error('CAPTURAS_ALUMNOS_DIR debe ser una ruta absoluta.');
  }

  return resolve(carpetaCapturas, publicacion, intento, archivo);
}

export function generarUbicacionCaptura(
  idPublicacion: number,
  idIntento: number,
  idCaptura: string,
  extension: string,
) {
  const nombreArchivo = `${idCaptura.toLowerCase()}.${extension.toLowerCase()}`;
  const rutaRelativa = `${idPublicacion}/${idIntento}/${nombreArchivo}`;
  const rutaAbsoluta = resolverRutaCaptura(rutaRelativa);

  return { rutaRelativa, rutaAbsoluta };
}