const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// =============================================================
// Fishgold WhatsApp Bridge
// Connects to WhatsApp Web and forwards messages to the API
// =============================================================

const API_URL = process.env.API_URL || 'https://amuta-os.vercel.app';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

// Show QR code in terminal
client.on('qr', (qr) => {
  console.log('\n========================================');
  console.log('  Scan this QR code with WhatsApp:');
  console.log('  (055-9902109)');
  console.log('========================================\n');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('\n✓ Fishgold WhatsApp Bot is LIVE!');
  console.log(`  Connected to: ${client.info.pushname} (${client.info.wid.user})`);
  console.log(`  API: ${API_URL}`);
  console.log('  Waiting for messages...\n');
});

client.on('authenticated', () => {
  console.log('✓ Authenticated successfully');
});

client.on('auth_failure', (msg) => {
  console.error('✗ Authentication failed:', msg);
});

// Handle incoming messages
client.on('message', async (msg) => {
  // Skip group messages
  if (msg.from.includes('@g.us')) return;
  // Skip status updates
  if (msg.from === 'status@broadcast') return;
  // Only text messages
  if (msg.type !== 'chat') return;

  const phone = msg.from.replace('@c.us', '');
  const text = msg.body;
  const contact = await msg.getContact();
  const senderName = contact.pushname || contact.name || '';

  console.log(`[${new Date().toLocaleTimeString('he-IL')}] ${senderName} (${phone}): ${text.slice(0, 60)}...`);

  try {
    // Send to Fishgold API in Green API format (already supported)
    const response = await fetch(`${API_URL}/api/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-bridge-mode': 'true', // Tell API not to send via Meta/Green — we send here
      },
      body: JSON.stringify({
        senderData: {
          chatId: msg.from,
          senderName: senderName,
        },
        messageData: {
          typeMessage: 'textMessage',
          textMessageData: { textMessage: text },
        },
      }),
    });

    const data = await response.json();

    if (data.reply) {
      // Split long messages
      const chunks = splitMessage(data.reply, 1500);
      for (const chunk of chunks) {
        try {
          await msg.reply(chunk);
        } catch (sendErr) {
          console.error(`  ✗ sendMessage failed (invalid number or WA error):`, sendErr.message || sendErr);
          // Do not rethrow — continue without crashing
        }
        if (chunks.length > 1) await sleep(800);
      }
      console.log(`  → Replied (${data.reply.length} chars)`);
    } else {
      console.log(`  → Processed (no reply — onboarding/command handled by API)`);
    }
  } catch (error) {
    console.error(`  ✗ Error:`, error.message || error);
    try {
      await msg.reply('שגיאה זמנית. נסו שוב בעוד רגע.');
    } catch { /* ignore send error in error handler */ }
  }
});

// Utility functions
function splitMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { parts.push(remaining); break; }
    let splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < maxLen * 0.3) splitAt = maxLen;
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return parts;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Reconnect handler — destroy and exit so PM2/Docker restarts cleanly
client.on('disconnected', async (reason) => {
  console.error(`✗ WhatsApp disconnected: ${reason}. Restarting...`);
  try {
    await client.destroy();
  } catch { /* ignore destroy errors */ }
  process.exit(1);
});

// Start
console.log('Starting Fishgold WhatsApp Bridge...');
console.log(`API endpoint: ${API_URL}/api/whatsapp`);
client.initialize();
