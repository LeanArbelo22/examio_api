import { Request, Response } from 'express';
import { pool } from '../config/db';

const SERVICE_NAME = 'examio-api';
const HEALTH_CHECK_TIMEOUT_MS = 2000;

const getEnvironment = (): string => process.env.NODE_ENV || 'development';

export const getHealth = async (req: Request, res: Response) => {
  try {
    const request = pool.request();
    request.timeout = HEALTH_CHECK_TIMEOUT_MS;
    await request.query('SELECT 1 AS IsReachable');

    return res.json({
      success: true,
      data: {
        service: SERVICE_NAME,
        environment: getEnvironment(),
        database: 'reachable',
      },
    });
  } catch {
    return res.status(503).json({
      success: false,
      data: {
        service: SERVICE_NAME,
        environment: getEnvironment(),
        database: 'unreachable',
      },
      message: 'Service temporarily unavailable',
    });
  }
};
