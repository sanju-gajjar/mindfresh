// Main chat room JS (migrated from room.html)
// Avatar, chat, and video call logic
// --- Self Video Preview Logic ---

// --- Self Video Preview Logic ---
let selfVideoStream = null;
const selfVideoBtn = document.getElementById('selfVideoBtn');
const selfVideoPreview = document.getElementById('selfVideoPreview');
const selfVideoElement = document.getElementById('selfVideoElement');
const closeSelfVideoBtn = document.getElementById('closeSelfVideoBtn');
// Expose to global for HTML onclick (after function definitions)
window.toggleSelfVideo = toggleSelfVideo;
window.stopSelfVideo = stopSelfVideo;

async function toggleSelfVideo() {
	if (selfVideoPreview.style.display === 'none') {
		try {
			selfVideoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
			selfVideoElement.srcObject = selfVideoStream;
			selfVideoPreview.style.display = 'block';
			if (selfVideoBtn) selfVideoBtn.classList.add('active');
		} catch (err) {
			alert('Could not access camera.');
		}
	} else {
		stopSelfVideo();
	}
}

function stopSelfVideo() {
	if (selfVideoStream) {
		selfVideoStream.getTracks().forEach(track => track.stop());
		selfVideoStream = null;
	}
	selfVideoElement.srcObject = null;
	selfVideoPreview.style.display = 'none';
	if (selfVideoBtn) selfVideoBtn.classList.remove('active');
}

if (closeSelfVideoBtn) closeSelfVideoBtn.onclick = stopSelfVideo;

// --- Make self video draggable (desktop & mobile) ---
if (selfVideoPreview) {
	let drag = false, offsetX = 0, offsetY = 0;
	selfVideoPreview.addEventListener('mousedown', function(e) {
		if (e.target === closeSelfVideoBtn) return;
		drag = true;
		offsetX = e.clientX - selfVideoPreview.getBoundingClientRect().left;
		offsetY = e.clientY - selfVideoPreview.getBoundingClientRect().top;
		document.body.style.userSelect = 'none';
	});
	document.addEventListener('mousemove', function(e) {
		if (!drag) return;
		selfVideoPreview.style.left = (e.clientX - offsetX) + 'px';
		selfVideoPreview.style.top = (e.clientY - offsetY) + 'px';
		selfVideoPreview.style.right = '';
	});
	document.addEventListener('mouseup', function() {
		drag = false;
		document.body.style.userSelect = '';
	});
	// Touch events for mobile
	let touchStartX = 0, touchStartY = 0;
	selfVideoPreview.addEventListener('touchstart', function(e) {
		if (e.target === closeSelfVideoBtn) return;
		drag = true;
		const touch = e.touches[0];
		touchStartX = touch.clientX - selfVideoPreview.getBoundingClientRect().left;
		touchStartY = touch.clientY - selfVideoPreview.getBoundingClientRect().top;
	});
	document.addEventListener('touchmove', function(e) {
		if (!drag) return;
		const touch = e.touches[0];
		selfVideoPreview.style.left = (touch.clientX - touchStartX) + 'px';
		selfVideoPreview.style.top = (touch.clientY - touchStartY) + 'px';
		selfVideoPreview.style.right = '';
	});
	document.addEventListener('touchend', function() {
		drag = false;
	});
}
// --- End-to-end encryption helpers ---
let e2eeLocalKeyPair = null;
const e2eeSharedKeys = {}; // roomId -> CryptoKey

const arrayBufferToBase64 = (buffer) => {
	let binary = '';
	const bytes = new Uint8Array(buffer);
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
};

const base64ToArrayBuffer = (base64) => {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
};

async function createE2EEKeyPair() {
	if (!window.crypto || !window.crypto.subtle) {
		console.warn('Web Crypto API unavailable, E2EE not available.');
		return;
	}
	if (e2eeLocalKeyPair) return;
	e2eeLocalKeyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveKey']
	);
}

