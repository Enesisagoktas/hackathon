import mysql from 'mysql2/promise';

async function test() {
  try {
    const pool = mysql.createPool({
      host: "localhost",
      port: 3306,
      user: "root",
      password: "E1n2e3s4.",
      database: "cvmatch",
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
  } catch(e) {
    console.error("DB Error:", e);
    process.exit(1);
  }
}

test();
