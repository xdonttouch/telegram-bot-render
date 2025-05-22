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

app.listen(PORT, () => {
  console.log(`✅ Server aktif di PORT: ${PORT}`);
});

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

// Fungsi cek domain diblokir
async function isDomainBlocked(domain) {
  try {
    const url = `https://check.skiddle.id/?domain=${domain}&json=true`;
    const res = await fetch(url);
    const data = await res.json();
    const key = Object.keys(data).find(k => k.toLowerCase() === domain.toLowerCase());
    const val = typeof data[key] === "string" ? JSON.parse(data[key]) : data[key];
    return val?.blocked === true;
  } catch (e) {
    console.error(`❌ Error cek ${domain}:`, e.message);
    return false;
  }
}

// Fungsi untuk copy link sekali klik
function escapeMarkdownV2(text) {
  return text.replace(/([_\*\[\]\(\)\~\`\>\#\+\=\|\{\}\.\!\-\\])/g, '\\$1');
}

// Endpoint webhook Telegram
app.post("/", (req, res) => {
  res.sendStatus(200); // Biar Telegram gak timeout

  (async () => {
    try {
      const msg = req.body.message || req.body.edited_message || req.body.callback_query;
      const chatId = msg?.chat?.id || msg?.from?.id;
      const text = msg?.text || msg?.data;
      if (!text || !chatId) return;

      console.log("📥 Command diterima:", text);

      if (text === "/list") {
        const data = fs.readFileSync("list.txt", "utf8")
          .split("\n")
          .map(d => d.trim())
          .filter(Boolean)
          .slice(-15);

        const listMsg = `🧾 *Daftar 15 Domain Terakhir:*\n` + data.map((d, i) => `${i + 1}. ${d}`).join("\n");
        await sendTelegram(listMsg, chatId);
      }

      else if (text.startsWith("/replace")) {
        const parts = text.trim().split(" ");
        if (parts.length < 3) {
          await sendTelegram("❌ Format salah!\nContoh: `/replace domain_lama domain_baru`", chatId);
          return;
        }

        const oldDomain = parts[1].toLowerCase();
        const newDomain = parts[2];
        const filePath = "list.txt";

        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!domainRegex.test(newDomain)) {
          await sendTelegram("❌ Domain baru tidak valid!", chatId);
          return;
        }

        let list = fs.readFileSync(filePath, "utf8").split("\n").map(d => d.trim()).filter(Boolean);

        if (list.some(d => d.toLowerCase() === newDomain.toLowerCase())) {
          await sendTelegram(`⚠️ Domain ${newDomain} sudah ada di dalam list!`, chatId);
          return;
        }

        let updated = false;
        list = list.map(d => {
          if (d.toLowerCase() === oldDomain) {
            updated = true;
            return newDomain;
          }
          return d;
        });

        if (updated) {
          fs.writeFileSync(filePath, list.join("\n") + "\n");
          const oldEscaped = escapeMarkdownV2(oldDomain);
          const newEscaped = escapeMarkdownV2(newDomain);
          const msg = `✅ Domain \\\`${oldEscaped}\\\` berhasil diganti jadi \\\`${newEscaped}\\\``;
          await sendTelegram(msg, chatId);
        } else {
          const oldEscaped = escapeMarkdownV2(oldDomain);
          const msg = `❌ Domain \\\`${oldEscaped}\\\` tidak ditemukan.`;
          await sendTelegram(msg, chatId);
        }
      }

    } catch (e) {
      console.error("❌ Error di handler:", e.message);
    }
  })();
});
