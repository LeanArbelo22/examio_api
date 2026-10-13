/*
  Etapa 2: renderizado inmutable, guardado por conjunto y corrección automática.

  Requiere 20261013_respuestas_multiples_justificacion.sql.
  Es transaccional e idempotente. No recalifica intentos ya entregados.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  IF OBJECT_ID(N'dbo.IntentoPreguntaOpcionSnapshot',N'U') IS NULL OR
     OBJECT_ID(N'dbo.HistorialRespuestaCambio',N'U') IS NULL OR
     COL_LENGTH('dbo.Respuesta','Revision') IS NULL
    THROW 51310, 'Debe aplicarse primero 20261013_respuestas_multiples_justificacion.sql.', 1;

  IF COL_LENGTH('dbo.IntentoPregunta','EnunciadoSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD EnunciadoSnapshot NVARCHAR(MAX) NULL;
  IF COL_LENGTH('dbo.IntentoPregunta','GrupoTituloSnapshot') IS NULL
    ALTER TABLE dbo.IntentoPregunta ADD GrupoTituloSnapshot NVARCHAR(500) NULL;

  EXEC(N'UPDATE IP SET
      EnunciadoSnapshot=COALESCE(IP.EnunciadoSnapshot,P.Enunciado),
      GrupoTituloSnapshot=COALESCE(IP.GrupoTituloSnapshot,GP.TituloReferencia),
      SnapshotReconstruido=CASE WHEN IP.EnunciadoSnapshot IS NULL OR IP.GrupoTituloSnapshot IS NULL
        THEN 1 ELSE IP.SnapshotReconstruido END
    FROM dbo.IntentoPregunta IP
    JOIN dbo.Pregunta P ON P.Id=IP.IdPregunta
    JOIN dbo.GrupoPregunta GP ON GP.Id=P.IdGrupoPregunta
    WHERE IP.EnunciadoSnapshot IS NULL OR IP.GrupoTituloSnapshot IS NULL;');

  IF EXISTS (
    SELECT 1 FROM dbo.Respuesta GROUP BY IdIntento,IdPregunta HAVING COUNT_BIG(*)>1
  ) THROW 51311, 'Existen respuestas duplicadas por intento/pregunta.', 1;

  IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id=OBJECT_ID(N'dbo.Respuesta') AND name=N'UX_Respuesta_Intento_Pregunta'
  ) EXEC(N'CREATE UNIQUE INDEX UX_Respuesta_Intento_Pregunta
      ON dbo.Respuesta(IdIntento,IdPregunta);');

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_IniciarExamen
    @IdPublicacion INT,
    @IdAlumno INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRANSACTION;
      DECLARE @IdIntento INT,@IdActividad INT,@ProximoIntento INT=1,@Escala INT=10;

      SELECT @IdActividad=P.IdActividad,@Escala=A.EscalaCalificacion
      FROM dbo.Publicacion P JOIN dbo.Actividad A ON A.Id=P.IdActividad
      WHERE P.Id=@IdPublicacion;

      SELECT @IdIntento=Id FROM dbo.Intento WITH (UPDLOCK,HOLDLOCK)
      WHERE IdPublicacion=@IdPublicacion AND IdAlumno=@IdAlumno AND Estado=''en_progreso'';

      IF @IdIntento IS NULL
      BEGIN
        SELECT @ProximoIntento=ISNULL(MAX(NumeroIntento),0)+1
        FROM dbo.Intento WITH (UPDLOCK,HOLDLOCK)
        WHERE IdPublicacion=@IdPublicacion AND IdAlumno=@IdAlumno;

        INSERT INTO dbo.Intento(IdPublicacion,IdAlumno,NumeroIntento,FechaInicio,Estado)
        VALUES(@IdPublicacion,@IdAlumno,@ProximoIntento,SYSUTCDATETIME(),''en_progreso'');
        SET @IdIntento=SCOPE_IDENTITY();

        ;WITH Grupos AS (
          SELECT GP.Id,GP.TituloReferencia,GP.PuntajeMaximo,
            ROW_NUMBER() OVER (ORDER BY GP.Id) AS Posicion,
            COUNT(*) OVER () AS TotalGrupos
          FROM dbo.GrupoPregunta GP WHERE GP.IdActividad=@IdActividad
        )
        INSERT INTO dbo.IntentoPregunta
          (IdIntento,IdPregunta,PuntajeMaximoSnapshot,TipoSnapshot,ModoJustificacionSnapshot,
           EstrategiaCorreccionSnapshot,TratamientoJustificacionSnapshot,ContenidoHashSnapshot,
           EnunciadoSnapshot,GrupoTituloSnapshot,SnapshotReconstruido)
        SELECT @IdIntento,P.Id,
          CAST(COALESCE(G.PuntajeMaximo,
            ((@Escala*100/G.TotalGrupos)+CASE WHEN G.Posicion<=((@Escala*100)%G.TotalGrupos)
              THEN 1 ELSE 0 END)/100.0) AS DECIMAL(5,2)),
          P.Tipo,P.ModoJustificacion,P.EstrategiaCorreccion,P.TratamientoJustificacion,
          P.ContenidoHash,P.Enunciado,G.TituloReferencia,0
        FROM Grupos G
        CROSS APPLY (
          SELECT TOP 1 P.* FROM dbo.Pregunta P
          WHERE P.IdGrupoPregunta=G.Id ORDER BY NEWID()
        ) P;

        INSERT INTO dbo.IntentoPreguntaOpcionSnapshot
          (IdIntentoPregunta,IdOpcionOrigen,TextoSnapshot,EsCorrectaSnapshot,Posicion)
        SELECT IP.Id,O.Id,O.Texto,O.EsCorrecta,
          ROW_NUMBER() OVER (PARTITION BY IP.Id ORDER BY O.Id)
        FROM dbo.IntentoPregunta IP
        JOIN dbo.Opcion O ON O.IdPregunta=IP.IdPregunta
        WHERE IP.IdIntento=@IdIntento;
      END;

      COMMIT TRANSACTION;
      SELECT @IdIntento AS IdIntento,''OK'' AS Status;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END;');

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_ObtenerExamenDinamico
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT IP.IdPregunta,
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

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Pregunta_ObtenerOpciones
    @IdPregunta INT,
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SELECT S.IdOpcionOrigen AS IdOpcion,S.TextoSnapshot AS Texto,
      S.EsCorrectaSnapshot AS EsCorrecta,
      CASE WHEN RO.IdOpcion IS NULL THEN 0 ELSE 1 END AS FueSeleccionada
    FROM dbo.IntentoPregunta IP
    JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
    LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
    LEFT JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta=R.Id AND RO.IdOpcion=S.IdOpcionOrigen
    WHERE IP.IdIntento=@IdIntento AND IP.IdPregunta=@IdPregunta
    ORDER BY S.Posicion;
  END;');

  EXEC(N'
  CREATE OR ALTER PROCEDURE dbo.SP_Intento_FinalizarExamen
    @IdIntento INT
  AS
  BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    BEGIN TRY
      BEGIN TRANSACTION;
      DECLARE @Estado VARCHAR(20),@CorreccionAutomatica BIT;
      SELECT @Estado=I.Estado,@CorreccionAutomatica=A.CorreccionAutomaticaCerradas
      FROM dbo.Intento I WITH (UPDLOCK,HOLDLOCK)
      JOIN dbo.Publicacion PU ON PU.Id=I.IdPublicacion
      JOIN dbo.Actividad A ON A.Id=PU.IdActividad
      WHERE I.Id=@IdIntento;

      IF @Estado IS NULL THROW 50001,''Intento no encontrado'',1;
      IF @Estado IN (''entregado'',''anulado'',''vencido'')
      BEGIN
        COMMIT TRANSACTION;
        SELECT Id,IdAlumno,IdPublicacion,Estado,NotaFinal,NotaAutomatica,
          NotaFinalCalculada,NotaFinalManual,FechaInicio,FechaFin
        FROM dbo.Intento WHERE Id=@IdIntento;
        RETURN;
      END;
      IF @Estado<>''en_progreso'' THROW 51321,''El intento no está en progreso'',1;

      IF EXISTS (
        SELECT 1
        FROM dbo.IntentoPregunta IP
        LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
        WHERE IP.IdIntento=@IdIntento
          AND IP.ModoJustificacionSnapshot=''obligatoria''
          AND ((IP.TipoSnapshot IN (''mc'',''multiple'',''vf'') AND EXISTS (
                 SELECT 1 FROM dbo.RespuestaOpcion RO WHERE RO.IdRespuesta=R.Id
               )) OR
               (IP.TipoSnapshot IN (''abierta'',''code'') AND NULLIF(LTRIM(RTRIM(R.RtaTexto)),N'''') IS NOT NULL))
          AND NULLIF(LTRIM(RTRIM(R.Justificacion)),N'''') IS NULL
      ) THROW 51320,''Falta una justificación obligatoria'',1;

      IF @CorreccionAutomatica=1
      BEGIN
        ;WITH Conteos AS (
          SELECT IP.Id AS IdIntentoPregunta,
            SUM(CASE WHEN S.EsCorrectaSnapshot=1 THEN 1 ELSE 0 END) AS TotalCorrectas,
            SUM(CASE WHEN S.EsCorrectaSnapshot=0 THEN 1 ELSE 0 END) AS TotalIncorrectas,
            SUM(CASE WHEN S.EsCorrectaSnapshot=1 AND RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS CorrectasElegidas,
            SUM(CASE WHEN S.EsCorrectaSnapshot=0 AND RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS IncorrectasElegidas,
            SUM(CASE WHEN RO.IdOpcion IS NOT NULL THEN 1 ELSE 0 END) AS TotalElegidas
          FROM dbo.IntentoPregunta IP
          JOIN dbo.IntentoPreguntaOpcionSnapshot S ON S.IdIntentoPregunta=IP.Id
          LEFT JOIN dbo.Respuesta R ON R.IdIntento=IP.IdIntento AND R.IdPregunta=IP.IdPregunta
          LEFT JOIN dbo.RespuestaOpcion RO ON RO.IdRespuesta=R.Id AND RO.IdOpcion=S.IdOpcionOrigen
          WHERE IP.IdIntento=@IdIntento AND IP.TipoSnapshot IN (''mc'',''multiple'',''vf'')
          GROUP BY IP.Id
        ), Calculos AS (
          SELECT IP.Id,
            CAST(ROUND(CASE IP.EstrategiaCorreccionSnapshot
              WHEN ''parcial_sin_penalizacion'' THEN
                IP.PuntajeMaximoSnapshot*CONVERT(DECIMAL(12,6),C.CorrectasElegidas)/NULLIF(C.TotalCorrectas,0)
              WHEN ''parcial_penalizada'' THEN
                CASE WHEN
                  CONVERT(DECIMAL(12,6),C.CorrectasElegidas)/NULLIF(C.TotalCorrectas,0)-
                  CASE WHEN C.TotalIncorrectas=0 THEN 0 ELSE
                    CONVERT(DECIMAL(12,6),C.IncorrectasElegidas)/C.TotalIncorrectas END < 0
                THEN 0 ELSE IP.PuntajeMaximoSnapshot*(
                  CONVERT(DECIMAL(12,6),C.CorrectasElegidas)/NULLIF(C.TotalCorrectas,0)-
                  CASE WHEN C.TotalIncorrectas=0 THEN 0 ELSE
                    CONVERT(DECIMAL(12,6),C.IncorrectasElegidas)/C.TotalIncorrectas END) END
              ELSE CASE WHEN C.CorrectasElegidas=C.TotalCorrectas AND C.IncorrectasElegidas=0
                THEN IP.PuntajeMaximoSnapshot ELSE 0 END
            END,2) AS DECIMAL(5,2)) AS PuntajeAutomatico,C.TotalElegidas
          FROM dbo.IntentoPregunta IP JOIN Conteos C ON C.IdIntentoPregunta=IP.Id
        )
        UPDATE IP SET
          PuntajeAutomaticoOpciones=C.PuntajeAutomatico,
          PuntajeObtenido=CASE WHEN IP.TratamientoJustificacionSnapshot=''revision_manual''
            AND C.TotalElegidas>0 THEN NULL ELSE C.PuntajeAutomatico END,
          OrigenCorreccion=CASE WHEN IP.TratamientoJustificacionSnapshot=''revision_manual''
            AND C.TotalElegidas>0 THEN NULL ELSE ''automatica'' END,
          FechaCorreccion=CASE WHEN IP.TratamientoJustificacionSnapshot=''revision_manual''
            AND C.TotalElegidas>0 THEN NULL ELSE SYSUTCDATETIME() END,
          CorregidoPor=NULL
        FROM dbo.IntentoPregunta IP JOIN Calculos C ON C.Id=IP.Id
        WHERE IP.IdIntento=@IdIntento AND IP.PuntajeObtenido IS NULL;

        UPDATE R SET EsCorrecta=CASE
          WHEN IP.PuntajeObtenido=IP.PuntajeMaximoSnapshot THEN 1
          WHEN IP.PuntajeObtenido=0 THEN 0 ELSE NULL END
        FROM dbo.Respuesta R
        JOIN dbo.IntentoPregunta IP ON IP.IdIntento=R.IdIntento AND IP.IdPregunta=R.IdPregunta
        WHERE R.IdIntento=@IdIntento AND IP.TipoSnapshot IN (''mc'',''multiple'',''vf'');
      END;

      DECLARE @CantidadAutomatica INT,@NotaAutomatica DECIMAL(5,2),@Pendientes INT,
        @NotaCalculada DECIMAL(5,2);
      SELECT @CantidadAutomatica=SUM(CASE WHEN OrigenCorreccion=''automatica'' THEN 1 ELSE 0 END),
        @NotaAutomatica=SUM(CASE WHEN OrigenCorreccion=''automatica'' THEN PuntajeObtenido ELSE 0 END),
        @Pendientes=SUM(CASE WHEN PuntajeObtenido IS NULL THEN 1 ELSE 0 END),
        @NotaCalculada=SUM(PuntajeObtenido)
      FROM dbo.IntentoPregunta WHERE IdIntento=@IdIntento;
      IF ISNULL(@CantidadAutomatica,0)=0 SET @NotaAutomatica=NULL;
      IF ISNULL(@Pendientes,0)>0 SET @NotaCalculada=NULL;

      UPDATE dbo.Intento SET Estado=''entregado'',FechaFin=SYSUTCDATETIME(),
        NotaAutomatica=@NotaAutomatica,NotaFinalCalculada=@NotaCalculada,
        NotaFinal=COALESCE(NotaFinalManual,@NotaCalculada)
      WHERE Id=@IdIntento;

      COMMIT TRANSACTION;
      SELECT Id,IdAlumno,IdPublicacion,Estado,NotaFinal,NotaAutomatica,
        NotaFinalCalculada,NotaFinalManual,FechaInicio,FechaFin
      FROM dbo.Intento WHERE Id=@IdIntento;
    END TRY
    BEGIN CATCH
      IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
      THROW;
    END CATCH;
  END;');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
