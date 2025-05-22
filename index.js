require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const fetch = require("node-fetch");

function loadDb() {
  try {
    const raw = fs.readFileSync("db.json", "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { domainList: [], notifiedBlocked: [] };
  }
}

function saveDb(data) {
  fs.writeFileSync("db.json", JSON.stringify(data, null, 2));
}

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 80;

const app = express();
app.use(bodyParser.json());

async function sendTelegram(message, chatId = CHAT_ID) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown",
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

app.post("/", (req, res) => {
  res.sendStatus(200);

  (async () => {
    try {
      const msg = req.body.message || req.body.edited_message || req.body.callback_query;
      const chatId = msg?.chat?.id || msg?.from?.id;
      const text = msg?.text || msg?.data;
      if (!text || !chatId) return;

      console.log("📥 Command diterima:", text);

      if (text === "/list") {
        const data = loadDb().domainList;
        const listMsg = `🧾 *Daftar 15 Domain Terakhir:*\n` + data.slice(-15).map((d, i) => `${i + 1}. ${d}`).join("\n");
        await sendTelegram(listMsg, chatId);
      }

      else if (text.startsWith("/replace ")) {
        const parts = text.trim().split(" ");
        if (parts.length < 3) {
          await sendTelegram("❌ Format salah!\nContoh: `/replace domain_lama domain_baru`", chatId);
          return;
        }

        const oldDomain = parts[1].toLowerCase();
        const newDomain = parts[2];
        const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

        if (!domainRegex.test(newDomain)) {
          await sendTelegram("❌ Domain baru tidak valid!", chatId);
          return;
        }

        const db = loadDb();
        let list = db.domainList.map(d => d.trim());

        if (list.some(d => d.toLowerCase() === newDomain.toLowerCase())) {
          await sendTelegram(`⚠️ Domain \`${newDomain}\` sudah ada di list.`, chatId);
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
          db.domainList = list;
          saveDb(db);
          await sendTelegram(`✅ Domain \`${oldDomain}\` berhasil diganti jadi \`${newDomain}\``, chatId);
        } else {
          await sendTelegram(`❌ Domain \`${oldDomain}\` tidak ditemukan.`, chatId);
        }
      }
    } catch (e) {
      console.error("❌ Error di handler:", e.message);
    }
  })();
});

app.get("/", (req, res) => {
  res.send("✅ Webhook aktif");
});

setInterval(async () => {
  console.log("🔁 Cek domain dimulai...");
  const db = loadDb();
  const domains = db.domainList;
  const notified = db.notifiedBlocked;

  for (const domain of domains) {
    const blocked = await isDomainBlocked(domain);
    console.log(`[CHECK] ${domain} => ${blocked}`);

    const lowerDomain = domain.toLowerCase();

    if (blocked && !notified.includes(lowerDomain)) {
      const msg = `🚨 *Domain diblokir*: \`${domain}\`\n\n🤖 Ganti dengan:\n/replace \`${domain}\` namadomainbaru`;
      await sendTelegram(msg);
      db.notifiedBlocked.push(lowerDomain);
    }

    if (!blocked && notified.includes(lowerDomain)) {
      db.notifiedBlocked = db.notifiedBlocked.filter(d => d !== lowerDomain);
    }
  }

  saveDb(db);
}, 60_000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Bot listening on port ${PORT}`);
});
