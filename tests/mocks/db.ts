type Recordset = Record<string, unknown>[];

export const createMockPool = () => {
  const mockExecute = jest.fn().mockResolvedValue({ recordset: [] });
  const mockQuery = jest.fn().mockResolvedValue({ recordset: [] });
  const mockInput = jest.fn().mockReturnThis();

  const request = {
    input: mockInput,
    execute: mockExecute,
    query: mockQuery,
  };

  const transactionRequest = {
    input: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ recordset: [] }),
    query: jest.fn().mockResolvedValue({ recordset: [] }),
  };

  const pool = {
    query: mockQuery,
    request: jest.fn().mockReturnValue(request),
    Transaction: jest.fn().mockImplementation(() => ({
      begin: jest.fn().mockResolvedValue(undefined),
      request: jest.fn().mockReturnValue(transactionRequest),
      commit: jest.fn().mockResolvedValue(undefined),
      rollback: jest.fn().mockResolvedValue(undefined),
    })),
    Int: 'INT' as unknown as number,
    NVarChar: 'NVARCHAR' as unknown,
    UniqueIdentifier: 'UNIQUEIDENTIFIER' as unknown,
    VarBinary: jest.fn().mockReturnValue('VARBINARY' as unknown),
    DateTime2: 'DATETIME2' as unknown,
    ISOLATION_LEVEL: {
      SERIALIZABLE: 'SERIALIZABLE',
    },
    Bit: 'BIT' as unknown,
    DateTime: 'DATETIME' as unknown,
    Decimal: jest.fn().mockReturnValue('DECIMAL' as unknown),
  };

  return { pool, connectDB: jest.fn().mockResolvedValue(undefined) };
};
