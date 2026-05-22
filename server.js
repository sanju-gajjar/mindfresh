const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const ENABLE_BOT = process.env.ENABLE_BOT === 'true';

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};
const roomMembers = {}; // Track members per room
const roomMessages = {}; // Store messages per room
const users = {}; // Store connected users
const waitingUsers = []; // Queue for stranger matching
const strangerPairs = {}; // Track paired strangers
const roomOwners = {}; // Track room creators
const pendingJoinRequests = {}; // Track pending join requests per room
const messageStatus = {}; // Track message delivery/read status
const typingState = {}; // Track typing state per user

function getRoomMembers(roomId) {
  return roomMembers[roomId] || [];
}

function getNextDeterministicUsername(roomId) {
  const members = getRoomMembers(roomId);
  let index = 1;
  while (members.some(member => member.username && member.username.toLowerCase() === `user${index}`)) {
    index += 1;
  }
  return `user${index}`;
}

function assignRoomUsername(roomId, desiredUsername) {
  const members = getRoomMembers(roomId);
  const raw = typeof desiredUsername === 'string' ? desiredUsername.trim() : '';
  const normalized = raw.toLowerCase();

  if (normalized === 'admin') {
    const alreadyAdmin = members.some(member => member.username.toLowerCase() === 'admin');
    if (!alreadyAdmin) {
      return { username: 'admin', role: 'admin' };
    }
  }

  if (raw) {
    const duplicate = members.some(member => member.username.toLowerCase() === normalized);
    if (!duplicate) {
      return { username: raw, role: 'user' };
    }
  }

  return { username: getNextDeterministicUsername(roomId), role: 'user' };
}

function getParticipant(roomId, socketId) {
  return getRoomMembers(roomId).find(member => member.id === socketId);
}

function emitRoomState(roomId) {
  const members = getRoomMembers(roomId);
  io.to(roomId).emit('room-state', {
    participants: members,
    ownerId: roomOwners[roomId]
  });
  io.to(roomId).emit('room-members', {
    members,
    ownerId: roomOwners[roomId]
  });
}

function emitParticipantUpdated(roomId, participant) {
  io.to(roomId).emit('participant-updated', { participant });
}

function emitParticipantLeft(roomId, socketId) {
  io.to(roomId).emit('participant-left', { socketId });
}

// Bot configuration
const botGreetings = [
  "Hi! How are you?",
  "Hello there!",
  "Hey! What's up?",
  "Hi! Nice to meet you",
  "Hello! How's your day going?",
  "Hey there! 👋",
  "Hi! What brings you here?",
  "Hello! Anyone there?",
  "Hey! Wanna chat?",
  "Hi! How are you doing?",
  "Yo! What's good?",
  "Heyy! 😊",
  "Hi! What's happening?",
  "Hello! Is anyone here?",
  "Hey! How's it going?"
];

const botNames = [
  "Alex", "Sam", "Jordan", "Taylor", "Casey",
  "Morgan", "Riley", "Avery", "Quinn", "Drew",
  "Jamie", "Skylar", "Parker", "Reese", "Dakota"
];

