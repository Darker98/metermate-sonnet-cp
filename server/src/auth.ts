import type { Request, Response, NextFunction } from 'express';
import { config } from './config.js';

export function adminGuard(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MeterMate Admin"');
    res.status(401).json({ status: 'unauthorized', message: 'Admin credentials required' });
    return;
  }

  const base64 = authHeader.slice(6);
  let decoded: string;
  try {
    decoded = Buffer.from(base64, 'base64').toString('utf-8');
  } catch {
    res.status(401).json({ status: 'unauthorized', message: 'Malformed authorization header' });
    return;
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    res.status(401).json({ status: 'unauthorized', message: 'Malformed authorization header' });
    return;
  }

  const user = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  if (user !== config.admin.user || password !== config.admin.password) {
    res.setHeader('WWW-Authenticate', 'Basic realm="MeterMate Admin"');
    res.status(401).json({ status: 'unauthorized', message: 'Invalid admin credentials' });
    return;
  }

  next();
}
