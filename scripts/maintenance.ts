import "../lib/load-env";

import { spawn } from "child_process";

/**
 * Feature #9 — Gecelik bakım turu.
 *
 * Mevcut bakım adımlarını TEK komutta, sırayla ve İZOLE çalıştırır:
 *
 *   1. discover  — kaynak keşfi (yeni ATS board'ları, candidate doğrulama)
 *   2. crawl     — ilan cache tazeleme (platform taraması)
 *   3. verify    — cache'teki ilanlar hâlâ yayında mı? (expired işaretleme)
 *   4. cleanup   — sahte/engel sayfası kalıntılarını kapatma (--apply)
 *   5. quality   — kalite raporu (gecenin özeti)
 *
 * Her adım ayrı bir alt süreçte koşar: tek bir kaynağın/adımın çökmesi turu
 * ASLA düşürmez — adım "başarısız" yazılır ve sıradaki adım başlar. Bu,
 * scriptleri yeniden yazmadan elde edilen en güçlü izolasyondur (her script
 * kendi havuzunu açıp kapatır, süreç ölse bile kilit bırakmaz).
 *
 * `seed:jobs` bilerek DAHİL DEĞİL: örnek/demo verisini her gece canlı cache'e
 * yeniden basmak kirlilik yaratır; kaynak büyümesini discover adımı sağlar.
 *
 * Kullanım:
 *   npm run maintenance                  (tam tur)
 *   npm run maintenance -- crawl verify  (yalnızca seçili adımlar)
 *
 * Windows Görev Zamanlayıcı örneği (her gece 03:30):
 *   Program:   cmd.exe
 *   Argümanlar: /c "cd /d C:\App\hackathon && npm run maintenance >> logs\maintenance.log 2>&1"
 */

type Step = {
  key: string;
  title: string;
  command: string;
  /** Adım bu süreyi aşarsa öldürülür ve başarısız sayılır (ms). */
  timeoutMs: number;
};

const STEPS: Step[] = [
  { key: "discover", title: "Kaynak keşfi", command: "npx tsx scripts/discover-sources.ts", timeoutMs: minutes(6) },
  { key: "crawl", title: "İlan taraması", command: "npx tsx scripts/crawl-jobs.ts", timeoutMs: minutes(20) },
  { key: "verify", title: "İlan doğrulama", command: "npx tsx scripts/verify-jobs.ts", timeoutMs: minutes(12) },
  { key: "cleanup", title: "Cache temizliği", command: "npx tsx scripts/cleanup-listings.ts --apply", timeoutMs: minutes(6) },
  { key: "quality", title: "Kalite raporu", command: "npx tsx scripts/quality-report.ts", timeoutMs: minutes(6) },
  // Feature #10 — tarama sonrası yeni eşleşme özetleri. Varsayılan olarak
  // kimse abone değildir (opt-in) ve SMTP_DRY_RUN=true iken e-posta ağa çıkmaz.
  { key: "notify", title: "Eşleşme özetleri", command: "npx tsx scripts/notify-matches.ts", timeoutMs: minutes(6) }
];

function minutes(value: number): number {
  return value * 60 * 1000;
}

type StepOutcome = {
  key: string;
  title: string;
  ok: boolean;
  seconds: number;
  detail: string;
};

function runStep(step: Step): Promise<StepOutcome> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const finish = (ok: boolean, detail: string) =>
      resolve({ key: step.key, title: step.title, ok, seconds: Math.round((Date.now() - startedAt) / 1000), detail });

    // shell:true — Windows'ta npx bir .cmd dosyasıdır, kabuk olmadan açılmaz.
    const child = spawn(step.command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });

    let lastLines: string[] = [];
    const capture = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      lastLines = lastLines.concat(text.split(/\r?\n/).filter(Boolean)).slice(-3);
    };

    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);

    const timer = setTimeout(() => {
      finish(false, `zaman aşımı (${Math.round(step.timeoutMs / 60000)} dk) — adım öldürüldü`);
      child.kill();
    }, step.timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      finish(false, `başlatılamadı: ${error.message}`);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0, code === 0 ? (lastLines[lastLines.length - 1] ?? "tamam") : `çıkış kodu ${code}`);
    });
  });
}

async function main() {
  const requested = process.argv.slice(2).map((arg) => arg.trim().toLowerCase()).filter(Boolean);
  const steps = requested.length ? STEPS.filter((step) => requested.includes(step.key)) : STEPS;

  if (!steps.length) {
    console.error(`Bilinmeyen adım: ${requested.join(", ")}. Geçerli: ${STEPS.map((step) => step.key).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n═══ Bakım turu başlıyor — ${steps.length} adım (${new Date().toLocaleString("tr-TR")}) ═══\n`);

  const outcomes: StepOutcome[] = [];

  for (const step of steps) {
    console.log(`\n──── [${outcomes.length + 1}/${steps.length}] ${step.title} (${step.key}) ────\n`);
    const outcome = await runStep(step);
    outcomes.push(outcome);

    if (!outcome.ok) {
      console.error(`\n[maintenance] ${step.title} BAŞARISIZ (${outcome.detail}) — sonraki adıma geçiliyor.`);
    }
  }

  console.log("\n═══ Bakım turu özeti ═══\n");
  for (const outcome of outcomes) {
    console.log(
      `  ${outcome.ok ? "✓" : "✗"} ${outcome.title.padEnd(16)} ${String(outcome.seconds).padStart(4)}sn — ${outcome.detail}`
    );
  }

  const failedCount = outcomes.filter((outcome) => !outcome.ok).length;
  console.log(
    `\n${outcomes.length - failedCount}/${outcomes.length} adım tamamlandı${failedCount ? ` (${failedCount} başarısız — yukarıdaki loglara bakın)` : ""}.\n`
  );

  // Kısmi başarısızlık turu düşürmez ama zamanlayıcı loglarında görünür olsun.
  if (failedCount === outcomes.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Bakım turu çöktü:", error);
  process.exitCode = 1;
});
