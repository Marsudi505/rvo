const { 
    default: makeWASocket, 
    DisconnectReason, 
    useMultiFileAuthState,
    downloadMediaMessage
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
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
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 detik
    }

    async start() {
        try {
            console.log('🤖 Starting WhatsApp ViewOnce Bot...');
            
            // Gunakan multi-file auth state untuk menyimpan sesi
            const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
            
            // Buat koneksi WhatsApp
            this.sock = makeWASocket({
                auth: state,
                printQRInTerminal: false, // Disabled untuk menghindari deprecated warning
                logger: logger,
                browser: ['ViewOnceBot', 'Chrome', '1.0.0'],
                connectTimeoutMs: 60000,
                defaultQueryTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                markOnlineOnConnect: false,
                syncFullHistory: false,
                shouldSyncHistoryMessage: () => false,
                generateHighQualityLinkPreview: false,
                getMessage: async (key) => {
                    return { conversation: 'Hello' };
                }
            });

            // Event handler untuk update kredensial
            this.sock.ev.on('creds.update', saveCreds);

            // Event handler untuk update koneksi
            this.sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;
                
                if (qr) {
                    console.log('\n📱 QR Code Received!');
                    console.log('👆 Scan QR code below with your WhatsApp app:');
                    console.log('━'.repeat(50));
                    
                    // Display QR in terminal dengan ukuran kecil
                    qrcode.generate(qr, { small: true });
                    
                    console.log('━'.repeat(50));
                    console.log('📋 QR String (for manual use):', qr.substring(0, 50) + '...');
                    
                    // Save QR string to file
                    fs.writeFileSync('./qr-code.txt', qr);
                    console.log('💾 QR code string saved to: qr-code.txt');
                    console.log('\n⏳ Waiting for scan...\n');
                    
                    // Reset reconnect attempts saat QR baru
                    this.reconnectAttempts = 0;
                }
                
                if (connection === 'close') {
                    const shouldReconnect = (lastDisconnect?.error instanceof Boom) 
                        ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut 
                        : true;
                    
                    console.log('❌ Connection closed due to:', lastDisconnect?.error?.message);
                    console.log('🔄 Should reconnect:', shouldReconnect);
                    
                    if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.reconnectAttempts++;
                        console.log(`🔄 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay/1000} seconds...`);
                        
                        setTimeout(() => {
                            this.start();
                        }, this.reconnectDelay);
                        
                        // Increase delay for next attempt
                        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, 30000);
                    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        console.log('❌ Max reconnection attempts reached. Bot stopped.');
                        process.exit(1);
                    } else {
                        console.log('👋 Bot logged out. Please restart manually.');
                        process.exit(0);
                    }
                } else if (connection === 'connecting') {
                    console.log('🔄 Connecting to WhatsApp...');
                } else if (connection === 'open') {
                    console.log('✅ Bot successfully connected to WhatsApp!');
                    console.log('🎉 Ready to save view-once messages!');
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.reconnectDelay = 5000; // Reset delay
                    
                    // Send startup notification to self
                    try {
                        const yourJid = YOUR_PHONE_NUMBER + '@s.whatsapp.net';
                        console.log('📬 Startup notification sent to your WhatsApp!');
                    } catch (error) {
                        console.log('⚠️ Failed to send startup notification:', error.message);
                    }
                }
            });

            // Event handler untuk pesan masuk
            this.sock.ev.on('messages.upsert', async (m) => {
                try {
                    if (!m.messages || m.messages.length === 0) return;
                    
                    const message = m.messages[0];
                    if (!message || !message.message) {
                        return;
                    }

                    // Skip pesan lama (lebih dari 30 detik)
                    const messageAge = Date.now() - (message.messageTimestamp * 1000);
                    if (messageAge > 3000000) {
                        return;
                    }

                    console.log('📨 New message from:', message.key.remoteJid?.replace('@s.whatsapp.net', ''));
                    await this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Error processing message:', error.message);
                }
            });

            // Error handler untuk socket
            this.sock.ev.on('connection.error', (error) => {
                console.error('⚠️ Socket connection error:', error.message);
            });

        } catch (error) {
            console.error('❌ Error starting bot:', error.message);
            
            // Retry after delay
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`🔄 Retrying start in ${this.reconnectDelay/1000} seconds...`);
                setTimeout(() => this.start(), this.reconnectDelay);
            }
        }
    }

    async handleMessage(message) {
        try {
            const messageContent = message.message;
            const from = message.key.remoteJid;
            
            // Skip pesan broadcast dan status
            if (from?.includes('@broadcast') || from?.includes('status@broadcast')) {
                return;
            }

            const messageText = this.getMessageText(messageContent);

            // Cek apakah pesan adalah command 🗿
            if (messageText && messageText.trim().startsWith('🗿')) {
                console.log('🗿 Command detected!');
                
                // Cek apakah pesan ini adalah reply
                const quotedMessage = messageContent.extendedTextMessage?.contextInfo?.quotedMessage;
                
                if (quotedMessage) {
                    console.log('📋 Processing quoted message...');
                    await this.handleViewOnceCommand(message, quotedMessage, from);
                } else {
                    console.log('⚠️ No quoted message found');
                    await this.sendHelpMessage(from);
                }
            }

            // Auto-save view once media ketika diterima
            if (this.isViewOnceMessage(messageContent) && !message.key.fromMe) {
                console.log('👁️ View-once message detected! Auto-saving...');
                await this.saveViewOnceMedia(message, from);
            }

        } catch (error) {
            console.error('❌ Error handling message:', error.message);
        }
    }



    getMessageText(messageContent) {
        try {
            if (!messageContent) return null;

            // Pesan text biasa
            if (messageContent.conversation) {
                return messageContent.conversation;
            }
            
            // Pesan extended text (reply, mention, dll)
            if (messageContent.extendedTextMessage?.text) {
                return messageContent.extendedTextMessage.text;
            }

            // Pesan dengan caption
            const captionSources = [
                messageContent.imageMessage?.caption,
                messageContent.videoMessage?.caption,
                messageContent.documentMessage?.caption
            ];

            for (const caption of captionSources) {
                if (caption) return caption;
            }

            return null;
        } catch (error) {
            console.error('❌ Error getting message text:', error.message);
            return null;
        }
    }

    isViewOnceMessage(messageContent) {
        try {
            if (!messageContent) return false;
            
            const hasViewOnceImage = messageContent.imageMessage?.viewOnce;
            const hasViewOnceVideo = messageContent.videoMessage?.viewOnce;
            
            return hasViewOnceImage || hasViewOnceVideo;
        } catch (error) {
            console.error('❌ Error checking view once message:', error.message);
            return false;
        }
    }

    async handleViewOnceCommand(message, quotedMessage, from) {
        try {
            console.log('🔄 Processing view-once command...');

            // Cek apakah pesan yang direply adalah view once

            // Send processing message

            // Download media dari pesan yang direply
            const mediaData = await this.downloadViewOnceMedia(quotedMessage);
            
            if (mediaData) {
                console.log('✅ Media downloaded! Sending to self...');
                
                // Kirim media ke nomor Anda
                await this.sendMediaToSelf(mediaData, from);
                
                // Send success confirmation
            } else {
                console.log('❌ Failed to download media');
                await this.sock.sendMessage(from, { 
                    text: '' 
                });
            }

        } catch (error) {
            console.error('❌ Error handling view-once command:', error.message);
            try {
                await this.sock.sendMessage(from, { 
                    text: '' 
                });
            } catch (sendError) {
                console.error('❌ Error sending error message:', sendError.message);
            }
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

            // Download media dengan timeout
            console.log('⬇️ Downloading media...');
            const buffer = await downloadMediaMessage(tempMessage, 'buffer', {});
            
            // Simpan ke file
            const filePath = path.join(MEDIA_STORAGE_PATH, fileName);
            fs.writeFileSync(filePath, buffer);
            console.log(`💾 Media saved: ${fileName}`);

            return {
                buffer,
                mediaType,
                fileName,
                filePath,
                caption: mediaMessage.caption || ''
            };

        } catch (error) {
            console.error('❌ Error downloading view-once media:', error.message);
            return null;
        }
    }

    async saveViewOnceMedia(message, fromJid) {
        try {
            const messageContent = message.message;
            const mediaData = await this.downloadViewOnceMedia(messageContent);
            
            if (mediaData) {
                console.log(`🎯 Auto-saved: ${mediaData.fileName}`);
                // Automatically send to self
                await this.sendMediaToSelf(mediaData, fromJid);
            }
        } catch (error) {
            console.error('❌ Error auto-saving view-once media:', error.message);
        }
    }

    async sendMediaToSelf(mediaData, fromJid = null) {
        try {
            const yourJid = YOUR_PHONE_NUMBER + '@s.whatsapp.net';
            
            // Info tambahan tentang pengirim
            const senderInfo = fromJid ? `\n👤 From: ${fromJid.replace('@s.whatsapp.net', '').replace('@c.us', '')}` : '';
            const timestamp = new Date().toLocaleString('id-ID', {
                day: '2-digit',
                month: '2-digit', 
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
            
            const baseCaption = `⏰ Saved: ${timestamp}${senderInfo}\n\n${mediaData.caption || 'No caption'}`;

            if (mediaData.mediaType === 'image') {
                await this.sock.sendMessage(yourJid, {
                    image: mediaData.buffer,
                    caption: `📷 *View Once Image (Saved)*\n${baseCaption}`
                });
                console.log('📷 Image sent to self');
            } else if (mediaData.mediaType === 'video') {
                await this.sock.sendMessage(yourJid, {
                    video: mediaData.buffer,
                    caption: `🎥 *View Once Video (Saved)*\n${baseCaption}`
                });
                console.log('🎥 Video sent to self');
            }

        } catch (error) {
            console.error('❌ Error sending media to self:', error.message);
            throw error;
        }
    }

    async stop() {
        try {
            if (this.sock) {
                console.log('🔌 Closing WhatsApp connection...');
                await this.sock.logout();
                this.sock = null;
                this.isConnected = false;
            }
        } catch (error) {
            console.error('❌ Error stopping bot:', error.message);
        }
    }
}

// Jalankan bot
const bot = new ViewOnceBot();

// Handle process termination gracefully
process.on('SIGINT', async () => {
    console.log('\n👋 Stopping bot gracefully...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n📴 Received SIGTERM, stopping bot...');
    await bot.stop();
    process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('💥 Uncaught Exception:', error.message);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚫 Unhandled Rejection:', reason);
});

// Start the bot
console.log('🚀 Starting WhatsApp ViewOnce Bot...');
console.log('📋 Bot will save view-once messages automatically');
console.log('🗿 Use 🗿 emoji to manually trigger save');
console.log('━'.repeat(50));

bot.start();
