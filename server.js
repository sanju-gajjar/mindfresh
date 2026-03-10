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
const roomMessages = {}; // Store messages per room
const users = {}; // Store connected users
const waitingUsers = []; // Queue for stranger matching
const strangerPairs = {}; // Track paired strangers

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
    username: `User${Math.floor(Math.random() * 9999)}`,
    inStrangerChat: false,
    partnerId: null
  };

  socket.emit("user-info", users[socket.id]);

  socket.on("set-username", (username) => {
    if (users[socket.id]) {
      users[socket.id].username = username;
      socket.emit("user-info", users[socket.id]);
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
    socket.join(roomId);
    socket.emit("room-created", roomId);
  });

  socket.on("join-room", (roomId) => {

    // If room doesn't exist → create it automatically
    if (!rooms[roomId]) {
      rooms[roomId] = true;
    }

    socket.join(roomId);
    socket.emit("room-joined", roomId);

    // Send existing messages to the user
    if (roomMessages[roomId]) {
      socket.emit("message-history", roomMessages[roomId]);
    }

    socket.to(roomId).emit("user-joined", socket.id);
  });

  socket.on("chat-message", ({ roomId, message }) => {
    const username = users[socket.id] ? users[socket.id].username : socket.id;
    const msgData = {
      sender: socket.id,
      username,
      message,
      timestamp: Date.now()
    };

    // Store message in room history (keep last 100 messages)
    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push({ type: 'text', ...msgData });
    if (roomMessages[roomId].length > 100) roomMessages[roomId].shift();

    io.to(roomId).emit("chat-message", msgData);
  });

  socket.on("remove-image", (imageId) => {
    const messages = document.querySelectorAll(".message");
    messages.forEach(msg => {
      if (msg.dataset.id === imageId) {
        msg.remove();
      }
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

  socket.on("disconnect", () => {
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

    // Clean up user
    delete users[socket.id];
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