async function sendE2EEPublicKey(socket, roomId) {
	if (!e2eeLocalKeyPair) await createE2EEKeyPair();
	if (!e2eeLocalKeyPair) return;
	const rawPub = await crypto.subtle.exportKey('raw', e2eeLocalKeyPair.publicKey);
	socket.emit('e2ee-public-key', {
		roomId,
		publicKey: arrayBufferToBase64(rawPub)
	});
}

async function deriveSharedE2EEKey(remotePublicKeyBase64, roomId) {
	if (!e2eeLocalKeyPair) await createE2EEKeyPair();
	if (!e2eeLocalKeyPair) return;
	const remoteRaw = base64ToArrayBuffer(remotePublicKeyBase64);
	const remoteKey = await crypto.subtle.importKey(
		'raw', remoteRaw,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);
	const sharedKey = await crypto.subtle.deriveKey(
		{ name: 'ECDH', public: remoteKey },
		e2eeLocalKeyPair.privateKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
	e2eeSharedKeys[roomId] = sharedKey;
	console.log('E2EE key established for room', roomId);
}

async function encryptTextForRoom(plainText, roomId) {
	const key = e2eeSharedKeys[roomId];
	if (!key) throw new Error('E2EE key not ready');
	const encoder = new TextEncoder();
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const encrypted = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv },
		key,
		encoder.encode(plainText)
	);
	return JSON.stringify({ iv: arrayBufferToBase64(iv), ciphertext: arrayBufferToBase64(encrypted) });
}

async function decryptTextForRoom(messagePayload, roomId) {
	const key = e2eeSharedKeys[roomId];
	if (!key) return null;
	let payload;
	try {
		payload = typeof messagePayload === 'string' ? JSON.parse(messagePayload) : messagePayload;
	} catch (e) {
		return null;
	}
	if (!payload || !payload.iv || !payload.ciphertext) return null;
	try {
		const iv = new Uint8Array(base64ToArrayBuffer(payload.iv));
		const data = base64ToArrayBuffer(payload.ciphertext);
		const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
		return new TextDecoder().decode(decrypted);
	} catch (e) {
		console.warn('E2EE decryption failed', e);
		return null;
	}
}

async function tryDecryptIfNeeded(rawMsg, roomId) {
	const decrypted = await decryptTextForRoom(rawMsg, roomId);
	if (decrypted !== null) return decrypted;
	return rawMsg;
}

// --- Avatar logic ---
const getOrCreateUserSeed = () => {
	let seed = localStorage.getItem('userSeed');
	if (!seed) {
		seed = 'user_' + Math.random().toString(36).substring(7);
		localStorage.setItem('userSeed', seed);
	}
	return seed;
};

