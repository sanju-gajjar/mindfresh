// Main chat room JS (migrated from room.html)
// Avatar, chat, and video call logic

// Global references to socket and roomId (set in DOMContentLoaded)
let socket = null;
let roomId = null;

// --- Self Video Preview Logic ---
let selfVideoStream = null;
const selfVideoBtn = document.getElementById('selfVideoBtn');
const selfVideoPreview = document.getElementById('selfVideoPreview');
const selfVideoElement = document.getElementById('selfVideoElement');
const closeSelfVideoBtn = document.getElementById('closeSelfVideoBtn');
// Expose to global for HTML onclick (after function definitions)
window.toggleSelfVideo = toggleSelfVideo;
window.stopSelfVideo = stopSelfVideo;

// --- Room Video Logic ---
let roomVideoEnabled = localStorage.getItem('roomVideoEnabled') !== 'false'; // Default to true
let roomVideoStream = null;
let roomPeerConnection = null;
let roomDataChannel = null;
const roomVideoBtn = document.getElementById('roomVideoBtn');
const roomVideoBar = document.getElementById('roomVideoBar');
const localRoomVideo = document.getElementById('localRoomVideo');
const remoteRoomVideo = document.getElementById('remoteRoomVideo');
const remoteVideoLabel = document.getElementById('remoteVideoLabel');

// --- Screen Share Logic ---
let screenShareActive = false;
let screenShareStream = null;
let screenShareAudioStream = null;
let screenSharePeerConnection = null;
let screenShareSender = null;
const screenShareBtn = document.getElementById('screenShareBtn');
const screenShareWindow = document.getElementById('screenShareWindow');
const screenShareVideo = document.getElementById('screenShareVideo');

// WebRTC configuration
const roomConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

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

// --- Room Video Functions ---
async function initRoomVideo() {
	if (!roomVideoEnabled) return;

	try {
		roomVideoStream = await navigator.mediaDevices.getUserMedia({
			video: { width: 320, height: 240 },
			audio: false
		});

		localRoomVideo.srcObject = roomVideoStream;
		localRoomVideo.classList.add('active');
		roomVideoBar.style.display = 'block';

		// Initialize WebRTC peer connection
		createRoomPeerConnection();

		// Emit that we're ready for video
		socket.emit('room-video-ready', { roomId });

	} catch (err) {
		console.error('Could not access camera for room video:', err);
		// Fallback: show video bar but indicate no camera
		roomVideoBar.style.display = 'block';
		localRoomVideo.style.display = 'none';
		document.querySelector('.video-box:first-child .video-label').textContent = 'No Camera';
	}
}

function createRoomPeerConnection() {
	roomPeerConnection = new RTCPeerConnection(roomConfig);

	// Add local stream tracks
	if (roomVideoStream) {
		roomVideoStream.getTracks().forEach(track => {
			roomPeerConnection.addTrack(track, roomVideoStream);
		});
	}

	// Handle remote stream
	roomPeerConnection.ontrack = (event) => {
		remoteRoomVideo.srcObject = event.streams[0];
		remoteRoomVideo.classList.add('active');
		remoteVideoLabel.textContent = 'Partner';
	};

	// Handle ICE candidates
	roomPeerConnection.onicecandidate = (event) => {
		if (event.candidate) {
			socket.emit('room-video-ice', { roomId, candidate: event.candidate });
		}
	};

	// Handle connection state changes
	roomPeerConnection.onconnectionstatechange = () => {
		if (roomPeerConnection.connectionState === 'disconnected' || roomPeerConnection.connectionState === 'failed') {
			stopRemoteRoomVideo();
		}
	};
}

async function startRoomVideoCall() {
	if (!roomPeerConnection) return;

	try {
		const offer = await roomPeerConnection.createOffer();
		await roomPeerConnection.setLocalDescription(offer);
		socket.emit('room-video-offer', { roomId, offer });
	} catch (err) {
		console.error('Error creating room video offer:', err);
	}
}

function stopRoomVideo() {
	if (roomVideoStream) {
		roomVideoStream.getTracks().forEach(track => track.stop());
		roomVideoStream = null;
	}
	if (roomPeerConnection) {
		roomPeerConnection.close();
		roomPeerConnection = null;
	}
	localRoomVideo.srcObject = null;
	stopRemoteRoomVideo();
	roomVideoBar.style.display = 'none';
}

