/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Bu paketler Node.js yerel modülleri / dinamik require kullanır; Next'in
    // sunucu paketleyicisi bunları bundle etmeye çalışırsa çalışma anında
    // patlar. puppeteer PDF üretimi, docx DOCX üretimi, nodemailer SMTP için.
    serverComponentsExternalPackages: ["pdf-parse", "mammoth", "puppeteer", "docx", "nodemailer"]
  }
};

export default nextConfig;
