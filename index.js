require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const fetch = require("node-fetch");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 10000;

// Fungsi kirim ke Telegram
async function sendTelegram(message, chatId = CHAT_ID) {
  const url = \`https://api.telegram.org/bot\${TELEGRAM_TOKEN}/sendMessage\`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
    }),
  });
}

// Fungsi cek domain diblokir
async function isDomainBlocked(domain) {
  try {
    const url = \`https://check.skiddle.id/?domain=\${domain}&json=true\`;
    const res = await fetch(url);
    const data = await res.json();
    return data?.[domain]?.blocked === true;
  } catch (e) {
    console.error(\`❌ Error cek \${domain}:\`, e.message);
    return false;
  }
}

const app = express();
app.use(bodyParser.json());

app.post("/", async (req, res) => {
  const msg = req.body.message;
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  if (!text) return res.sendStatus(200);

  if (text === "/list") {
    const data = fs
      .readFileSync("list.txt", "utf8")
      .split("\n")
      .map((d) => d.trim())
      .filter(Boolean)
      .slice(-15);
    const msgList =
      \`🧾 *Daftar 15 Domain Terakhir:*\n\` +
      data.map((d, i) => \`\${i + 1}. \${d}\`).join("\n");
    await sendTelegram(msgList, chatId);
  } else if (text.startsWith("/replace")) {
    const parts = text.split(" ");
    if (parts.length < 3) {
      await sendTelegram(
        "❌ Format salah!\nContoh: /replace domain_lama domain_baru",
        chatId
      );
    } else {
      const [_, oldDomainRaw, newDomainRaw] = parts;
      const oldDomain = oldDomainRaw.trim().toLowerCase();
      const newDomain = newDomainRaw.trim();
      const filePath = "list.txt";
      let list = fs.readFileSync(filePath, "utf8").split("\n");
      let updated = false;

      list = list.map((line) => {
        const cleanLine = line.trim().toLowerCase();
        if (cleanLine === oldDomain) {
          updated = true;
          return newDomain;
        }
        return line.trim();
      });

      if (updated) {
        fs.writeFile(filePath, list.join("\n") + "\n", (err) => {
          if (err) {
            console.error("❌ Gagal simpan file:", err);
          } else {
            console.log("✅ File list.txt berhasil diupdate");
          }
        });
        await sendTelegram(
          \`✅ Domain \\`\${oldDomainRaw}\\` berhasil diganti jadi \\`\${newDomain}\\`\`,
          chatId
        );
      } else {
        await sendTelegram(
          \`❌ Domain \\`\${oldDomainRaw}\\` tidak ditemukan.\`,
          chatId
        );
      }
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("✅ Webhook aktif");
});

setInterval(async () => {
  console.log("🔁 Cek domain dimulai...");
  const domains = fs
    .readFileSync("list.txt", "utf8")
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);

  for (const domain of domains) {
    const blocked = await isDomainBlocked(domain);
    if (blocked) {
      const msg = \`🚨 *Domain diblokir*: \\`\${domain}\\`\n\n🤖 Silakan ganti dengan domain baru via:\n/replace \${domain} namadomainbaru\`;
      await sendTelegram(msg);
    }
  }
}, 60000);

app.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Bot listening on port " + PORT);
});
