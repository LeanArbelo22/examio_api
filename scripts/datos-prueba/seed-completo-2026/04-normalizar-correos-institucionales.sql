/*
  Normaliza exclusivamente los correos del seed integral al dominio institucional.
  No modifica contraseñas, usuarios relacionados, roles ni datos académicos.
  Entregado sin ejecutar.
*/
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @BaseObjetivo SYSNAME=N'GestionExamio-Migracion';
DECLARE @CONFIRMAR_CAMBIO BIT=0; -- Cambiar a 1 para la ejecución manual.
DECLARE @DominioAnterior VARCHAR(100)='seed.examio.test';
DECLARE @DominioNuevo VARCHAR(100)='cervantes.edu.ar';

IF DB_NAME()<>@BaseObjetivo
  THROW 55200,'Base incorrecta: seleccione GestionExamio-Migracion.',1;
IF @CONFIRMAR_CAMBIO<>1
  THROW 55201,'Preflight correcto. Cambie @CONFIRMAR_CAMBIO a 1 para actualizar los correos.',1;
IF OBJECT_ID(N'dbo.Usuario',N'U') IS NULL OR OBJECT_ID(N'dbo.Docente',N'U') IS NULL
   OR OBJECT_ID(N'dbo.Alumno',N'U') IS NULL
  THROW 55202,'Faltan tablas de usuarios, docentes o alumnos.',1;

DECLARE @SufijoAnterior VARCHAR(101)=CONCAT('@',@DominioAnterior);
DECLARE @SufijoNuevo VARCHAR(101)=CONCAT('@',@DominioNuevo);

/* Construye primero todos los valores destino y rechaza cualquier colisión. */
DECLARE @CambiosUsuario TABLE(Id INT PRIMARY KEY,EmailAnterior VARCHAR(320),EmailNuevo VARCHAR(320));
INSERT @CambiosUsuario(Id,EmailAnterior,EmailNuevo)
SELECT Id,Email,CONCAT(LEFT(Email,LEN(Email)-LEN(@SufijoAnterior)),@SufijoNuevo)
FROM dbo.Usuario
WHERE RIGHT(Email,LEN(@SufijoAnterior))=@SufijoAnterior;

DECLARE @CambiosDocente TABLE(Legajo INT PRIMARY KEY,CorreoAnterior VARCHAR(320),CorreoNuevo VARCHAR(320));
INSERT @CambiosDocente(Legajo,CorreoAnterior,CorreoNuevo)
SELECT Legajo,Correo,CONCAT(LEFT(Correo,LEN(Correo)-LEN(@SufijoAnterior)),@SufijoNuevo)
FROM dbo.Docente
WHERE RIGHT(Correo,LEN(@SufijoAnterior))=@SufijoAnterior;

DECLARE @CambiosAlumno TABLE(Matricula INT PRIMARY KEY,CorreoAnterior VARCHAR(320),CorreoNuevo VARCHAR(320));
INSERT @CambiosAlumno(Matricula,CorreoAnterior,CorreoNuevo)
SELECT Matricula,Correo,CONCAT(LEFT(Correo,LEN(Correo)-LEN(@SufijoAnterior)),@SufijoNuevo)
FROM dbo.Alumno
WHERE RIGHT(Correo,LEN(@SufijoAnterior))=@SufijoAnterior;

IF NOT EXISTS(SELECT 1 FROM @CambiosUsuario)
BEGIN
  IF EXISTS(SELECT 1 FROM dbo.Usuario WHERE RIGHT(Email,LEN(@SufijoNuevo))=@SufijoNuevo)
  BEGIN
    SELECT 'CORREOS_YA_NORMALIZADOS' Estado,
      (SELECT COUNT(*) FROM dbo.Usuario WHERE RIGHT(Email,LEN(@SufijoNuevo))=@SufijoNuevo) Usuarios,
      (SELECT COUNT(*) FROM dbo.Docente WHERE RIGHT(Correo,LEN(@SufijoNuevo))=@SufijoNuevo) Docentes,
      (SELECT COUNT(*) FROM dbo.Alumno WHERE RIGHT(Correo,LEN(@SufijoNuevo))=@SufijoNuevo) Alumnos;
    RETURN;
  END;
  THROW 55203,'No se encontraron correos del seed con el dominio anterior.',1;
