const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');

// Simple logger untuk mengganti console
const logger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    trace: () => {},
    child: () => logger
};

// Konfigurasi
const YOUR_PHONE_NUMBER = '6285790374090'; // Ganti dengan nomor WhatsApp Anda (format: 628...)
const MEDIA_STORAGE_PATH = './view_once_media/';

// Buat folder untuk menyimpan media jika belum ada
if (!fs.existsSync(MEDIA_STORAGE_PATH)) {
    fs.mkdirSync(MEDIA_STORAGE_PATH, { recursive: true });
}

class ViewOnceBot {
    constructor() {
        this.sock = null;
        this.isConnected = false;
    }

    async start() {
        try {
            // Gunakan multi-file auth state untuk menyimpan sesi
            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
            
            // Buat koneksi WhatsApp
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: true,
                logger: logger,
                browser: ['ViewOnceBot', 'Chrome', '1.0.0']
            });

            // Event handler untuk update kredensial
            this.sock.ev.on('creds.update', saveCreds);

            // Event handler untuk update koneksi
            this.sock.ev.on('connection.update', (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect.error instanceof Boom) 
                        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                        : false;
                    
                    console.log('Koneksi terputus karena ', lastDisconnect.error, ', reconnecting ', shouldReconnect);
                    
                    if (shouldReconnect) {
                        this.start();
                    }
                } else if (connection === 'open') {
                    console.log('Bot berhasil terhubung!');
                    this.isConnected = true;
                }
            });

            // Event handler untuk pesan masuk
            this.sock.ev.on('messages.upsert', async (m) => {
                console.log('New message received:', m.messages.length);
                
                const message = m.messages[0];
                if (!message) {
                    console.log('Skipping: message is null/undefined');
                    return;
                }

                console.log('Message key:', message.key);
                console.log('Message fromMe:', message.key.fromMe);
                console.log('Message content keys:', Object.keys(message.message || {}));

                console.log('Processing message from:', message.key.remoteJid);
                await this.handleMessage(message);
            });

        } catch (error) {
            console.error('Error starting bot:', error);
        }
    }

    async handleMessage(message) {
        try {
            // Validasi message structure
            if (!message || !message.message) {
                console.log('Skipping: no message content');
                return;
            }

            const messageContent = message.message;
            const from = message.key.remoteJid;
            
            console.log('Message content structure:', Object.keys(messageContent));

            // Skip pesan broadcast
            if (from.includes('@broadcast')) {
                console.log('Skipping: broadcast message');
                return;
            }

            const messageText = this.getMessageText(messageContent);

            console.log('Pesan diterima dari:', from);
            console.log('Isi pesan:', messageText || 'Media/Non-text message');

            // Cek apakah pesan adalah command 🗿
            if (messageText && messageText.trim().startsWith('🗿')) {
                console.log('Command 🗿 detected');
                
                // Cek apakah pesan ini adalah reply
                const quotedMessage = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (quotedMessage) {
                    console.log('Quoted message found, processing...');
                    await this.handleViewOnceCommand(message, quotedMessage, from);
                } else {
                    console.log('No quoted message found');
                    // Tidak ada balasan text
                }
            }

            // Auto-save view once media ketika diterima (kecuali dari diri sendiri untuk menghindari loop)
            if (this.isViewOnceMessage(messageContent) && !message.key.fromMe) {
                console.log('View once message detected, auto-saving...');
                await this.saveViewOnceMedia(message);
            }

        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    getMessageText(messageContent) {
        try {
            // Validasi input
            if (!messageContent) {
                return null;
            }

            // Pesan text biasa
            if (messageContent.conversation) {
                return messageContent.conversation;
            }
            
            // Pesan extended text (reply, mention, dll)
            if (messageContent.extendedTextMessage && messageContent.extendedTextMessage.text) {
                return messageContent.extendedTextMessage.text;
            }

            // Pesan dengan caption (image, video, document)
            if (messageContent.imageMessage && messageContent.imageMessage.caption) {
                return messageContent.imageMessage.caption;
            }
            
            if (messageContent.videoMessage && messageContent.videoMessage.caption) {
                return messageContent.videoMessage.caption;
            }
            
            if (messageContent.documentMessage && messageContent.documentMessage.caption) {
                return messageContent.documentMessage.caption;
            }

            return null;
        } catch (error) {
            console.error('Error getting message text:', error);
            return null;
        }
    }

    isViewOnceMessage(messageContent) {
        try {
            if (!messageContent) return false;
            
            const hasViewOnceImage = messageContent.imageMessage && messageContent.imageMessage.viewOnce;
            const hasViewOnceVideo = messageContent.videoMessage && messageContent.videoMessage.viewOnce;
            
            console.log('Checking view once:', {
                hasImageMessage: !!messageContent.imageMessage,
                hasVideoMessage: !!messageContent.videoMessage,
                hasViewOnceImage,
                hasViewOnceVideo
            });
            
            return hasViewOnceImage || hasViewOnceVideo;
        } catch (error) {
            console.error('Error checking view once message:', error);
            return false;
        }
    }

    async handleViewOnceCommand(message, quotedMessage, from) {
        try {
            console.log('Processing view once command...');
            console.log('Quoted message type:', Object.keys(quotedMessage));

            // Cek apakah pesan yang direply adalah view once
            if (!this.isViewOnceMessage(quotedMessage)) {
                console.log('Not a view once message');
                // Tidak ada balasan text
                return;
            }

            console.log('View once message confirmed, downloading...');

            // Download media dari pesan yang direply
            const mediaData = await this.downloadViewOnceMedia(quotedMessage);
            
            if (mediaData) {
                console.log('Media downloaded successfully, sending to self...');
                
                // Kirim media ke nomor Anda
                await this.sendMediaToSelf(mediaData, from);
                
                // Tidak ada balasan text
            } else {
                console.log('Failed to download media');
                // Tidak ada balasan text
            }

        } catch (error) {
            console.error('Error handling view once command:', error);
            // Tidak ada balasan text
        }
    }

    async downloadViewOnceMedia(quotedMessage) {
        try {
            let mediaMessage;
            let mediaType;
            let fileName;

            if (quotedMessage.imageMessage) {
                mediaMessage = quotedMessage.imageMessage;
                mediaType = 'image';
                fileName = `viewonce_image_${Date.now()}.jpg`;
            } else if (quotedMessage.videoMessage) {
                mediaMessage = quotedMessage.videoMessage;
                mediaType = 'video';
                fileName = `viewonce_video_${Date.now()}.mp4`;
            } else {
                return null;
            }

            // Create temporary message object for download
            const tempMessage = {
                message: {
                    [mediaType + 'Message']: mediaMessage
                }
            };

            // Download media
            const buffer = await downloadMediaMessage(tempMessage, 'buffer', {});
            
            // Simpan ke file
            const filePath = path.join(MEDIA_STORAGE_PATH, fileName);
            fs.writeFileSync(filePath, buffer);

            return {
                buffer,
                mediaType,
                fileName,
                filePath,
                caption: mediaMessage.caption || ''
            };

        } catch (error) {
            console.error('Error downloading view once media:', error);
            return null;
        }
    }

    async saveViewOnceMedia(message) {
        try {
            const messageContent = message.message;
            const mediaData = await this.downloadViewOnceMedia(messageContent);
            
            if (mediaData) {
                console.log(`Auto-saved view once media: ${mediaData.fileName}`);
            }
        } catch (error) {
            console.error('Error auto-saving view once media:', error);
        }
    }

    async sendMediaToSelf(mediaData, fromJid = null) {
        try {
            const yourJid = YOUR_PHONE_NUMBER + '@s.whatsapp.net';
            
            // Info tambahan tentang pengirim
            const senderInfo = fromJid ? `\n👤 Dari: ${fromJid.replace('@s.whatsapp.net', '')}` : '';
            const timestamp = new Date().toLocaleString('id-ID');
            
            if (mediaData.mediaType === 'image') {
                await this.sock.sendMessage(yourJid, {
                    image: mediaData.buffer,
                    caption: `📷 View Once Image (Saved)\n⏰ ${timestamp}${senderInfo}\n\n${mediaData.caption || 'Tidak ada caption'}`
                });
            } else if (mediaData.mediaType === 'video') {
                await this.sock.sendMessage(yourJid, {
                    video: mediaData.buffer,
                    caption: `🎥 View Once Video (Saved)\n⏰ ${timestamp}${senderInfo}\n\n${mediaData.caption || 'Tidak ada caption'}`
                });
            }

            console.log(`Media sent to self: ${mediaData.fileName}`);
        } catch (error) {
            console.error('Error sending media to self:', error);
            throw error;
        }
    }
}

// Jalankan bot
const bot = new ViewOnceBot();
bot.start();

// Handle process termination
process.on('SIGINT', () => {
    console.log('\nBot dihentikan...');
    process.exit(0);
});

console.log('Bot WhatsApp View Once Handler dimulai...');
console.log('Scan QR code untuk menghubungkan WhatsApp Anda.');
console.log('Gunakan command 🗿 dengan mereply pesan view once untuk menyimpan media.');