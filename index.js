import makeWASocket from '@whiskeysockets/baileys';
import { useMultiFileAuthState, delay, DisconnectReason } from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Serve frontend files dynamically from public folder
app.use(express.static('public'));

// Main API endpoint to get pairing code
app.get('/pair', async (req, res) => {
    let phone = req.query.phone;

    if (!phone) {
        return res.status(400).json({ error: 'Please provide a phone number!' });
    }

    phone = phone.replace(/[^0-9]/g, '');
    const sessionDir = `./temp_auth_${phone}`;
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    let pairingRequested = false;

    try {
        const sock = makeWASocket({
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            syncFullHistory: false
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if ((qr || connection === 'connecting') && !sock.authState.creds.registered && !pairingRequested) {
                pairingRequested = true; 
                await delay(3000); 
                
                try {
                    console.log(`[${phone}] Requesting unique pairing code...`);
                    const code = await sock.requestPairingCode(phone);
                    
                    if (!res.headersSent) {
                        return res.status(200).json({ code: code });
                    }
                } catch (pairError) {
                    console.error(`[${phone}] Pairing Code Error:`, pairError.message);
                    if (!res.headersSent) {
                        return res.status(500).json({ error: 'Failed to get code. Refresh and try again.' });
                    }
                }
            }

            if (connection === 'open') {
                console.log(`[${phone}] Connected successfully!`);
                await delay(2000);

                const credsPath = path.join(sessionDir, 'creds.json');
                if (fs.existsSync(credsPath)) {
                    const credsData = fs.readFileSync(credsPath, 'utf-8');
                    const userSessionPath = `./session.json`;
                    fs.writeFileSync(userSessionPath, credsData);

                    const jid = `${phone}@s.whatsapp.net`;
                    await sock.sendMessage(jid, {
                        document: fs.readFileSync(userSessionPath),
                        mimetype: 'application/json',
                        fileName: 'session.json',
                        caption: '✅ *TishX-MD Session File is Ready!*\n\n> Download this file and upload it to your hosting platform (Zeabur / Render).\n\n⚠️ *Security Warning:* Never share this file with anyone.'
                    });

                    console.log(`[${phone}] Session file sent to WhatsApp.`);
                    
                    await delay(2000);
                    try {
                        if (fs.existsSync(userSessionPath)) fs.unlinkSync(userSessionPath);
                        if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
                    } catch (e) {
                        console.log("Cleanup handled safely.");
                    }
                    
                    sock.logout();
                }
            }

            if (connection === 'close') {
                const reason = lastDisconnect?.error?.output?.statusCode;
                if (reason === DisconnectReason.loggedOut) {
                    if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            }
        });

        sock.ev.on('creds.update', saveCreds);

    } catch (err) {
        console.error(err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error!' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Session Server running on Port ${PORT}... 😎🔥`);
});