function stopRemoteRoomVideo() {
	remoteRoomVideo.srcObject = null;
	remoteRoomVideo.classList.remove('active');
	remoteVideoLabel.textContent = 'Waiting...';
}

function toggleRoomVideo() {
	roomVideoEnabled = !roomVideoEnabled;
	localStorage.setItem('roomVideoEnabled', roomVideoEnabled);

	if (roomVideoEnabled) {
		initRoomVideo();
		roomVideoBtn.classList.add('active');
	} else {
		stopRoomVideo();
		roomVideoBtn.classList.remove('active');
	}
}

// Expose to global for HTML onclick
window.toggleRoomVideo = toggleRoomVideo;

// --- Screen Share Functions with Audio ---
async function toggleScreenShare() {
	if (screenShareActive) {
		stopScreenShare();
	} else {
		startScreenShare();
	}
}

async function startScreenShare() {
	if (!socket) {
		alert('Connection not established. Please reload the page.');
		return;
	}

	try {
		// Request screen capture with audio
		screenShareStream = await navigator.mediaDevices.getDisplayMedia({
			video: {
				cursor: 'always',
				displaySurface: 'monitor'
			},
			audio: {
				echoCancellation: false,
				noiseSuppression: false,
				autoGainControl: false
			}
		});

		// Display screen in local window
		screenShareVideo.srcObject = screenShareStream;
		screenShareWindow.style.display = 'block';
		screenShareActive = true;
		screenShareBtn.classList.add('active');

		// Add status message to chat
		const chatArea = document.getElementById('chat');
		const statusMsg = document.createElement('div');
		statusMsg.style.cssText = 'text-align: center; color: #10a37f; font-size: 13px; font-style: italic; margin: 8px 0;';
		statusMsg.textContent = '📺 You started sharing your screen';
		chatArea.appendChild(statusMsg);
		chatArea.scrollTop = chatArea.scrollHeight;

		// Handle screen share stop by user (via browser UI)
		screenShareStream.getTracks().forEach(track => {
			track.onended = () => {
				stopScreenShare();
			};
		});

		// Notify other users that screen sharing started
		socket.emit('screen-share-start', { roomId });

		// If we have a peer connection, add screen tracks
		if (roomPeerConnection) {
			// Get all tracks from screen share stream
			const videoTrack = screenShareStream.getVideoTracks()[0];
			const audioTracks = screenShareStream.getAudioTracks();

			// Replace video track
			if (videoTrack) {
				const videoSender = roomPeerConnection.getSenders().find(s => s.track?.kind === 'video');
				if (videoSender) {
					await videoSender.replaceTrack(videoTrack);
				} else {
					roomPeerConnection.addTrack(videoTrack, screenShareStream);
				}
			}

			// Add audio track from screen if available
			if (audioTracks.length > 0) {
				const audioTrack = audioTracks[0];
				const audioSender = roomPeerConnection.getSenders().find(s => s.track?.kind === 'audio');
				if (audioSender) {
					// Try to replace if possible
					await audioSender.replaceTrack(audioTrack).catch(err => {
						// If replace fails, add as new track
						roomPeerConnection.addTrack(audioTrack, screenShareStream);
					});
				} else {
					// Add new audio sender for screen share audio
					roomPeerConnection.addTrack(audioTrack, screenShareStream);
				}
			}
		}

		console.log('Screen share started with audio');
	} catch (err) {
		console.error('Error starting screen share:', err);
		if (err.name === 'NotAllowedError') {
			alert('Screen sharing was cancelled.');
		} else if (err.name === 'NotFoundError') {
			alert('No screen available to share.');
		} else {
			alert('Could not start screen share: ' + err.message);
		}
	}
}

