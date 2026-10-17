/*
  Parche puntual para ambientes que aplicaron la etapa 3 antes de que el render
  expusiera IdIntentoPregunta. No modifica tablas, datos ni otros procedimientos.

  Puede ejecutarse más de una vez.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_ObtenerExamenDinamico
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT IP.Id AS IdIntentoPregunta,IP.IdPregunta,
      COALESCE(IP.EnunciadoSnapshot,P.Enunciado) AS Enunciado,
      COALESCE(IP.TipoSnapshot,P.Tipo) AS Tipo,
      COALESCE(IP.GrupoTituloSnapshot,GP.TituloReferencia) AS GrupoConceptualmente,
      IP.ModoJustificacionSnapshot AS ModoJustificacion,
      IP.EstrategiaCorreccionSnapshot AS EstrategiaCorreccion,
      IP.TratamientoJustificacionSnapshot AS TratamientoJustificacion,
      IP.PuntajeMaximoSnapshot AS PuntajeMaximo,A.MostrarPuntajePorPregunta,
      R.Id AS IdRespuesta,R.RtaTexto,R.Justificacion,R.Revision,
      COALESCE((SELECT RO.IdOpcion AS idOpcion
        FROM dbo.RespuestaOpcion RO WHERE RO.IdRespuesta=R.Id
        ORDER BY RO.IdOpcion FOR JSON PATH),N''[]'') AS OpcionesSeleccionadasJson
    FROM dbo.IntentoPregunta IP
    LEFT JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
    LEFT JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
    JOIN dbo.Intento I ON I.Id=IP.IdIntento
    JOIN dbo.Publicacion PU ON PU.Id=I.IdPublicacion
    JOIN dbo.Actividad A ON A.Id=PU.IdActividad
    LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
    WHERE IP.IdIntento=@IdIntento
    ORDER BY IP.Id;
  END;');

  IF NOT EXISTS (
    SELECT 1
    FROM sys.dm_exec_describe_first_result_set_for_object(
      OBJECT_ID('dbo.SP_Intento_ObtenerExamenDinamico'),0
    )
    WHERE name='IdIntentoPregunta'
  )
    THROW 50001,'SP_Intento_ObtenerExamenDinamico no expone IdIntentoPregunta',1;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;

SELECT column_ordinal,name,system_type_name,is_nullable
FROM sys.dm_exec_describe_first_result_set_for_object(
  OBJECT_ID('dbo.SP_Intento_ObtenerExamenDinamico'),0
)
WHERE name IN ('IdIntentoPregunta','IdPregunta')
ORDER BY column_ordinal;
