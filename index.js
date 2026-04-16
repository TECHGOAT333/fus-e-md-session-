import express from 'express';
import fs from 'fs-extra';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeid } from './gen-id.js'; 
import { upload } from './mega.js';   

import pkg from '@whiskeysockets/baileys';
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore 
} = pkg;

// Fix for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const router = express.Router();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/', router);

// Clean up function
async function removeFile(folderPath) {
    if (fs.existsSync(folderPath)) {
        await fs.remove(folderPath);
    }
}

router.get('/pair', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    if (!num) return res.send({ code: "❗ Please enter a valid number" });

    // Clean phone number
    num = num.replace(/[^0-9]/g, '');

    if (num.length < 10) return res.send({ code: "❗ Number is too short" });

    const sessionPath = path.join(__dirname, 'temp', id);

    try {
        await removeFile(sessionPath);
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

        const sock = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }))
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "110.0.5481.178"],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0
        });

        sock.ev.on('creds.update', saveCreds);

        // 🔑 GENERATE PAIRING CODE
        if (!sock.authState.creds.registered) {
            await delay(6000); // Wait for handshake
            try {
                const code = await sock.requestPairingCode(num);
                if (code && !res.headersSent) {
                    console.log(`✅ Pairing Code for ${num}: ${code}`);
                    return res.send({ code });
                }
            } catch (err) {
                console.error("Pairing Error:", err);
                if (!res.headersSent) return res.send({ code: "❗ Request refused by WhatsApp" });
            }
        }

        // 🔌 CONNECTION UPDATE
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ Successfully connected!");
                await delay(5000);

                try {
                    const credsPath = path.join(sessionPath, 'creds.json');
                    
                    if (fs.existsSync(credsPath)) {
                        const mega_url = await upload(
                            fs.createReadStream(credsPath),
                            `${sock.user.id}.json`
                        );

                        const session_id = mega_url.replace('https://mega.nz/file/', '');

                        let msg = `🚀 *Fusée MD Connected!*\n\n🔐 *Session ID:*\n${session_id}\n\n© Weed-Tech 🚀`;
                        await sock.sendMessage(sock.user.id, { text: msg });
                    }
                } catch (e) {
                    console.error("Mega Upload Error:", e);
                }

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
        console.error("Critical Server Error:", err);
        await removeFile(sessionPath);
        if (!res.headersSent) res.send({ code: "❗ Service Temporarily Unavailable" });
    }
});

// IMPORTANT FOR RENDER: Listen on 0.0.0.0
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
🚀 Fusée MD Web Server Started!
📍 Port: ${PORT}
🔗 Ready for pairing requests.
    `);
});

export default app;
