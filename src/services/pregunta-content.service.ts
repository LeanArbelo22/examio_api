import { DbBanco, consultar } from './banco-common.service';

export type TipoAlmacenPregunta = 'evaluacion' | 'banco';

const definiciones = {
  evaluacion: {
    tablaPregunta: 'dbo.Pregunta',
    tablaOpcion: 'dbo.Opcion',
    ordenOpcion: 'O.Id',
  },
  banco: {
    tablaPregunta: 'dbo.BancoPregunta',
    tablaOpcion: 'dbo.BancoOpcion',
    ordenOpcion: 'O.Posicion,O.Id',
  },
} as const;

/**
 * Materializa una identidad de contenido, no de procedencia. Los nombres de tabla
 * provienen exclusivamente del mapa cerrado anterior; los datos siguen
 * parametrizados.
 */
export async function actualizarContenidoHash(db: DbBanco, almacenamiento: TipoAlmacenPregunta, idPregunta: number) {
  const d = definiciones[almacenamiento];
  await consultar(db, `UPDATE P SET ContenidoHash=CONVERT(char(64),HASHBYTES('SHA2_256',CONVERT(nvarchar(max),
      CONCAT(N'v1|',P.Tipo,N'|',P.Enunciado,N'|',P.ModoJustificacion,N'|',P.EstrategiaCorreccion,N'|',
        P.TratamientoJustificacion,N'|',COALESCE((SELECT ROW_NUMBER() OVER (ORDER BY ${d.ordenOpcion}) AS posicion,
          O.Texto AS texto,O.EsCorrecta AS esCorrecta FROM ${d.tablaOpcion} O
          WHERE O.IdPregunta=P.Id ORDER BY ${d.ordenOpcion} FOR JSON PATH),N'[]')))),2)
    FROM ${d.tablaPregunta} P WHERE P.Id=@Id`, { Id: idPregunta });
}

