import jwt from 'jsonwebtoken';
export function signAccessToken(payload) {
    const secret = process.env.JWT_SECRET;
    if (!secret)
        throw new Error('JWT_SECRET missing');
    return jwt.sign(payload, secret, { expiresIn: '7d' });
}
export function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer '))
        return res.status(401).json({ error: 'unauthorized' });
    const token = auth.slice('Bearer '.length);
    const secret = process.env.JWT_SECRET;
    if (!secret)
        return res.status(500).json({ error: 'server_misconfigured' });
    try {
        const decoded = jwt.verify(token, secret);
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ error: 'unauthorized' });
    }
}
