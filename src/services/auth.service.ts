import { pool } from '../config/db';
import * as sql from 'mssql';

export const findUserByEmail = async (email: string) => {
  const query = `
    SELECT U.Id, U.Email, U.Rol, U.PasswordHash, U.IdAlumno, U.IdDocente,
           CASE 
               WHEN U.Rol = 'docente' THEN U.IdDocente 
               WHEN U.Rol = 'alumno' THEN U.IdAlumno 
           END AS IdentificadorInstitucional,
           ISNULL(D.Nombre + ' ' + D.Apellido, A.Nombre + ' ' + A.Apellido) AS NombreCompleto
    FROM Usuario U
    LEFT JOIN Docente D ON U.IdDocente = D.Legajo
    LEFT JOIN Alumno A ON U.IdAlumno = A.Matricula
    WHERE U.Email = @Email AND U.Activo = 1;
  `;

  const result = await pool.request()
    .input('Email', sql.NVarChar, email)
    .query(query);

  return result.recordset[0];
};
