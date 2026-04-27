const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const axios = require('axios');

const fs = require('fs');
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}
const app = express();

// --- CONFIGURATION ---
app.use(cors());
app.use(express.json()); // Remplace bodyParser.json() pour les versions récentes
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// --- CONNEXION BASE DE DONNÉES ---
// Vérifie bien que ton port WAMP est 3308
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'contracts_ai', 
    port: 3308 
});

db.connect((err) => {
    if (err) {
        console.error('❌ Erreur de connexion MySQL (Port 3308) :', err.message);
        return;
    }
    console.log('✅ MySQL Connecté avec succès sur le port 3308');
});

// --- CONFIGURATION MULTER (Stockage fichiers) ---
const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        cb(null, 'contrat_' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- ROUTES API ---

// 1. LOGIN
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    console.log(`📩 [LOGIN] Tentative pour : ${email}`);

    const query = "SELECT * FROM users WHERE email = ? AND password = ?";
    db.query(query, [email, password], (err, results) => {
        if (err) {
            console.error("❌ Erreur SQL Login :", err);
            return res.status(500).json({ success: false, message: "Erreur serveur" });
        }
        if (results.length > 0) {
            console.log("✅ Login réussi");
            res.json({ success: true, message: "Bienvenue !", user: results[0] });
        } else {
            console.log("⚠️ Échec : Identifiants incorrects");
            res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
        }
    });
});

// 2. REGISTER (S'inscrire)
app.post('/api/register', (req, res) => {
    const { email, password } = req.body;
    console.log(`📩 [REGISTER] Nouvel utilisateur : ${email}`);

    const sql = "INSERT INTO users (email, password) VALUES (?, ?)";
    db.query(sql, [email, password], (err, result) => {
        if (err) {
            console.error("❌ Erreur SQL Register :", err);
            return res.status(500).json({ success: false, message: "Erreur lors de l'inscription" });
        }
        console.log("✅ Utilisateur créé avec succès");
        res.status(201).json({ success: true, message: "Utilisateur créé !" });
    });
});

// 3. UPLOAD & ANALYSE IA (Lien avec Python)
app.post('/api/upload-contract', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send('Aucun fichier reçu');
    
    console.log(`📄 [UPLOAD] Fichier reçu : ${req.file.originalname}`);
    
    // On récupère le chemin ABSOLU du fichier pour que Python puisse l'ouvrir
    const filePath = path.join(__dirname, 'uploads', req.file.filename);

    try {
        // IMPORTANT : On envoie le chemin complet à FastAPI
        const response = await axios.post('http://127.0.0.1:8000/analyze', { 
            file_path: filePath 
        });

        console.log("✅ Analyse IA terminée avec succès");
        
        res.json({
            ...response.data,
            nom_fichier: req.file.originalname,
            chemin: req.file.filename // On renvoie juste le nom pour la BD
        });
    } catch (error) {
        console.error("❌ L'IA (Python) ne répond pas :", error.message);
        res.status(500).json({ error: "Le moteur d'analyse IA est hors ligne" });
    }
});

// 4. SAUVEGARDE DU CONTRAT AUDITÉ
app.post('/api/save-contract', (req, res) => {
    const { date_debut, date_fin, montant, objet, direction, nom_fichier, chemin } = req.body;
    const montantFloat = parseFloat(montant) || 0.0;

    console.log(`💾 [SAVE] Enregistrement du contrat : ${objet}`);

    const sql = `
        INSERT INTO contracts 
        (date_debut, date_fin, montant, objet, direction, nom_fichier, chemin, status, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, 'En attente', NOW())
    `;

    db.query(sql, [date_debut, date_fin, montantFloat, objet, direction, nom_fichier, chemin], (err, result) => {
        if (err) {
            console.error("❌ Erreur SQL Save :", err);
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ success: true, message: "Contrat sauvegardé" });
    });
});

// 5. LISTE DES CONTRATS / DASHBOARD
app.get('/api/contracts', (req, res) => {
    console.log("📊 [GET] Récupération de la liste des contrats");
    const sql = `
        SELECT id, objet, montant, date_fin, direction, nom_fichier,
        DATEDIFF(date_fin, NOW()) as jours_restants 
        FROM contracts 
        ORDER BY id DESC LIMIT 10
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(results);
    });
});

// --- LANCEMENT DU SERVEUR ---
const PORT = 5000;
// '0.0.0.0' permet au téléphone d'accéder au serveur via l'IP du PC
app.listen(PORT, '0.0.0.0', () => {
    console.log('-------------------------------------------');
    console.log(`🚀 SERVEUR DAS ERP : http://192.168.1.21:${PORT}`);
    console.log(`📡 En attente de connexions du mobile...`);
    console.log('-------------------------------------------');
});