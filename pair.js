const express = require('express');
const fs = require('fs');
const pino = require("pino");
const { makeid } = require('./gen-id');
const { upload } = require('./mega');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

let router = express.Router();

// delete folder
function removeFile(path) {
    if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true });
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    if (!num) {
        return res.send({ code: "❗ Enter a valid number" });
    }

    num = num.replace(/[^0-9]/g, '');

    if (num.length < 10) {
        return res.send({ code: "❗ Invalid WhatsApp number" });
    }

    const sessionPath = `./temp/${id}`;

    try {
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Safari")
        });

        sock.ev.on('creds.update', saveCreds);

        // 🔑 PAIRING CODE
        if (!sock.authState.creds.registered) {
            await delay(3000);

            try {
                const code = await sock.requestPairingCode(num);
                console.log("PAIR CODE:", code);

                return res.send({ code });

            } catch (err) {
                console.log("PAIR ERROR:", err);
                return res.send({ code: "❗ Failed to generate code" });
            }
        }

        // 🔌 CONNECTION UPDATE
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ Connected:", sock.user.id);

                await delay(4000);

                try {
                    const credsPath = `${sessionPath}/creds.json`;

                    const mega_url = await upload(
                        fs.createReadStream(credsPath),
                        `${sock.user.id}.json`
                    );

                    const session_id = mega_url.replace('https://mega.nz/file/', '');

                    // ✅ MESSAGE 1
                    let msg1 = `🚀 *Fusée MD Connected!*

🔐 *Session ID:*
${session_id}

⚠️ Do NOT share this code with anyone.`;

                    await sock.sendMessage(sock.user.id, { text: msg1 });

                    // ✅ MESSAGE 2
                    let msg2 = `👋 *Hello User!*

✅ Bot connected successfully.

📢 Channel:
https://whatsapp.com/channel/0029VbB2p44KWEKt0C6sx225

💻 GitHub:
https://github.com/WeedTech/Fus-e-MD

© Weed-Tech 🚀`;

                    await sock.sendMessage(sock.user.id, { text: msg2 });

                } catch (e) {
                    console.log("UPLOAD ERROR:", e);

                    await sock.sendMessage(sock.user.id, {
                        text: "❗ Error saving session, try again."
                    });
                }

                // cleanup
                await delay(2000);
                removeFile(sessionPath);

                // ⚠️ pa fè process.exit ankò (sa te bug la)
            }

            // reconnect si crash
            if (connection === "close") {
                const status = lastDisconnect?.error?.output?.statusCode;

                if (status !== 401) {
                    console.log("🔄 Reconnecting...");
                } else {
                    console.log("❌ Session expired");
                }
            }
        });

    } catch (err) {
        console.log("SERVER ERROR:", err);
        removeFile(sessionPath);
        return res.send({ code: "❗ Service Unavailable" });
    }
});

module.exports = router;
