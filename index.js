require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { google } = require("googleapis");
const fs = require("fs");
const fetch = require("node-fetch");

const SPREADSHEET_ID = "1plB67cM8a2B_aLPx3o2F_bUwU1m9GwYevqyOYDL0SwQ";
const SHEET_NAME = "domain_data";
const CREDENTIALS_PATH = "/etc/secrets/domain-monitor.json";

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 80;

const app = express();
app.use(bodyParser.json());

// Setup auth Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: CREDENTIALS_PATH,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets("v4");

async function getClient() {
  return await auth.getClient();
}

// Load domain list from Google Sheets
async function getDomainList() {
  const client = await getClient();
  const res = await sheets.spreadsheets.values.get({
    auth: client,
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:A`,
  });
  return res.data.values?.flat() || [];
}

// Replace old domain with new one in Google Sheets
async function replaceDomain(oldDomain, newDomain) {
  const list = await getDomainList();
  const index = list.findIndex(d => d.toLowerCase() === oldDomain.toLowerCase());
  if (index === -1) return false;

  const client = await getClient();
  const updateRange = `${SHEET_NAME}!A${index + 2}`;
  await sheets.spreadsheets.values.update({
    auth: client,
    spreadsheetId: SPREADSHEET_ID,
    range: updateRange,
    valueInputOption: "RAW",
    requestBody: { values: [[newDomain]] },
  });
  return true;
}

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

let notifiedBlocked = [];

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
        const data = await getDomainList();
        const listMsg = `🧾 *Daftar Seluruh Domain (${data.length}):*\n` +
        data.map((d, i) => `${i + 1}. ${d}`).join("\n");
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

        const list = await getDomainList();
        if (list.includes(newDomain)) {
          await sendTelegram(`⚠️ Domain \`${newDomain}\` sudah ada di list.`, chatId);
          return;
        }

        const replaced = await replaceDomain(oldDomain, newDomain);
        if (replaced) {
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
  const domains = await getDomainList();

  for (const domain of domains) {
    const blocked = await isDomainBlocked(domain);
    console.log(`[CHECK] ${domain} => ${blocked}`);

    const lower = domain.toLowerCase();

    if (blocked && !notifiedBlocked.includes(lower)) {
      const msg = `🚨 *Domain diblokir*: \`${domain}\`\n\n🤖 Ganti dengan:\n/replace \`${domain}\` namadomainbaru`;
      await sendTelegram(msg);
      notifiedBlocked.push(lower);
    }

    if (!blocked && notifiedBlocked.includes(lower)) {
      notifiedBlocked = notifiedBlocked.filter(d => d !== lower);
    }
  }
}, 60_000);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Bot listening on port ${PORT}`);
});
