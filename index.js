require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const fetch = require("node-fetch");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 10000;

const app = express();
app.use(bodyParser.json());

// Escape karakter khusus MarkdownV2
function escapeMarkdownV2(text) {
  return text.replace(/([_\*\[\]\(\)~`>#+=\|{}!\.\-\\])/g, '\\$1');
}

// Fungsi kirim pesan ke Telegram
async function sendTelegram(message, chatId = CHAT_ID) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: "MarkdownV2",
    disable_web_page_preview: true,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result = await res.json();
  if (!result.ok) {
    console.error("❌ Gagal kirim ke Telegram:", result);
    throw new Error(result.description || "Gagal kirim pesan");
  }
}

// Cek status domain via API eksternal
async function isDomainBlocked(domain) {
  try {
    const url = `https://check.skiddle.id/?domain=${domain}&json=true`;
    const res = await fetch(url);
    const data = await res.json();

    const domainKey = Object.keys(data).find(k => k.toLowerCase() === domain.toLowerCase());
    if (!domainKey) return false;

    const rawValue = data[domainKey];
    const parsed = typeof rawValue === "string" ? JSON.parse(rawValue) : rawValue;
    return parsed?.blocked === true || parsed?.blocked === "true";
  } catch (e) {
    console.error(`❌ Error cek ${domain}:`, e.message);
    return false;
  }
}

// Endpoint command Telegram
// Endpoint command Telegram
app.post("/", (req, res) => {
  res.sendStatus(200); // respon cepat agar Telegram tidak error 502

  (async () => {
    try {
      const msg = req.body.message || req.body.edited_message;
      const chatId = msg?.chat?.id;
      const text = msg?.text?.trim();

      if (!text || !chatId) return;
      console.log("📥 Command diterima:", text);

      if (text === "/list") {
        const data = fs.readFileSync("list.txt", "utf8")
          .split("\n")
          .map(d => d.trim())
          .filter(Boolean)
          .slice(-15);

        const msgList =
          "🧾 *Daftar 15 Domain Terakhir:*\n" +
          data.map((d, i) => `${i + 1}. \`${escapeMarkdownV2(d)}\``).join("\n");

        await sendTelegram(msgList, chatId);
      }

      else if (text.startsWith("/replace")) {
        const parts = text.split(" ");
        if (parts.length < 3) {
          await sendTelegram("❌ Format salah\\!\nContoh: `/replace domain_lama domain_baru`", chatId);
          return;
        }

        const oldDomain = parts[1].trim().toLowerCase();
        const newDomain = parts[2].trim().toLowerCase();
        const filePath = "list.txt";

        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!domainRegex.test(newDomain)) {
          await sendTelegram("❌ Domain baru tidak valid\\!", chatId);
          return;
        }

        let list = fs.readFileSync(filePath, "utf8").split("\n").map(d => d.trim()).filter(Boolean);

        if (list.some(line => line.toLowerCase() === newDomain)) {
          await sendTelegram(`⚠️ Domain \`${escapeMarkdownV2(newDomain)}\` sudah ada di dalam list\\!`, chatId);
          return;
        }

        let updated = false;
        list = list.map(line => {
          if (line.toLowerCase() === oldDomain) {
            updated = true;
            return newDomain;
          }
          return line;
        });

        if (updated) {
          fs.writeFileSync(filePath, list.join("\n") + "\n");

          const escapedOld = escapeMarkdownV2(oldDomain);
          const escapedNew = escapeMarkdownV2(newDomain);
          const msg = `✅ Domain \`${escapedOld}\` berhasil diganti jadi \`${escapedNew}\``;
          await sendTelegram(msg, chatId);
        } else {
          const escapedOld = escapeMarkdownV2(oldDomain);
          await sendTelegram(`❌ Domain \`${escapedOld}\` tidak ditemukan.`, chatId);
        }
      }

    } catch (e) {
      console.error("❌ Error di handler:", e.message);
    }
  })();
});

// Cek webhook aktif
app.get("/", (req, res) => {
  res.send("✅ Webhook aktif");
});

// Interval pengecekan domain tiap 60 detik
setInterval(async () => {
  console.log("🔁 Cek domain dimulai...");
  const domains = fs.readFileSync("list.txt", "utf8")
    .split("\n")
    .map(d => d.trim())
    .filter(Boolean);

  for (const domain of domains) {
    const blocked = await isDomainBlocked(domain);
    console.log(`[CHECK] ${domain} => ${blocked}`);

    if (blocked) {
      const escaped = escapeMarkdownV2(domain);
      const msg = `🚨 *Domain diblokir:* \`${escaped}\`\n\n🤖 Silakan ganti dengan domain baru via:\n/replace ${domain} namadomainbaru`;
      await sendTelegram(msg);
    }
  }
}, 60000);

// Jalankan bot
app.listen(PORT, () => {
  console.log(`🚀 Bot listening on port ${PORT}`);
});