const getAvatarUrl = (seed) => `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;

const mySeed = getOrCreateUserSeed();
const myAvatarUrl = getAvatarUrl(mySeed);

// Cache for other users' avatars (by username or id)
const userAvatarCache = {};

function getUserAvatar(username, id) {
	// Prefer username, fallback to id
	const key = username || id;
	if (!userAvatarCache[key]) {
		// Use username or id as seed for deterministic avatar
		userAvatarCache[key] = getAvatarUrl(key);
	}
	return userAvatarCache[key];
}
// --- Core chat, emoji, and socket logic (restored, wrapped in DOMContentLoaded) ---
document.addEventListener('DOMContentLoaded', function() {
	// --- Chat/socket setup ---
	const socket = io({
		reconnection: true,
		reconnectionAttempts: Infinity,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000
	});
	const params = new URLSearchParams(window.location.search);
	const roomId = params.get("room");
	const chat = document.getElementById("chat");
	const connectionStatus = document.getElementById("connectionDot") || document.getElementById("connectionStatus");
	let loadedMessageIds = new Set();
	document.getElementById("roomCode").innerText = roomId;

	// Connection status handling
	socket.on("connect", async () => {
		connectionStatus.className = "connection-status";
		connectionStatus.title = "Connected";
		socket.emit("join-room", roomId);
		await createE2EEKeyPair();
		await sendE2EEPublicKey(socket, roomId);
	});
	socket.on("disconnect", () => {
		connectionStatus.className = "connection-status disconnected";
		connectionStatus.title = "Disconnected - Reconnecting...";
	});
	socket.on("reconnecting", () => {
		connectionStatus.className = "connection-status reconnecting";
		connectionStatus.title = "Reconnecting...";
	});
	socket.on("reconnect", () => {
		connectionStatus.className = "connection-status";
		connectionStatus.title = "Connected";
	});
	// Room full handling
	socket.on("room-full", () => {
		alert("This room is full (max 2 members). You cannot join.");
		window.location.href = "/";
	});
	// Room members handling
	socket.on("room-members", async (members) => {
		const roomMembersDiv = document.getElementById("membersBar") || document.getElementById("roomMembers");
		await sendE2EEPublicKey(socket, roomId); // re-send key on membership update to ensure current peers share it
		let html = '<span class="members-label">Members:</span>';
		if (members.length === 0) {
			html += '<span class="waiting-text">Waiting for others...</span>';
		} else {
			members.forEach(member => {
				const isYou = member.id === socket.id;
				const statusClass = member.isOnline ? 'online' : '';
				const youClass = isYou ? 'you' : '';
				const label = isYou ? `${member.username || 'You'} (You)` : member.username || member.id;
				const statusTitle = member.isOnline ? 'Online' : 'Offline';
				html += `
					<div class="member-badge ${youClass}" title="${statusTitle}">
						<span class="status-dot ${statusClass}"></span>
						<span>${label}</span>
					</div>
				`;
			});
			if (members.length < 2) {
				html += '<span class="waiting-text">+ Waiting for 1 more...</span>';
			}
		}
		roomMembersDiv.innerHTML = html;
	});

	// E2EE public key exchange
	socket.on("e2ee-public-key", async (data) => {
		if (!data || !data.publicKey || !data.sender) return;
		if (data.sender === socket.id) return;
		await deriveSharedE2EEKey(data.publicKey, roomId);
	});

	// Load message history
	socket.on("message-history", async (messages) => {
		for (const msg of messages) {
			const msgId = msg.timestamp + '_' + msg.sender;
			if (loadedMessageIds.has(msgId)) continue;
			loadedMessageIds.add(msgId);
			if (msg.type === 'text') {
				const decrypted = await tryDecryptIfNeeded(msg.message, roomId);
				window.displayMessage({ ...msg, message: decrypted });
			} else if (msg.type === 'image') {
				window.displayImage(msg);
			}
		}
		scrollToBottom();
	});
	function scrollToBottom() {
		chat.scrollTop = chat.scrollHeight;
	}
	window.sendMessage = async function() {
		const input = document.getElementById("msg");
		const message = input.value.trim();
		if (!message) return;
		const key = e2eeSharedKeys[roomId];
		if (!key) {
			alert('Secure key exchange in progress. Please wait and try again.');
			return;
		}
		let encryptedMessage;
		try {
			encryptedMessage = await encryptTextForRoom(message, roomId);
		} catch (e) {
			console.error('Encryption failed', e);
			alert('Unable to encrypt message. Please try again.');
			return;
		}
		socket.emit("chat-message", { roomId, message: encryptedMessage });
		input.value = "";
	}
	socket.on("chat-message", async (data) => {
		const msgId = data.timestamp + '_' + data.sender;
		if (loadedMessageIds.has(msgId)) return;
		loadedMessageIds.add(msgId);
		const decrypted = await tryDecryptIfNeeded(data.message, roomId);
		window.displayMessage({ ...data, message: decrypted });
	});
	window.pickImage = function() {
		document.getElementById("imageInput").click();
	}
	function generateId() {
		return "img_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
	}
	// Send image
	const imageInput = document.getElementById("imageInput");
	if (imageInput) {
		imageInput.addEventListener("change", function () {
			const file = this.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = function () {
				const imageId = generateId();
				socket.emit("send-image", {
					roomId,
					image: reader.result,
					imageId: imageId
				});
			};
			reader.readAsDataURL(file);
			this.value = "";
		});
	}
	// Receive image
	socket.on("receive-image", (data) => {
		const msgId = data.timestamp + '_' + data.sender;
		if (loadedMessageIds.has(msgId)) return;
		loadedMessageIds.add(msgId);
		window.displayImage(data);
	});
	// REMOVE IMAGE ON ALL CLIENTS
	socket.on("remove-image", (imageId) => {
		const el = chat.querySelector(`[data-id='${imageId}']`);
		if (el) el.remove();
	});
	// Enter key to send
	const msgInput = document.getElementById("msg");
	if (msgInput) {
		msgInput.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				window.sendMessage();
			}
		});
	}
	// Auto-convert emoji shortcodes (e.g., :smile: → 😀)
	const emojiShortcodes = {
		':smile:': '😀', ':grin:': '😁', ':joy:': '😂', ':rofl:': '🤣', ':smiley:': '😃',
		':happy:': '😄', ':sweat_smile:': '😅', ':laughing:': '😆', ':wink:': '😉', ':blush:': '😊',
		':yum:': '😋', ':sunglasses:': '😎', ':heart_eyes:': '😍', ':kiss:': '😘', ':love:': '🥰',
		':kissing:': '😗', ':thinking:': '🤔', ':neutral:': '😐', ':expressionless:': '😑',
		':unamused:': '😒', ':rolling_eyes:': '🙄', ':smirk:': '😏', ':relieved:': '😌',
		':sleepy:': '😪', ':tired:': '😫', ':sleeping:': '😴', ':tongue:': '😛', ':crazy:': '😜',
		':money:': '🤑', ':astonished:': '😲', ':frown:': '☹️', ':worried:': '😟', ':angry:': '😠',
		':rage:': '😡', ':cry:': '😢', ':sob:': '😭', ':fearful:': '😨', ':scream:': '😱',
		':cold:': '🥶', ':hot:': '🥵', ':flushed:': '😳', ':dizzy:': '😵', ':exploding:': '🤯',
		':mask:': '😷', ':sick:': '🤒', ':nauseated:': '🤢', ':vomit:': '🤮', ':angel:': '😇',
		':party:': '🥳', ':pleading:': '🥺', ':cowboy:': '🤠', ':clown:': '🤡', ':nerd:': '🤓',
		':devil:': '😈', ':imp:': '👿', ':wave:': '👋', ':ok:': '👌', ':v:': '✌️',
		':fingers_crossed:': '🤞', ':rock:': '🤘', ':call:': '🤙', ':point_left:': '👈',
		':point_right:': '👉', ':point_up:': '👆', ':point_down:': '👇', ':thumbsup:': '👍',
		':thumbs_up:': '👍', ':+1:': '👍', ':thumbsdown:': '👎', ':thumbs_down:': '👎', ':-1:': '👎',
		':fist:': '✊', ':punch:': '👊', ':clap:': '👏', ':raised_hands:': '🙌', ':pray:': '🙏',
		':muscle:': '💪', ':heart:': '❤️', ':red_heart:': '❤️', ':orange_heart:': '🧡',
		':yellow_heart:': '💛', ':green_heart:': '💚', ':blue_heart:': '💙', ':purple_heart:': '💜',
		':black_heart:': '🖤', ':white_heart:': '🤍', ':broken_heart:': '💔', ':fire:': '🔥',
		':100:': '💯', ':star:': '⭐', ':sparkles:': '✨', ':boom:': '💥', ':rocket:': '🚀',
		':gem:': '💎', ':crown:': '👑', ':unicorn:': '🦄', ':cat:': '🐱', ':dog:': '🐶',
		':panda:': '🐼', ':fox:': '🦊', ':lion:': '🦁', ':tiger:': '🐯', ':frog:': '🐸',
		':monkey:': '🐵', ':see_no_evil:': '🙈', ':hear_no_evil:': '🙉', ':speak_no_evil:': '🙊',
		':skull:': '💀', ':ghost:': '👻', ':alien:': '👽', ':robot:': '🤖', ':poop:': '💩',
		':pumpkin:': '🎃', ':rainbow:': '🌈', ':sun:': '☀️', ':moon:': '🌙', ':lightning:': '⚡',
		':snowflake:': '❄️', ':wave_water:': '🌊', ':cherry_blossom:': '🌸', ':clover:': '🍀',
		':pizza:': '🍕', ':burger:': '🍔', ':fries:': '🍟', ':donut:': '🍩', ':cookie:': '🍪',
		':cake:': '🎂', ':coffee:': '☕', ':beer:': '🍺', ':cheers:': '🥂', ':music:': '🎵',
		':guitar:': '🎸', ':game:': '🎮', ':dice:': '🎲', ':soccer:': '⚽', ':basketball:': '🏀',
		':football:': '🏈', ':tada:': '🎉', ':confetti:': '🎊', ':balloon:': '🎈', ':gift:': '🎁',
		':trophy:': '🏆', ':lol:': '😂', ':haha:': '😂', ':xd:': '😆', ':omg:': '😱',
		':wtf:': '🤯', ':cool:': '😎', ':sad:': '😢', ':mad:': '😠', ':scared:': '😨'
	};
	if (msgInput) {
		msgInput.addEventListener("input", (e) => {
			const input = e.target;
			const text = input.value;
			const shortcodePattern = /:[a-zA-Z0-9_+-]+:/g;
			let newText = text;
			let match;
			while ((match = shortcodePattern.exec(text)) !== null) {
				const shortcode = match[0].toLowerCase();
				if (emojiShortcodes[shortcode]) {
					newText = newText.replace(match[0], emojiShortcodes[shortcode]);
				}
			}
			if (newText !== text) {
				const cursorPos = input.selectionStart;
				const diff = text.length - newText.length;
				input.value = newText;
				input.setSelectionRange(cursorPos - diff, cursorPos - diff);
			}
		});
	}
	// Emoji/Sticker Picker
	const emojis = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙🥲😚☺️🙂🤗🤩🤔🤨😐😑😶🙄😏😣😥😮🤐😯😪😫🥱😴😌😛😜😝🤤😒😓😔😕🙃🤑😲☹️🙁😖😞😟😤😢😭😦😧😨😩🤯😬😰😱🥵🥶😳🤪😵🥴😠😡🤬😷🤒🤕🤢🤮🤧😇🥳🥺🤠🤡🤥🤫🤭🧐🤓😈👿👋🤚🖐️✋🖖👌🤌🤏✌️🤞🤟🤘🤙👈👉👆🖕👇☝️👍👎✊👊🤛🤜👏🙌👐🤲🤝🙏✍️💪🦾❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟'];
	const stickers = ['🎉', '🎊', '🎈', '🎁', '🏆', '⭐', '🌟', '✨', '💫', '🔥', '💥', '💯', '🎯', '🚀', '💎', '👑', '🦄', '🐱', '🐶', '🐼', '🦊', '🦁', '🐯', '🐸', '🐵', '🙈', '🙉', '🙊', '💀', '👻', '👽', '🤖', '💩', '🎃', '🌈', '☀️', '🌙', '⚡', '❄️', '🌊', '🌸', '🌺', '🍀', '🍕', '🍔', '🍟', '🍩', '🍪', '🎂', '🍰', '☕', '🍺', '🥂', '🎵', '🎶', '🎸', '🎮', '🎲', '⚽', '🏀', '🎾', '🏈', '🍆',
		'🍑', '🍒', '🍈', '🥛', '🛥️', '🐱', '🌮', '🐓', '🧱', '👅', '💦', '🧬', '🥜', '🧠', '✂️', '😈', '🥵', '🌶️', '🍜', '🌽', '🍍', '🪑', '🎂', '🥞', '🚛', '🔵', '🟠', '💊', '🍬', '🍁', '❄️', '🎱', '🔑', '🤥', '⚙️'];
	const emojiGrid = document.getElementById('emojis');
	const stickerGrid = document.getElementById('stickers');
	const emojiPicker = document.getElementById('emojiPicker');
	if (emojiGrid && stickerGrid && emojiPicker) {
		emojis.forEach(emoji => {
			const span = document.createElement('span');
			span.className = 'emoji-item';
			span.innerText = emoji;
			span.onclick = () => insertEmoji(emoji);
			emojiGrid.appendChild(span);
		});
		stickers.forEach(sticker => {
			const span = document.createElement('span');
			span.className = 'sticker-item';
			span.innerText = sticker;
			span.onclick = () => sendSticker(sticker);
			stickerGrid.appendChild(span);
		});
		window.toggleEmojiPicker = function() {
			emojiPicker.classList.toggle('show');
		}
		window.showTab = function(tab) {
			document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
			event.target.classList.add('active');
			document.getElementById('emojis').style.display = tab === 'emojis' ? 'grid' : 'none';
			document.getElementById('stickers').style.display = tab === 'stickers' ? 'grid' : 'none';
			document.getElementById('gifs').style.display = tab === 'gifs' ? 'grid' : 'none';
		}
		function insertEmoji(emoji) {
			const input = document.getElementById('msg');
			input.value += emoji;
			input.focus();
		}
		async function sendSticker(sticker) {
			const key = e2eeSharedKeys[roomId];
			if (!key) {
				alert('Secure key exchange in progress. Please wait.');
				return;
			}
			const encryptedSticker = await encryptTextForRoom(sticker, roomId);
			socket.emit("chat-message", { roomId, message: encryptedSticker });
			emojiPicker.classList.remove('show');
		}
		// Close emoji picker when clicking outside
		document.addEventListener('click', (e) => {
			if (!e.target.closest('.emoji-picker') && !e.target.closest('.emoji-btn')) {
				emojiPicker.classList.remove('show');
			}
		});
		// GIF Support
		const gifs = [
			'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
			'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
			'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyg/giphy.gif',
			'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
			'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif',
			'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
			'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif',
			'https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif',
			'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif',
			'https://media.giphy.com/media/l4FGGafcOHmrlQxG0/giphy.gif',
			'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
			'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif'
		];
		const gifGrid = document.getElementById('gifs');
		if (gifGrid) {
			gifs.forEach(gif => {
				const img = document.createElement('img');
				img.className = 'gif-item';
				img.src = gif;
				img.onclick = () => sendGif(gif);
				gifGrid.appendChild(img);
			});
			function sendGif(gifUrl) {
				const imageId = generateId();
				socket.emit("send-image", {
					roomId,
					image: gifUrl,
					imageId: imageId
				});
				emojiPicker.classList.remove('show');
			}
		}
	}
});

// --- Patch displayMessage and displayImage to show avatars ---
// Save original functions if needed
const origDisplayMessage = typeof displayMessage === 'function' ? displayMessage : null;
const origDisplayImage = typeof displayImage === 'function' ? displayImage : null;

// Patch displayMessage
window.displayMessage = function(data) {
	const isMe = data.sender === socket.id;
	const isWhisper = data.messageType === 'whisper';

	const group = document.createElement('div');
	group.className = `message-group ${isMe ? 'me' : 'other'}`;
	group.dataset.msgId = data.id;
	group.dataset.sender = data.sender;

	// Avatar
	const avatarDiv = document.createElement('div');
	avatarDiv.className = 'avatar';
	const avatarImg = document.createElement('img');
	avatarImg.className = 'avatar-img';
	if (isMe) {
		avatarImg.src = myAvatarUrl;
		avatarImg.alt = 'Me';
	} else {
		avatarImg.src = getUserAvatar(data.username, data.sender);
		avatarImg.alt = data.username || 'User';
	}
	avatarDiv.appendChild(avatarImg);

	if (!isMe && data.username) {
		const nameDiv = document.createElement('div');
		nameDiv.className = 'sender-name';
		nameDiv.innerText = data.username;
		group.appendChild(nameDiv);
	}

	// Message wrapper for reactions
	const wrapper = document.createElement('div');
	wrapper.className = `message-wrapper ${isMe ? 'me' : 'other'}`;

	const msgDiv = document.createElement('div');
	msgDiv.className = `message ${isMe ? 'me' : 'other'}`;

	// Handle whisper messages
	if (isWhisper && !isMe) {
		wrapper.appendChild(msgDiv);
		group.appendChild(avatarDiv);
		group.appendChild(wrapper);
		chat.insertBefore(group, typingStreamContainer);
		displayWhisperMessage(data, msgDiv, group);
		return;
	}

	// Regular message
	msgDiv.innerText = data.message;

	// Apply emotional glow for non-whisper messages
	if (!isWhisper) {
		const emotion = detectEmotion(data.message);
		if (emotion) {
			msgDiv.classList.add(`glow-${emotion}`);
		}
	}

	wrapper.appendChild(msgDiv);

	// Reaction trigger button
	const reactionTrigger = document.createElement('span');
	reactionTrigger.className = 'reaction-trigger';
	reactionTrigger.innerText = '😀';
	reactionTrigger.onclick = (e) => {
		e.stopPropagation();
		toggleReactionPicker(data.id);
	};
	wrapper.appendChild(reactionTrigger);

	// Reaction picker
	const reactionPicker = document.createElement('div');
	reactionPicker.className = 'reaction-picker';
	reactionPicker.id = `reaction-picker-${data.id}`;
	quickReactions.forEach(emoji => {
		const span = document.createElement('span');
		span.innerText = emoji;
		span.onclick = (e) => {
			e.stopPropagation();
			addReaction(data.id, emoji);
			reactionPicker.classList.remove('show');
		};
		reactionPicker.appendChild(span);
	});
	wrapper.appendChild(reactionPicker);

	// Reactions container
	const reactionsContainer = document.createElement('div');
	reactionsContainer.className = 'reactions-container';
	reactionsContainer.id = `reactions-${data.id}`;
	wrapper.appendChild(reactionsContainer);

	// Initialize reactions from data if present
	if (data.reactions) {
		messageReactions[data.id] = data.reactions;
		renderReactions(data.id);
	}

	// Add avatar to left (other) or right (me)
	if (isMe) {
		group.appendChild(wrapper);
		group.appendChild(avatarDiv);
	} else {
		group.appendChild(avatarDiv);
		group.appendChild(wrapper);
	}

	// Add message meta (time + status)
	if (isMe) {
		const metaDiv = document.createElement('div');
		metaDiv.className = 'message-meta';
		const time = new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		metaDiv.innerHTML = `
			<span class="message-time">${time}</span>
			<span class="message-status">${getStatusTick(data.status || 'sent')}</span>
		`;
		group.appendChild(metaDiv);
	}

	chat.insertBefore(group, typingStreamContainer);
	scrollToBottom();
};

// Patch displayImage
window.displayImage = function(data) {
	const isMe = data.sender === socket.id;
	const msgId = data.imageId;

	const group = document.createElement('div');
	group.className = `message-group ${isMe ? 'me' : 'other'}`;
	group.dataset.id = msgId;
	group.dataset.msgId = msgId;

	// Avatar
	const avatarDiv = document.createElement('div');
	avatarDiv.className = 'avatar';
	const avatarImg = document.createElement('img');
	avatarImg.className = 'avatar-img';
	if (isMe) {
		avatarImg.src = myAvatarUrl;
		avatarImg.alt = 'Me';
	} else {
		avatarImg.src = getUserAvatar(data.username, data.sender);
		avatarImg.alt = data.username || 'User';
	}
	avatarDiv.appendChild(avatarImg);

	if (!isMe && data.username) {
		const nameDiv = document.createElement('div');
		nameDiv.className = 'sender-name';
		nameDiv.innerText = data.username;
		group.appendChild(nameDiv);
	}

	// Message wrapper for reactions
	const wrapper = document.createElement('div');
	wrapper.className = `message-wrapper ${isMe ? 'me' : 'other'}`;

	const msgDiv = document.createElement('div');
	msgDiv.className = `message ${isMe ? 'me' : 'other'}`;

	const img = document.createElement('img');
	img.src = data.image;
	msgDiv.appendChild(img);

	if (isMe) {
		const delBtn = document.createElement('button');
		delBtn.className = 'delete-img-btn';
		delBtn.innerText = 'Delete';
		delBtn.onclick = () => {
			socket.emit('delete-image', { roomId, imageId: data.imageId });
		};
		msgDiv.appendChild(delBtn);
	}

	wrapper.appendChild(msgDiv);

	// Reaction trigger button
	const reactionTrigger = document.createElement('span');
	reactionTrigger.className = 'reaction-trigger';
	reactionTrigger.innerText = '😀';
	reactionTrigger.onclick = (e) => {
		e.stopPropagation();
		toggleReactionPicker(msgId);
	};
	wrapper.appendChild(reactionTrigger);

	// Reaction picker
	const reactionPicker = document.createElement('div');
	reactionPicker.className = 'reaction-picker';
	reactionPicker.id = `reaction-picker-${msgId}`;
	quickReactions.forEach(emoji => {
		const span = document.createElement('span');
		span.innerText = emoji;
		span.onclick = (e) => {
			e.stopPropagation();
			addReaction(msgId, emoji);
			reactionPicker.classList.remove('show');
		};
		reactionPicker.appendChild(span);
	});
	wrapper.appendChild(reactionPicker);

	// Reactions container
	const reactionsContainer = document.createElement('div');
	reactionsContainer.className = 'reactions-container';
	reactionsContainer.id = `reactions-${msgId}`;
	wrapper.appendChild(reactionsContainer);

	// Add avatar to left (other) or right (me)
	if (isMe) {
		group.appendChild(wrapper);
		group.appendChild(avatarDiv);
	} else {
		group.appendChild(avatarDiv);
		group.appendChild(wrapper);
	}

	chat.insertBefore(group, typingStreamContainer);
	scrollToBottom();
};

// --- Video call UI: floating, movable, small opponent video ---
// (Assume HTML already has miniCallInline, miniRemoteVideoInline, etc. as in your markup)
// Make miniCallInline draggable
const miniCall = document.getElementById('miniCallInline');
if (miniCall) {
	let isDragging = false, dragOffsetX = 0, dragOffsetY = 0;
	miniCall.style.position = 'fixed';
	miniCall.style.bottom = '20px';
	miniCall.style.right = '20px';
	miniCall.style.zIndex = 2001;

	miniCall.addEventListener('mousedown', function(e) {
		if (e.target.tagName === 'BUTTON') return; // Don't drag on button click
		isDragging = true;
		dragOffsetX = e.clientX - miniCall.getBoundingClientRect().left;
		dragOffsetY = e.clientY - miniCall.getBoundingClientRect().top;
		document.body.style.userSelect = 'none';
	});
	document.addEventListener('mousemove', function(e) {
		if (!isDragging) return;
		miniCall.style.left = (e.clientX - dragOffsetX) + 'px';
		miniCall.style.top = (e.clientY - dragOffsetY) + 'px';
		miniCall.style.right = '';
		miniCall.style.bottom = '';
	});
	document.addEventListener('mouseup', function() {
		isDragging = false;
		document.body.style.userSelect = '';
	});
}