END;

IF EXISTS(SELECT EmailNuevo FROM @CambiosUsuario GROUP BY EmailNuevo HAVING COUNT(*)>1)
  THROW 55204,'La transformación generaría usuarios con emails duplicados.',1;
IF EXISTS(SELECT CorreoNuevo FROM @CambiosDocente GROUP BY CorreoNuevo HAVING COUNT(*)>1)
  THROW 55205,'La transformación generaría docentes con correos duplicados.',1;
IF EXISTS(SELECT CorreoNuevo FROM @CambiosAlumno GROUP BY CorreoNuevo HAVING COUNT(*)>1)
  THROW 55206,'La transformación generaría alumnos con correos duplicados.',1;

IF EXISTS(SELECT 1 FROM @CambiosUsuario C JOIN dbo.Usuario U ON U.Email=C.EmailNuevo AND U.Id<>C.Id)
  THROW 55207,'Un email institucional destino ya pertenece a otro usuario.',1;
IF EXISTS(SELECT 1 FROM @CambiosDocente C JOIN dbo.Docente D ON D.Correo=C.CorreoNuevo AND D.Legajo<>C.Legajo)
  THROW 55208,'Un correo institucional destino ya pertenece a otro docente.',1;
IF EXISTS(SELECT 1 FROM @CambiosAlumno C JOIN dbo.Alumno A ON A.Correo=C.CorreoNuevo AND A.Matricula<>C.Matricula)
  THROW 55209,'Un correo institucional destino ya pertenece a otro alumno.',1;

BEGIN TRY
  BEGIN TRANSACTION;

  UPDATE U SET Email=C.EmailNuevo
  FROM dbo.Usuario U JOIN @CambiosUsuario C ON C.Id=U.Id;

  UPDATE D SET Correo=C.CorreoNuevo
  FROM dbo.Docente D JOIN @CambiosDocente C ON C.Legajo=D.Legajo;

  UPDATE A SET Correo=C.CorreoNuevo
  FROM dbo.Alumno A JOIN @CambiosAlumno C ON C.Matricula=A.Matricula;

  IF EXISTS(SELECT 1 FROM dbo.Usuario WHERE RIGHT(Email,LEN(@SufijoAnterior))=@SufijoAnterior)
     OR EXISTS(SELECT 1 FROM dbo.Docente WHERE RIGHT(Correo,LEN(@SufijoAnterior))=@SufijoAnterior)
     OR EXISTS(SELECT 1 FROM dbo.Alumno WHERE RIGHT(Correo,LEN(@SufijoAnterior))=@SufijoAnterior)
    THROW 55210,'Quedaron correos del seed con el dominio anterior.',1;

  COMMIT;

  SELECT 'CORREOS_NORMALIZADOS' Estado,
    (SELECT COUNT(*) FROM @CambiosUsuario) UsuariosActualizados,
    (SELECT COUNT(*) FROM @CambiosDocente) DocentesActualizados,
    (SELECT COUNT(*) FROM @CambiosAlumno) AlumnosActualizados,
    @DominioNuevo DominioNuevo;
END TRY
BEGIN CATCH
  IF @@TRANCOUNT>0 ROLLBACK;
  THROW;
END CATCH;

/* Resultado de lectura esperado: admin + 40 docentes + 240 alumnos. */
SELECT Rol,COUNT(*) Cantidad
FROM dbo.Usuario
WHERE RIGHT(Email,LEN(@SufijoNuevo))=@SufijoNuevo
GROUP BY Rol
ORDER BY Rol;
