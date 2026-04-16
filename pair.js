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

// Fonksyon pou efase dosye tanporè yo
function removeFile(path) {
    if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true });
    }
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    if (!num) {
        return res.send({ code: "❗ Antre yon nimewo valid" });
    }

    // Netwaye nimewo a (retire +, espas, elatriye)
    num = num.replace(/[^0-9]/g, '');

    if (num.length < 10) {
        return res.send({ code: "❗ Nimewo WhatsApp la envalid" });
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
            // Chanjman isit la: Chrome sou Ubuntu pi stab pou notifikasyon
            browser: ["Ubuntu", "Chrome", "20.0.04"] 
        });

        sock.ev.on('creds.update', saveCreds);

        // 🔑 GENERASYON KÒD PAIRING
        if (!sock.authState.creds.registered) {
            // Nou bay sistèm nan 5 segonn pou l konekte ak sèvè a anvan li mande kòd
            await delay(5000);

            try {
                const code = await sock.requestPairingCode(num);
                if (code) {
                    console.log(`✅ Kòd jenerat pou ${num}: ${code}`);
                    return res.send({ code });
                } else {
                    return res.send({ code: "❗ Erè nan sèvè WhatsApp" });
                }
            } catch (err) {
                console.log("PAIR ERROR:", err);
                return res.send({ code: "❗ Echec generasyon kòd" });
            }
        }

        // 🔌 KONEKSYON AK MESAJ SIKSE
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log("✅ Bot la konekte sou:", sock.user.id);

                await delay(5000); // Kite creds.json lan fin ekri nèt

                try {
                    const credsPath = `${sessionPath}/creds.json`;

                    // Upload sou Mega
                    const mega_url = await upload(
                        fs.createReadStream(credsPath),
                        `${sock.user.id}.json`
                    );

                    const session_id = mega_url.replace('https://mega.nz/file/', '');

                    // 📩 Voye ID sesyon an bay itilizatè a
                    let msg1 = `🚀 *Fusée MD Connected!*\n\n🔐 *Session ID:*\n${session_id}\n\n⚠️ Pa bay pèsonn kòd sa a.`;
                    await sock.sendMessage(sock.user.id, { text: msg1 });

                    let msg2 = `👋 *Hello!*\n\n✅ Bot la konekte ak siksè.\n\n📢 Channel:\nhttps://whatsapp.com/channel/0029VbB2p44KWEKt0C6sx225\n\n© Weed-Tech 🚀`;
                    await sock.sendMessage(sock.user.id, { text: msg2 });

                } catch (e) {
                    console.log("UPLOAD ERROR:", e);
                }

                // Netwaye apre koneksyon
                await delay(3000);
                removeFile(sessionPath);
            }

            if (connection === "close") {
                const status = lastDisconnect?.error?.output?.statusCode;
                if (status !== 401) {
                    console.log("🔄 Rekoneksyon an kous...");
                } else {
                    console.log("❌ Sesyon an ekspire");
                    removeFile(sessionPath);
                }
            }
        });

    } catch (err) {
        console.log("SERVER ERROR:", err);
        removeFile(sessionPath);
        return res.send({ code: "❗ Sèvis la pa disponib kounye a" });
    }
});

module.exports = router;

