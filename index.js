const express = require('express');
const fs = require('fs-extra');
const pino = require("pino");
const path = require('path');
const { makeid } = require('./gen-id');
const { upload } = require('./mega');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore
} = require('@whiskeysockets/baileys');

const app = express();
const router = express.Router();

// Use Render's PORT or default to 3000
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/', router);

// Function to clean up temporary session files
async function removeFile(folderPath) {
    if (fs.existsSync(folderPath)) {
        await fs.remove(folderPath);
    }
}

router.get('/pair', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    if (!num) {
        return res.send({ code: "❗ Enter a valid number" });
    }

    // Sanitize number (remove +, spaces, etc.)
    num = num.replace(/[^0-9]/g, '');

    if (num.length < 10) {
        return res.send({ code: "❗ Number is too short" });
    }

    const sessionPath = path.join(__dirname, 'temp', id);

    try {
        // Clean up any existing residue before starting
        await removeFile(sessionPath);

        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            // Stable browser identity to trigger notifications
            browser: ["Ubuntu", "Chrome", "110.0.5481.178"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0
        });

        sock.ev.on('creds.update', saveCreds);

        // 🔑 GENERATE PAIRING CODE
        if (!sock.authState.creds.registered) {
            // Wait 6 seconds for the handshake to stabilize
            await delay(6000);

            try {
                const code = await sock.requestPairingCode(num);
                if (code && !res.headersSent) {
                    console.log(`✅ Code generated for ${num}: ${code}`);
                    return res.send({ code });
                }
            } catch (err) {
                console.error("PAIRING ERROR:", err);
                if (!res.headersSent) {
                    return res.send({ code: "❗ WhatsApp refused the request, please try again" });
                }
            }
        }

        // 🔌 CONNECTION UPDATE
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ Bot Connected!");
                await delay(5000);

                try {
                    const credsPath = path.join(sessionPath, 'creds.json');
                    
                    if (fs.existsSync(credsPath)) {
                        const mega_url = await upload(
                            fs.createReadStream(credsPath),
                            `${sock.user.id}.json`
                        );

                        const session_id = mega_url.replace('https://mega.nz/file/', '');

                        // Success Messages
                        let msg = `🚀 *Fusée MD Connected!*\n\n🔐 *Session ID:*\n${session_id}\n\n© Weed-Tech`;
                        await sock.sendMessage(sock.user.id, { text: msg });
                    }
                } catch (e) {
                    console.error("UPLOAD ERROR:", e);
                }

                // Final cleanup
                await delay(3000);
                await removeFile(sessionPath);
            }

            if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === 401) {
                    await removeFile(sessionPath);
                }
            }
        });

    } catch (err) {
        console.error("SERVER ERROR:", err);
        await removeFile(sessionPath);
        if (!res.headersSent) {
            return res.send({ code: "❗ Server busy, please try again" });
        }
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`
🚀 Fusée MD Server is Running!
📍 Port: ${PORT}
🔗 Local: http://localhost:${PORT}
    `);
});

module.exports = app;
