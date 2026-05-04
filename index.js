const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 5000;

// ==========================================
// 1. CONFIGURATION ET MIDDLEWARES
// ==========================================

const uploadDir = path.join(__dirname, 'uploads');

// Création automatique du dossier s'il n'existe pas
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
    console.log("📁 Dossier 'uploads' créé automatiquement !");
} else {
    console.log("✅ Dossier 'uploads' détecté par le serveur.");
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

// ==========================================
// 2. CONNEXION BASE DE DONNÉES (MySQL 3308)
// ==========================================

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'contracts_ai', 
    port: 3308
});

db.connect((err) => {
    if (err) console.error('❌ Erreur MySQL :', err.message);
    else console.log('✅ MySQL Connecté (Port 3308)');
});

// ==========================================
// 3. CONFIGURATION MULTER (STOCKAGE PDF)
// ==========================================

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `contrat_${Date.now()}.pdf`; 
        cb(null, uniqueName);
    }
});
const upload = multer({ storage: storage });

// ==========================================
// 4. AUTHENTIFICATION (LOGIN / REGISTER)
// ==========================================

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const query = "SELECT * FROM users WHERE email = ?";
    
    db.query(query, [email], async (err, results) => {
        if (err) return res.status(500).json({ success: false, message: "Erreur serveur" });
        
        if (results.length > 0) {
            const user = results[0];
            const match = await bcrypt.compare(password, user.password);
            
            if (match) {
                const token = jwt.sign(
                    { id: user.id, role: user.role }, 
                    'votre_cle_secrete_pfe', 
                    { expiresIn: '24h' }
                );

                console.log("-------------------------------------------");
                console.log(`🎟️ Nouveau Token généré pour : ${email}`);
                console.log(`🔑 Valeur : ${token}`);
                console.log("-------------------------------------------");

                delete user.password; 
                res.json({ success: true, token, user });
            } else {
                res.status(401).json({ success: false, message: "Mot de passe incorrect" });
            }
        } else {
            res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
        }
    });
});

app.post('/api/register', async (req, res) => {
    const { nom_complet, email, password, role } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const sql = "INSERT INTO users (nom_complet, email, password, role) VALUES (?, ?, ?, ?)";
        db.query(sql, [nom_complet, email, hashedPassword, role], (err, result) => {
            if (err) return res.status(500).json({ success: false, message: "Email déjà utilisé" });
            res.status(201).json({ success: true, id: result.insertId });
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "Erreur lors du hachage" });
    }
});

// ==========================================
// 5. CŒUR DU SYSTÈME : AUDIT & IA
// ==========================================

app.post('/api/upload-contract', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });

        await new Promise(resolve => setTimeout(resolve, 500)); 
        const stats = fs.statSync(req.file.path);
        console.log(`⚖️ Taille reçue : ${stats.size} octets`);

        if (stats.size === 0) return res.status(400).json({ error: "Fichier corrompu" });

        const formData = new FormData();
        const fileBuffer = fs.readFileSync(req.file.path); 
        formData.append('file', fileBuffer, { filename: req.file.originalname });

        const responseIA = await axios.post('http://127.0.0.1:8000/api/extract-text', formData, {
            headers: { ...formData.getHeaders() },
        });

        res.json({
            ...responseIA.data,
            nom_fichier: req.file.filename 
        });

    } catch (error) {
        console.error("❌ Erreur de traitement :", error.message);
        res.status(500).json({ error: "Échec de l'analyse du document" });
    }
});

app.post('/api/contracts', (req, res) => {
    let { objet, montant, direction, date_debut, date_fin, status, nom_fichier } = req.body;

    const formatForMySQL = (d) => {
        if (!d || d === "" || d === "null") return null;
        if (d.includes('/')) {
            const [day, month, year] = d.split('/');
            return `${year}-${month}-${day}`;
        }
        return d;
    };

    const sql = "INSERT INTO contracts (objet, montant, direction, date_debut, date_fin, status, nom_fichier) VALUES (?, ?, ?, ?, ?, ?, ?)";
    const values = [objet, montant, direction, formatForMySQL(date_debut), formatForMySQL(date_fin), status || 'Validé', nom_fichier];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("❌ ERREUR SQL :", err.sqlMessage);
            return res.status(500).json({ success: false, error: err.sqlMessage });
        }
        console.log("✅ Contrat enregistré en base ! ID:", result.insertId);
        res.status(200).json({ success: true, id: result.insertId });
    });
});

// ==========================================
// 6. GESTION ADMINISTRATIVE (CRUD COMPLET)
// ==========================================

// --- CONTRATS ---
app.get('/api/contracts', (req, res) => {
    db.query("SELECT * FROM contracts ORDER BY id DESC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/contracts/:id', (req, res) => {
    const id = req.params.id;
    const { objet, montant, direction, date_debut, date_fin, status } = req.body;
    const sql = "UPDATE contracts SET objet = ?, montant = ?, direction = ?, date_debut = ?, date_fin = ?, status = ? WHERE id = ?";
    db.query(sql, [objet, montant, direction, date_debut, date_fin, status, id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: "Contrat mis à jour" });
    });
});

app.delete('/api/contracts/:id', (req, res) => {
    const id = req.params.id;
    db.query("DELETE FROM contracts WHERE id = ?", [id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: "Contrat supprimé" });
    });
});

// --- UTILISATEURS ---
app.get('/api/users', (req, res) => {
    db.query("SELECT id, nom_complet, email, role FROM users", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/users/:id', (req, res) => {
    const id = req.params.id;
    const { nom_complet, email, role } = req.body;
    const sql = "UPDATE users SET nom_complet = ?, email = ?, role = ? WHERE id = ?";
    db.query(sql, [nom_complet, email, role, id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: "Utilisateur mis à jour" });
    });
});

app.delete('/api/users/:id', (req, res) => {
    const id = req.params.id;
    db.query("DELETE FROM users WHERE id = ?", [id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ success: true, message: "Utilisateur supprimé" });
    });
});

// ==========================================
// 7. LANCEMENT DU SERVEUR
// ==========================================

app.listen(PORT, '0.0.0.0', () => {
    console.log('-------------------------------------------');
    console.log(`🚀 SERVEUR ACTIF SUR LE PORT : ${PORT}`);
    console.log('-------------------------------------------');
});