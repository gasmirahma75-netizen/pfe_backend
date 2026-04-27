const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
    const authHeader = req.header('Authorization');
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "Accès refusé" });

    try {
        // Utilise la même clé que dans ton .env
        const verified = jwt.verify(token, process.env.JWT_SECRET || 'SECRET_POSTE_2026');
        req.user = verified;
        next();
    } catch (err) {
        res.status(403).json({ message: "Token invalide" });
    }
};