function createBot(realUserId, realUserSocket) {
  const botId = `bot_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const botName = botNames[Math.floor(Math.random() * botNames.length)] + Math.floor(Math.random() * 999);
  const roomId = uuidv4();

  // Create bot user entry
  users[botId] = {
    id: botId,
    username: botName,
    inStrangerChat: true,
    partnerId: realUserId,
    isBot: true
  };

  // Update real user
  users[realUserId].inStrangerChat = true;
  users[realUserId].partnerId = botId;

  strangerPairs[realUserId] = { roomId, partnerId: botId };
  strangerPairs[botId] = { roomId, partnerId: realUserId };

  realUserSocket.join(roomId);

  // Notify real user
  realUserSocket.emit("stranger-found", {
    roomId,
    partnerName: botName
  });

  // Send random greeting after a brief delay (500ms-1500ms)
  const greetingDelay = 500 + Math.floor(Math.random() * 1000);
  setTimeout(() => {
    const greeting = botGreetings[Math.floor(Math.random() * botGreetings.length)];
    realUserSocket.emit("chat-message", {
      sender: botId,
      username: botName,
      message: greeting
    });
  }, greetingDelay);

  // Bot disconnects after 5 seconds
  setTimeout(() => {
    if (users[realUserId] && users[realUserId].partnerId === botId) {
      realUserSocket.emit("stranger-disconnected");
      users[realUserId].inStrangerChat = false;
      users[realUserId].partnerId = null;
      delete strangerPairs[realUserId];
    }
    delete users[botId];
    delete strangerPairs[botId];
  }, 5000);
}

io.on("connection", (socket) => {
  // Initialize user
  users[socket.id] = {
    id: socket.id,
    desiredUsername: null,
    inStrangerChat: false,
    partnerId: null,
    currentRoom: null
  };

  socket.emit('user-info', users[socket.id]);

  socket.on('set-username', (username) => {
    if (users[socket.id]) {
      users[socket.id].desiredUsername = username;
      users[socket.id].username = username;
      socket.emit('user-info', users[socket.id]);
    }
  });

  // Random Stranger Chat
  socket.on("find-stranger", () => {
    if (users[socket.id].inStrangerChat) return;

    // Check if there's someone waiting
    if (waitingUsers.length > 0) {
      const partnerId = waitingUsers.shift();
      const partnerSocket = io.sockets.sockets.get(partnerId);

      if (partnerSocket && users[partnerId] && !users[partnerId].inStrangerChat) {
        // Create pair with real user
        const roomId = uuidv4();
        users[socket.id].inStrangerChat = true;
        users[socket.id].partnerId = partnerId;
        users[partnerId].inStrangerChat = true;
        users[partnerId].partnerId = socket.id;

        strangerPairs[socket.id] = { roomId, partnerId };
        strangerPairs[partnerId] = { roomId, partnerId: socket.id };

        socket.join(roomId);
        partnerSocket.join(roomId);

        socket.emit("stranger-found", {
          roomId,
          partnerName: users[partnerId].username
        });
        partnerSocket.emit("stranger-found", {
          roomId,
          partnerName: users[socket.id].username
        });
        // Successfully matched with real user, no bot needed
        return;
      } else {
        // Invalid partner, continue to add self to queue
        waitingUsers.push(socket.id);
      }
    } else {
      // No one waiting, add to queue
      waitingUsers.push(socket.id);
    }

    socket.emit("searching-stranger");

    // Create bot after 3-5 seconds if still waiting (only if ENABLE_BOT is true)
    if (ENABLE_BOT) {
      setTimeout(() => {
        const stillWaiting = waitingUsers.includes(socket.id);
        if (stillWaiting && users[socket.id] && !users[socket.id].inStrangerChat) {
          const index = waitingUsers.indexOf(socket.id);
          if (index > -1) waitingUsers.splice(index, 1);
          createBot(socket.id, socket);
        }
      }, 3000 + Math.floor(Math.random() * 2000));
    }
  });

  socket.on("skip-stranger", () => {
    if (users[socket.id].inStrangerChat && strangerPairs[socket.id]) {
      const { roomId, partnerId } = strangerPairs[socket.id];
      const partnerSocket = io.sockets.sockets.get(partnerId);

      // Check if partner is a bot
      if (users[partnerId] && users[partnerId].isBot) {
        // Just clean up the bot
        delete users[partnerId];
        delete strangerPairs[partnerId];
      } else if (partnerSocket) {
        // Notify real partner
        partnerSocket.emit("stranger-disconnected");
        if (users[partnerId]) {
          users[partnerId].inStrangerChat = false;
          users[partnerId].partnerId = null;
        }
        delete strangerPairs[partnerId];
      }

      // Leave room
      socket.leave(roomId);
      users[socket.id].inStrangerChat = false;
      users[socket.id].partnerId = null;
      delete strangerPairs[socket.id];

      socket.emit("stranger-skipped");
    }
  });

  socket.on("stop-searching", () => {
    const index = waitingUsers.indexOf(socket.id);
    if (index > -1) {
      waitingUsers.splice(index, 1);
    }
    socket.emit("search-stopped");
  });

  socket.on("create-room", () => {
    const roomId = uuidv4().slice(0, 6);
    rooms[roomId] = true;
    roomOwners[roomId] = socket.id; // Track room owner
    roomMembers[roomId] = [];
    pendingJoinRequests[roomId] = [];
    socket.join(roomId);
    socket.emit("room-created", roomId);
  });

  socket.on('join-room', (payload) => {
    const roomId = typeof payload === 'object' && payload !== null ? payload.roomId : payload;
    const usernameFromClient = typeof payload === 'object' && payload !== null ? payload.username : undefined;
    if (!roomId) return;

    const desiredUsername = usernameFromClient || (users[socket.id] ? users[socket.id].desiredUsername : undefined);
    if (desiredUsername && users[socket.id]) {
      users[socket.id].desiredUsername = desiredUsername;
      users[socket.id].username = desiredUsername;
    }

    // If room doesn't exist → create it automatically (first person becomes owner)
    if (!rooms[roomId]) {
      rooms[roomId] = true;
      roomOwners[roomId] = socket.id;
      roomMembers[roomId] = [];
      pendingJoinRequests[roomId] = [];
    }

    // If room has no members yet, this user becomes the owner.
    if (roomMembers[roomId].length === 0) {
      roomOwners[roomId] = socket.id;
    }

    socket.join(roomId);

    const { username, role } = assignRoomUsername(roomId, desiredUsername);
    const existingMemberIndex = roomMembers[roomId].findIndex(m => m.id === socket.id);

    if (existingMemberIndex === -1) {
      roomMembers[roomId].push({
        id: socket.id,
        username,
        role,
        isAdmin: role === 'admin',
        isOnline: true,
        videoEnabled: false,
        audioEnabled: false
      });
    } else {
      roomMembers[roomId][existingMemberIndex] = {
        ...roomMembers[roomId][existingMemberIndex],
        username,
        role,
        isAdmin: role === 'admin',
        isOnline: true
      };
    }

    if (users[socket.id]) {
      users[socket.id].currentRoom = roomId;
    }

    socket.emit('room-joined', roomId);

    if (roomMessages[roomId]) {
      socket.emit('message-history', roomMessages[roomId]);
    }

    emitRoomState(roomId);
    const participant = getParticipant(roomId, socket.id);
    if (participant) {
      io.to(roomId).emit('participant-joined', { participant });
    }
    socket.to(roomId).emit('user-joined', socket.id);
  });

  // Handle join request approval
  socket.on("approve-join-request", ({ roomId, userId }) => {
    if (roomOwners[roomId] !== socket.id) return; // Only owner can approve

    const userSocket = io.sockets.sockets.get(userId);
    if (!userSocket) return;

    // Remove from pending
    if (pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(r => r.id !== userId);
    }

    // Add user to room
    userSocket.join(roomId);
    const username = users[userId] ? users[userId].username : `User${Math.floor(Math.random() * 9999)}`;

    if (!roomMembers[roomId]) roomMembers[roomId] = [];
    roomMembers[roomId].push({
      id: userId,
      username: username,
      isOnline: true
    });

    if (users[userId]) {
      users[userId].currentRoom = roomId;
    }

    userSocket.emit("room-joined", roomId);

    // Send message history
    if (roomMessages[roomId]) {
      userSocket.emit("message-history", roomMessages[roomId]);
    }

    // Update all members
    io.to(roomId).emit("room-members", {
      members: roomMembers[roomId],
      ownerId: roomOwners[roomId]
    });
  });

  // Handle join request rejection
  socket.on("reject-join-request", ({ roomId, userId }) => {
    if (roomOwners[roomId] !== socket.id) return;

    if (pendingJoinRequests[roomId]) {
      pendingJoinRequests[roomId] = pendingJoinRequests[roomId].filter(r => r.id !== userId);
    }

    const userSocket = io.sockets.sockets.get(userId);
    if (userSocket) {
      userSocket.emit("join-rejected", { roomId });
    }
  });

  // Handle kick user
  socket.on('kick-user', ({ roomId, userId }) => {
    if (roomOwners[roomId] !== socket.id) return;

    const userSocket = io.sockets.sockets.get(userId);
    if (userSocket) {
      userSocket.leave(roomId);
      userSocket.emit('kicked-from-room', { roomId });
    }

    if (roomMembers[roomId]) {
      roomMembers[roomId] = roomMembers[roomId].filter(m => m.id !== userId);
      emitParticipantLeft(roomId, userId);
      emitRoomState(roomId);
    }

    if (users[userId]) {
      users[userId].currentRoom = null;
    }
  });

  socket.on('toggle-audio', ({ roomId, enabled }) => {
    const participant = getParticipant(roomId, socket.id);
    if (!participant) return;

    participant.audioEnabled = Boolean(enabled);
    emitParticipantUpdated(roomId, participant);
    emitRoomState(roomId);
  });

  socket.on('toggle-video', ({ roomId, enabled }) => {
    const participant = getParticipant(roomId, socket.id);
    if (!participant) return;

    participant.videoEnabled = Boolean(enabled);
    emitParticipantUpdated(roomId, participant);
    emitRoomState(roomId);
  });

  socket.on('admin-force-audio', ({ roomId, userId, enabled }) => {
    const sender = getParticipant(roomId, socket.id);
    if (!sender || sender.role !== 'admin') return;

    const participant = getParticipant(roomId, userId);
    if (!participant) return;

    participant.audioEnabled = Boolean(enabled);
    emitParticipantUpdated(roomId, participant);
    emitRoomState(roomId);

    const targetSocket = io.sockets.sockets.get(userId);
    if (targetSocket) {
      targetSocket.emit('admin-force-audio', { enabled });
    }
  });

  socket.on('admin-force-video', ({ roomId, userId, enabled }) => {
    const sender = getParticipant(roomId, socket.id);
    if (!sender || sender.role !== 'admin') return;

    const participant = getParticipant(roomId, userId);
    if (!participant) return;

    participant.videoEnabled = Boolean(enabled);
    emitParticipantUpdated(roomId, participant);
    emitRoomState(roomId);

    const targetSocket = io.sockets.sockets.get(userId);
    if (targetSocket) {
      targetSocket.emit('admin-force-video', { enabled });
    }
  });

  socket.on('e2ee-public-key', ({ roomId, publicKey }) => {
    socket.to(roomId).emit("e2ee-public-key", {
      sender: socket.id,
      publicKey
    });
  });

  socket.on("chat-message", ({ roomId, message }) => {
    const username = users[socket.id] ? users[socket.id].username : socket.id;
    const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check for whisper command
    const isWhisper = message.startsWith('/whisper ');
    const actualMessage = isWhisper ? message.substring(9) : message;
    const messageType = isWhisper ? 'whisper' : 'text';

    const msgData = {
      id: messageId,
      sender: socket.id,
      username,
      message: actualMessage,
      messageType,
      timestamp: Date.now(),
      status: 'sent' // sent -> delivered -> read
    };

    // Store message in room history (keep last 100 messages)
    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push({ type: messageType, ...msgData });
    if (roomMessages[roomId].length > 100) roomMessages[roomId].shift();

    // Send to sender with sent status
    socket.emit("chat-message", { ...msgData, status: 'sent' });

    // Send to others with delivered status
    socket.to(roomId).emit("chat-message", { ...msgData, status: 'delivered' });

    // Notify sender of delivery
    socket.emit("message-delivered", { messageId });
  });

  // Message read receipts
  socket.on("message-read", ({ roomId, messageIds }) => {
    // Notify all senders that their messages were read
    if (roomMessages[roomId]) {
      roomMessages[roomId].forEach(msg => {
        if (messageIds.includes(msg.id) && msg.sender !== socket.id) {
          const senderSocket = io.sockets.sockets.get(msg.sender);
          if (senderSocket) {
            senderSocket.emit("message-read-receipt", { messageId: msg.id });
          }
          msg.status = 'read';
        }
      });
    }
  });

  // Message reactions
  socket.on("add-reaction", ({ roomId, messageId, emoji }) => {
    const username = users[socket.id] ? users[socket.id].username : socket.id;

    // Find and update message in history
    if (roomMessages[roomId]) {
      const msg = roomMessages[roomId].find(m => m.id === messageId);
      if (msg) {
        if (!msg.reactions) msg.reactions = {};
        if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

        // Check if user already reacted with this emoji
        const existingIndex = msg.reactions[emoji].findIndex(r => r.userId === socket.id);
        if (existingIndex === -1) {
          msg.reactions[emoji].push({ userId: socket.id, username });
        }
      }
    }

    // Broadcast reaction to all users in room
    io.to(roomId).emit("reaction-added", {
      messageId,
      emoji,
      userId: socket.id,
      username
    });
  });

  socket.on("remove-reaction", ({ roomId, messageId, emoji }) => {
    // Find and update message in history
    if (roomMessages[roomId]) {
      const msg = roomMessages[roomId].find(m => m.id === messageId);
      if (msg && msg.reactions && msg.reactions[emoji]) {
        msg.reactions[emoji] = msg.reactions[emoji].filter(r => r.userId !== socket.id);
        if (msg.reactions[emoji].length === 0) {
          delete msg.reactions[emoji];
        }
      }
    }

    // Broadcast removal to all users in room
    io.to(roomId).emit("reaction-removed", {
      messageId,
      emoji,
      userId: socket.id
    });
  });

  socket.on("send-image", ({ roomId, image, imageId }) => {
    const username = users[socket.id] ? users[socket.id].username : socket.id;
    const imgData = {
      sender: socket.id,
      username,
      image,
      imageId,
      timestamp: Date.now()
    };

    // Store image in room history
    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push({ type: 'image', ...imgData });
    if (roomMessages[roomId].length > 100) roomMessages[roomId].shift();

    io.to(roomId).emit("receive-image", imgData);
  });

  socket.on("delete-image", ({ roomId, imageId }) => {
    if (roomMessages[roomId]) {
      roomMessages[roomId] = roomMessages[roomId].filter(msg => {
        return !(msg.type === 'image' && msg.imageId === imageId);
      });
    }
    io.to(roomId).emit("remove-image", imageId);
  });

  // WebRTC Signaling
  socket.on("call-user", ({ roomId, offer, isVideoCall }) => {
    socket.to(roomId).emit("call-made", { offer, isVideoCall });
  });

  socket.on("make-answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer-made", { answer });
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", { candidate });
  });

  socket.on("call-rejected", ({ roomId }) => {
    socket.to(roomId).emit("call-rejected");
  });

  socket.on("end-call", ({ roomId }) => {
    socket.to(roomId).emit("call-ended");
  });

  // Room Video Signaling (persistent small videos)
  socket.on("room-video-ready", ({ roomId }) => {
    socket.to(roomId).emit("room-video-ready");
  });

  socket.on("room-video-offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("room-video-offer", { offer });
  });

  socket.on("room-video-answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("room-video-answer", { answer });
  });

  socket.on("room-video-ice", ({ roomId, candidate }) => {
    socket.to(roomId).emit("room-video-ice", { candidate });
  });

  // Screen Share Event Handlers
  socket.on("screen-share-start", ({ roomId }) => {
    const username = users[socket.id] ? users[socket.id].username : "User";
    console.log(`${username} started screen sharing in room ${roomId}`);
    socket.to(roomId).emit("screen-share-start", {
      sender: socket.id,
      username
    });
  });

  socket.on("screen-share-stop", ({ roomId }) => {
    const username = users[socket.id] ? users[socket.id].username : "User";
    console.log(`${username} stopped screen sharing in room ${roomId}`);
    socket.to(roomId).emit("screen-share-stop", {
      sender: socket.id,
      username
    });
  });

  socket.on('youtube-share', ({ roomId, videoId }) => {
    socket.to(roomId).emit('youtube-share', {
      sender: socket.id,
      videoId
    });
  });

  socket.on('youtube-control', ({ roomId, action, value }) => {
    socket.to(roomId).emit('youtube-control', {
      sender: socket.id,
      action,
      value
    });
  });

  // Live Typing Stream - typing_start, typing_update, typing_stop
  socket.on("typing_start", ({ roomId }) => {
    const username = users[socket.id] ? users[socket.id].username : "Stranger";
    // Track typing state
    typingState[socket.id] = { roomId, username };
    socket.to(roomId).emit("typing_start", {
      userId: socket.id,
      username
    });
  });

  socket.on("typing_update", ({ roomId, text }) => {
    const username = users[socket.id] ? users[socket.id].username : "Stranger";
    // Update typing state
    typingState[socket.id] = { roomId, username, text };
    socket.to(roomId).emit("typing_update", {
      userId: socket.id,
      username,
      text
    });
  });

  socket.on("typing_stop", ({ roomId }) => {
    const username = users[socket.id] ? users[socket.id].username : "Stranger";
    // Clear typing state
    delete typingState[socket.id];
    socket.to(roomId).emit("typing_stop", {
      userId: socket.id,
      username
    });
  });

  // Legacy typing indicator (backward compatibility)
  socket.on("typing", ({ roomId, isTyping }) => {
    const username = users[socket.id] ? users[socket.id].username : "Stranger";
    socket.to(roomId).emit("user-typing", {
      userId: socket.id,
      username,
      isTyping
    });
  });

  // Also handle stranger typing with live stream
  socket.on("stranger_typing_start", () => {
    if (users[socket.id] && strangerPairs[socket.id]) {
      const { partnerId } = strangerPairs[socket.id];
      const username = users[socket.id] ? users[socket.id].username : "Stranger";
      // Track stranger typing state
      typingState[socket.id] = { partnerId, username, isStranger: true };
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("typing_start", {
          userId: socket.id,
          username
        });
      }
    }
  });

  socket.on("stranger_typing_update", ({ text }) => {
    if (users[socket.id] && strangerPairs[socket.id]) {
      const { partnerId } = strangerPairs[socket.id];
      const username = users[socket.id] ? users[socket.id].username : "Stranger";
      // Update stranger typing state
      typingState[socket.id] = { partnerId, username, text, isStranger: true };
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("typing_update", {
          userId: socket.id,
          username,
          text
        });
      }
    }
  });

  socket.on("stranger_typing_stop", () => {
    if (users[socket.id] && strangerPairs[socket.id]) {
      const { partnerId } = strangerPairs[socket.id];
      const username = users[socket.id] ? users[socket.id].username : "Stranger";
      // Clear stranger typing state
      delete typingState[socket.id];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("typing_stop", {
          userId: socket.id,
          username
        });
      }
    }
  });

  // Legacy stranger typing (backward compatibility)
  socket.on("stranger-typing", ({ isTyping }) => {
    if (users[socket.id] && strangerPairs[socket.id]) {
      const { roomId, partnerId } = strangerPairs[socket.id];
      const username = users[socket.id] ? users[socket.id].username : "Stranger";
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("user-typing", {
          userId: socket.id,
          username,
          isTyping
        });
      }
    }
  });

  socket.on("disconnect", () => {
    // Clear typing state if user was typing
    if (typingState[socket.id]) {
      const { roomId, username } = typingState[socket.id];
      socket.to(roomId).emit("typing_stop", {
        userId: socket.id,
        username
      });
      delete typingState[socket.id];
    }

    // Remove from waiting list
    const waitIndex = waitingUsers.indexOf(socket.id);
    if (waitIndex > -1) {
      waitingUsers.splice(waitIndex, 1);
    }

    // Handle stranger chat disconnect
    if (users[socket.id] && users[socket.id].inStrangerChat && strangerPairs[socket.id]) {
      const { partnerId } = strangerPairs[socket.id];

      // Check if partner is a bot
      if (users[partnerId] && users[partnerId].isBot) {
        // Just clean up the bot
        delete users[partnerId];
        delete strangerPairs[partnerId];
      } else {
        const partnerSocket = io.sockets.sockets.get(partnerId);

        if (partnerSocket) {
          partnerSocket.emit("stranger-disconnected");
          if (users[partnerId]) {
            users[partnerId].inStrangerChat = false;
            users[partnerId].partnerId = null;
          }
          delete strangerPairs[partnerId];
        }
      }
      delete strangerPairs[socket.id];
    }

    // Handle room disconnect - REMOVE user from roomMembers
    if (users[socket.id] && users[socket.id].currentRoom) {
      const roomId = users[socket.id].currentRoom;
      if (roomMembers[roomId]) {
        roomMembers[roomId] = roomMembers[roomId].filter(m => m.id !== socket.id);
        emitParticipantLeft(roomId, socket.id);
        emitRoomState(roomId);
      }

      // Clean up pending join requests for this user
      for (const rid in pendingJoinRequests) {
        if (pendingJoinRequests[rid]) {
          pendingJoinRequests[rid] = pendingJoinRequests[rid].filter(r => r.id !== socket.id);
        }
      }
    }

    // Clean up user
    delete users[socket.id];
  });
});

server.listen(3001, () => {
  console.log("Server running on http://localhost:3001");
});
