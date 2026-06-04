console.log("SERVER CORRIENDO DESDE:", __dirname);

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const https = require("https");
const COLORS = {
  white_solid: { es: "Blanco sólido", en: "Solid white" },
  white_pearl: { es: "Blanco perlado", en: "Pearl white" },
  black: { es: "Negro", en: "Black" },
  gray: { es: "Gris", en: "Gray" },
  nardo_gray: { es: "Gris cemento", en: "Nardo gray" },
  silver: { es: "Plateado", en: "Silver" },
  blue: { es: "Azul", en: "Blue" },
  red: { es: "Rojo", en: "Red" },
  beige: { es: "Arena", en: "Beige" },
  brown: { es: "Marrón", en: "Brown" },
  green_olive: { es: "Verde oliva", en: "Olive green" },
  green_forest: { es: "Verde bosque", en: "Forest green" },
  orange: { es: "Naranja", en: "Orange" },
  yellow: { es: "Amarillo", en: "Yellow" },
  gold: { es: "Champagne", en: "Gold" },
  graphite_gray: { es: "Gris grafito", en: "Graphite gray" },
  navy_blue: { es: "Azul marino", en: "Navy blue" },
  bronze: { es: "Bronce", en: "Bronze" },
  burgundy: { es: "Granate", en: "Burgundy" },
  copper: { es: "Cobre", en: "Copper" },
  cream: { es: "Crema", en: "Cream" },
  turquoise: { es: "Turquesa", en: "Turquoise" },
  purple: { es: "Violeta", en: "Purple" }
};



const app = express();
app.use(express.json());


// 📁 Uploads
const UPLOADS = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS);
app.use("/uploads", express.static(UPLOADS));

// 🖼️ Multer
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOADS),
  filename: (_, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => cb(null, true),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});


// 🗄️ DB
const dbPath = path.join(__dirname, "cars.db");
console.log("DB PATH:", dbPath);
const db = new sqlite3.Database(dbPath);

// 🧱 Tablas
db.serialize(() => {
  db.run(`
  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand TEXT,
    model TEXT,
    year INTEGER,
    mileage INTEGER,
    color_ext TEXT,
    color_int TEXT,
    price INTEGER,
    vin TEXT,
    description TEXT,
    img TEXT,
    featured INTEGER DEFAULT 0,
    transmission TEXT,
    fuel TEXT
  )
`);


  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT UNIQUE,
      pass TEXT
    )
  `);

  db.get("SELECT * FROM admins WHERE user = 'solutionauto'", async (err, row) => {
  if (err) return console.error("Error leyendo admins:", err);
  if (!row) {
    const hash = await bcrypt.hash("repairs", 10);
    db.run("INSERT INTO admins (user, pass) VALUES (?,?)", ["solutionauto", hash]);
    console.log("Admin creado: solutionauto / repairs");
  }
});

});

// 🔐 Auth middleware
const SECRET = "super_secret_key_123"; // el mismo del login

function auth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if(!token) return res.status(401).json({ error: "No token" });

  jwt.verify(token, SECRET, (err, user) => {
    if(err) return res.status(403).json({ error: "Token inválido" });
    req.user = user;
    next();
  });
}




// 🔐 Login
app.post("/login", (req, res) => {
  const { user, pass } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: "Faltan credenciales" });

  db.get("SELECT * FROM admins WHERE user = ?", [user], async (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(401).json({ error: "Credenciales inválidas" });

    const ok = await bcrypt.compare(pass, row.pass);
    if (!ok) return res.status(401).json({ error: "Credenciales inválidas" });

    const token = jwt.sign({ user: row.user }, SECRET, { expiresIn: "12h" });
    res.json({ token });
    

});
});
// 🔄 Editar auto
// 🔄 Editar auto
// ✏️ Editar auto
app.put("/cars/:id", auth, upload.single("img"), (req, res) => {
  const id = req.params.id;
  const {
    brand, model, year, mileage,
    price, transmission, fuel, vin,
    color_ext, color_int, description
  } = req.body;

  // Si subieron imagen nueva
  let imgPath = req.file ? `/uploads/${req.file.filename}` : null;

  // Primero obtenemos la imagen vieja para borrarla si hay nueva
  db.get("SELECT img FROM cars WHERE id = ?", [id], (err, row) => {
    if(err) return res.status(500).json({ error: err.message });
    if(!row) return res.status(404).json({ error: "Auto no encontrado" });

    const oldImg = row.img;

    const sql = `
      UPDATE cars SET
        brand=?, model=?, year=?, mileage=?, price=?, transmission=?, fuel=?,
        vin=?, color_ext=?, color_int=?, description=? ${imgPath ? ", img=?" : ""}
      WHERE id=?
    `;

    const params = [
      brand, model, year, mileage, price || 0, transmission, fuel,
      vin || "", color_ext, color_int, description || ""
    ];

    if(imgPath) params.push(imgPath);
    params.push(id);

    db.run(sql, params, function(err) {
      if(err) return res.status(500).json({ error: err.message });

      // Borrar imagen vieja si hay nueva
      if(imgPath && oldImg) {
        const oldFile = path.join(__dirname, oldImg);
        if(fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      }

      res.json({ ok: true });
    });
  });
});





// 🔎 VIN Decoder (robusto)
app.get("/cars", (req, res) => {
  db.all("SELECT * FROM cars ORDER BY id DESC", [], (err, rows) => {
  if (err) return res.status(500).json({ error: err.message });

  const mapped = rows.map(c => ({
    ...c,
    color_ext_label: COLORS[c.color_ext]?.es || "N/A",
    color_ext_label_en: COLORS[c.color_ext]?.en || "N/A",
    color_int_label: COLORS[c.color_int]?.es || "N/A",
    color_int_label_en: COLORS[c.color_int]?.en || "N/A"
  }));

  res.json(mapped);
});

});



// ➕ Admin
app.post("/cars", auth, upload.single("img"), (req, res) => {

  const {
    brand, model, year, mileage,
    price, transmission, fuel, vin,
    color_ext, color_int, description
  } = req.body;
  console.log("BODY:", req.body);   // 👈 DEBUG
  console.log("FILE:", req.file); 
  const img = req.file ? `/uploads/${req.file.filename}` : null;

  db.run(`
    INSERT INTO cars (
      brand, model, year, mileage, price,
      transmission, fuel, vin, img,
      color_ext, color_int, description
    )
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `, [
    brand, model, year, mileage, price,
    transmission, fuel, vin, img,
    color_ext, color_int, description
  ], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});


// ❌ Admin
app.delete("/cars/:id", auth, (req, res) => {
  const id = req.params.id;

  db.run("DELETE FROM cars WHERE id = ?", [id], function(err){
    if(err) {
      console.error(err);
      return res.status(500).json({ error: "Error al borrar en DB" });
    }

    if(this.changes === 0) {
      return res.status(404).json({ error: "Auto no encontrado" });
    }

    res.json({ ok: true });
  });
});

app.use(cors({
  origin: [
    "http://localhost:5500",
    "http://localhost:5173",
    "https://mellow-yeot-eda1ac.netlify.app",
    "https://solutionautosales.net",
    "https://solutionautosales.wixsite.com",
    "https://mellow-yeot-eda1ac.netlify.app/"
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.options("*", cors()); // 🔥 ESTO ARREGLA EL POST CON IMAGEN




// 🏠 Home
app.get("/", (_, res) => res.send("API Solution Auto Sales funcionando 🚗"));

app.listen(3001, () => console.log("API en http://localhost:3001"));
