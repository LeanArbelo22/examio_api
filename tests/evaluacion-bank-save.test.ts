const consultar = jest.fn();
const propietario = jest.fn().mockResolvedValue(7);
const detalleBanco = jest.fn();
const guardarPregunta = jest.fn();
const guardarGrupo = jest.fn();

jest.mock('../src/services/banco-common.service', () => ({
  BancoError: class BancoError extends Error {
    constructor(public status: number, message: string, public code?: string) { super(message); }
  },
  consultar,
  propietario,
}));
jest.mock('../src/services/banco.service', () => ({ detalleBanco, guardarPregunta, guardarGrupo }));

const { guardarActividadCompletaEnBanco } = require('../src/services/evaluacion-bank-save.service');
const actor = { id: 1, role: 'docente', idDocente: 7 };
const db = { request: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  propietario.mockResolvedValue(7);
});

it('reutiliza referencias solo cuando contenido, estado y composición coinciden', async () => {
  consultar
    .mockResolvedValueOnce({ recordset: [{ Id: 1, TituloReferencia: 'Redes', IdBancoGrupoOrigen: 20 }] })
    .mockResolvedValueOnce({ recordset: [{ Id: 2, Enunciado: 'TCP', Tipo: 'mc', IdBancoPreguntaOrigen: 10 }] })
    .mockResolvedValueOnce({ recordset: [{ Texto: 'Sí', EsCorrecta: true }, { Texto: 'No', EsCorrecta: false }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [] });
  detalleBanco
    .mockResolvedValueOnce({ Id: 10, Titulo: 'Redes', Enunciado: 'TCP', Tipo: 'mc', Estado: 'disponible', Revision: 4,
      Opciones: [{ Texto: 'Sí', EsCorrecta: true }, { Texto: 'No', EsCorrecta: false }] })
    .mockResolvedValueOnce({ Id: 20, TituloReferencia: 'Redes', Estado: 'disponible', Revision: 3,
      Preguntas: [{ Id: 10 }] });

  const result = await guardarActividadCompletaEnBanco(db, actor, 5);
  expect(guardarPregunta).not.toHaveBeenCalled(); expect(guardarGrupo).not.toHaveBeenCalled();
  expect(result[0]).toMatchObject({ IdBancoGrupo: 20, Preguntas: [{ IdBancoPregunta: 10, RevisionBanco: 4 }] });
  expect(consultar).toHaveBeenCalledWith(db, expect.stringContaining('UPDATE dbo.Pregunta'),
    expect.objectContaining({ Banco: 10, Revision: 4 }));
});

it('crea copias nuevas si el contenido referenciado difiere y no modifica el original', async () => {
  consultar
    .mockResolvedValueOnce({ recordset: [{ Id: 1, TituloReferencia: 'Redes', IdBancoGrupoOrigen: 20 }] })
    .mockResolvedValueOnce({ recordset: [{ Id: 2, Enunciado: 'Contenido nuevo', Tipo: 'abierta', IdBancoPreguntaOrigen: 10 }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [] });
  detalleBanco
    .mockResolvedValueOnce({ Id: 10, Titulo: 'Redes', Enunciado: 'Contenido anterior', Tipo: 'abierta', Estado: 'disponible', Revision: 1, Opciones: [] })
    .mockResolvedValueOnce({ Id: 20, TituloReferencia: 'Redes', Estado: 'disponible', Revision: 1, Preguntas: [{ Id: 10 }] });
  guardarPregunta.mockResolvedValue({ Id: 11, Revision: 1, Estado: 'disponible' });
  guardarGrupo.mockResolvedValue({ Id: 21, Revision: 1, Estado: 'disponible' });

  const result = await guardarActividadCompletaEnBanco(db, actor, 5);
  expect(guardarPregunta).toHaveBeenCalledWith(db, 7, expect.objectContaining({ Enunciado: 'Contenido nuevo', Estado: 'disponible' }));
  expect(guardarGrupo).toHaveBeenCalledWith(db, 7, expect.objectContaining({ Preguntas: [11], Estado: 'disponible' }));
  expect(result[0]).toMatchObject({ IdBancoGrupo: 21, Preguntas: [{ IdBancoPregunta: 11 }] });
});

it('guarda code y su grupo como borradores', async () => {
  consultar
    .mockResolvedValueOnce({ recordset: [{ Id: 1, TituloReferencia: 'Código', IdBancoGrupoOrigen: null }] })
    .mockResolvedValueOnce({ recordset: [{ Id: 2, Enunciado: 'Resolver', Tipo: 'code', IdBancoPreguntaOrigen: null }] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [] })
    .mockResolvedValueOnce({ recordset: [] });
  guardarPregunta.mockResolvedValue({ Id: 12, Revision: 1, Estado: 'borrador' });
  guardarGrupo.mockResolvedValue({ Id: 22, Revision: 1, Estado: 'borrador' });

  await guardarActividadCompletaEnBanco(db, actor, 5);
  expect(guardarPregunta).toHaveBeenCalledWith(db, 7, expect.objectContaining({ Tipo: 'code', Estado: 'borrador' }));
  expect(guardarGrupo).toHaveBeenCalledWith(db, 7, expect.objectContaining({ Estado: 'borrador' }));
});
