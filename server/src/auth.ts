import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

export type JwtUser = { userId: string };

export function signAccessToken(payload: JwtUser): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET missing');
  return jwt.sign(payload, secret, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });

  const token = auth.slice('Bearer '.length);
  const secret = process.env.JWT_SECRET;
  if (!secret) return res.status(500).json({ error: 'server_misconfigured' });

  try {
    const decoded = jwt.verify(token, secret) as JwtUser;
    (req as any).user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'unauthorized' });
  }
}
