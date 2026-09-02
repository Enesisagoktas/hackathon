import mysql from "mysql2/promise";
import dotenv from "dotenv";

// Kimlik bilgileri .env'den okunur; bu dosya PUBLIC repoda durduğu için
// içine şifre YAZILMAZ. .env gitignore'dadır.
dotenv.config();

async function test() {
  const password = process.env.MYSQL_PASSWORD;

  if (!password) {
    console.error(
      "MYSQL_PASSWORD .env dosyasında tanımlı değil. Bu script veritabanı bağlantısını doğrular ve kimlik bilgilerini ortamdan okur."
    );
    process.exit(1);
  }

  try {
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST ?? "localhost",
      port: Number(process.env.MYSQL_PORT ?? 3306),
      user: process.env.MYSQL_USER ?? "root",
      password,
      database: process.env.MYSQL_DATABASE ?? "cvmatch",
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      namedPlaceholders: true
    });

    const [rows] = await pool.query("SHOW TABLES LIKE 'users'");
    console.log("Tables:", rows);

    // Check users table structure
    if (rows.length > 0) {
      const [columns] = await pool.query("DESCRIBE users");
      console.log("Users Table Columns:", columns);
    } else {
      console.log("users table DOES NOT EXIST");
    }

    process.exit(0);
  } catch (e) {
    console.error("DB Error:", e);
    process.exit(1);
  }
}

test();