function stopScreenShare() {
	if (screenShareStream) {
		screenShareStream.getTracks().forEach(track => track.stop());
		screenShareStream = null;
	}

	screenShareVideo.srcObject = null;
	screenShareWindow.style.display = 'none';
	screenShareActive = false;
	screenShareBtn.classList.remove('active');

	// Add status message to chat
	const chatArea = document.getElementById('chat');
	const statusMsg = document.createElement('div');
	statusMsg.style.cssText = 'text-align: center; color: #8e8e8e; font-size: 13px; font-style: italic; margin: 8px 0;';
	statusMsg.textContent = '📺 Screen sharing ended';
	chatArea.appendChild(statusMsg);
	chatArea.scrollTop = chatArea.scrollHeight;

	// Restore camera video if it was enabled
	if (roomVideoEnabled && roomPeerConnection && roomVideoStream) {
		const videoTrack = roomVideoStream.getVideoTracks()[0];
		if (videoTrack) {
			const videoSender = roomPeerConnection.getSenders().find(s => s.track?.kind === 'video');
			if (videoSender) {
				videoSender.replaceTrack(videoTrack).catch(err => {
					console.error('Error restoring camera video:', err);
				});
			}
		}
	}

	// Notify other users that screen sharing stopped
	socket.emit('screen-share-stop', { roomId });

	console.log('Screen share stopped');
}

// Expose to global for HTML onclick
window.toggleScreenShare = toggleScreenShare;

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
	socket = io({
		reconnection: true,
		reconnectionAttempts: Infinity,
		reconnectionDelay: 1000,
		reconnectionDelayMax: 5000
	});
	const params = new URLSearchParams(window.location.search);
	roomId = params.get("room");
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

		// Initialize room video after connection
		setTimeout(() => {
			if (roomVideoEnabled) {
				initRoomVideo();
			}
		}, 1000); // Small delay to ensure room join is processed
	});
	socket.on("disconnect", () => {
		connectionStatus.className = "connection-status disconnected";
		connectionStatus.title = "Disconnected - Reconnecting...";
		// Clean up room video on disconnect
		stopRoomVideo();
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

		// Handle room video when members change
		const hasPartner = members.some(member => member.id !== socket.id && member.isOnline);
		if (hasPartner && roomVideoEnabled && !roomPeerConnection) {
			// Partner joined, try to start video
			setTimeout(() => initRoomVideo(), 500);
		} else if (!hasPartner && roomPeerConnection) {
			// Partner left, stop video
			stopRemoteRoomVideo();
		}
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

	// Room Video Signaling
	socket.on("room-video-ready", () => {
		// When partner is ready, start the video call
		if (roomVideoEnabled && roomPeerConnection) {
			startRoomVideoCall();
		}
	});

	socket.on("room-video-offer", async (data) => {
		if (!roomPeerConnection) return;

		try {
			await roomPeerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
			const answer = await roomPeerConnection.createAnswer();
			await roomPeerConnection.setLocalDescription(answer);
			socket.emit('room-video-answer', { roomId, answer });
		} catch (err) {
			console.error('Error handling room video offer:', err);
		}
	});

	socket.on("room-video-answer", async (data) => {
		if (!roomPeerConnection) return;

		try {
			await roomPeerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
		} catch (err) {
			console.error('Error handling room video answer:', err);
		}
	});

	socket.on("room-video-ice", async (data) => {
		if (!roomPeerConnection) return;

		try {
			await roomPeerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
		} catch (err) {
			console.error('Error adding ICE candidate:', err);
		}
	});

	// Screen Share Event Handlers
	socket.on("screen-share-start", (data) => {
		if (data.sender === socket.id) return; // Skip own event
		console.log('Partner started screen sharing');
		// Show notification or update UI
		const notification = document.createElement('div');
		notification.style.cssText = 'position: fixed; top: 100px; right: 20px; background: #10a37f; color: white; padding: 12px 20px; border-radius: 8px; z-index: 2000; font-size: 14px;';
		notification.textContent = '📺 Partner is sharing their screen';
		document.body.appendChild(notification);
		setTimeout(() => notification.remove(), 3000);
	});

	socket.on("screen-share-stop", (data) => {
		if (data.sender === socket.id) return; // Skip own event
		console.log('Partner stopped screen sharing');
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

	// Initialize room video button state
	if (roomVideoBtn) {
		if (roomVideoEnabled) {
			roomVideoBtn.classList.add('active');
		} else {
			roomVideoBtn.classList.remove('active');
		}
	}

	// Cleanup on page unload
	window.addEventListener('beforeunload', () => {
		stopRoomVideo();
		stopSelfVideo();
	});
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
